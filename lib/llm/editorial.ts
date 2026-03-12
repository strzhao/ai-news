import { DeepSeekClient, DeepSeekError } from "@/lib/llm/deepseek-client";
import { UpstashClient } from "@/lib/infra/upstash";

export type EditorialEdition = "morning" | "noon" | "evening";

export interface ArticleBrief {
  title: string;
  summary: string;
  source_host: string;
  tag_groups: Record<string, string[]>;
}

export interface DailyEditorial {
  date: string;
  edition?: EditorialEdition;
  editor_name: string;
  editor_title: string;
  headline: string;
  body_paragraphs: string[];
  tags: string[];
  generated_at: string;
}

interface EditorPersona {
  name: string;
  title: string;
  style_prompt: string;
}

// Index 0 = Sunday, 1 = Monday, ..., 6 = Saturday (matches Date.getDay())
const EDITORS: EditorPersona[] = [
  {
    name: "周远",
    title: "每周复盘，宏观视角",
    style_prompt:
      "你是周远，擅长宏观战略分析和周度复盘。你的风格是高屋建瓴、善于串联不同事件之间的隐藏关联，" +
      "喜欢用「这意味着什么」的框架来解读新闻。你的语气沉稳但有力，像一位资深战略顾问。" +
      "周日是你的复盘日，你尤其擅长把一周的碎片信息拼成一幅完整图景。",
  },
  {
    name: "林默",
    title: "基础设施极客，开源信仰者",
    style_prompt:
      "你是林默，一个硬核基础设施极客和开源信仰者。你关注模型架构、推理优化、训练框架、" +
      "部署方案和 benchmark 数据。你的风格冷静克制，用技术事实说话，对没有 benchmark 支撑的吹嘘不屑一顾。" +
      "你会注意到别人忽略的技术细节，比如量化精度、吞吐量变化、许可证条款。",
  },
  {
    name: "唐薇",
    title: "AI 产品与真实用户体验",
    style_prompt:
      "你是唐薇，产品体验的挑剔鉴赏家。你关注的不是技术参数而是「用户拿到手里到底好不好用」。" +
      "你对花哨但无用的 demo 深恶痛绝，对真正解决问题的产品由衷赞赏。" +
      "你的语言直接、有画面感，喜欢用具体使用场景来说明问题，偶尔带点挑剔的温柔。",
  },
  {
    name: "雷鸣",
    title: "AI 商业辣评",
    style_prompt:
      "你是雷鸣，AI 圈的毒舌评论员。你最擅长戳破行业泡沫、拆穿画饼和公关话术。" +
      "你说话不留情面但逻辑严密，吐槽总是一针见血。你对「重新定义」「颠覆」「all-in」这类词汇过敏。" +
      "但你不是为了毒舌而毒舌——你真正在乎的是行业能不能做出有价值的东西。" +
      "你偶尔会用反讽和夸张来表达观点，但底层分析永远是扎实的。",
  },
  {
    name: "苏诺",
    title: "论文、突破与真正的科学",
    style_prompt:
      "你是苏诺，学术背景深厚的技术编辑。你关注顶会论文、前沿突破和真正的科学进展。" +
      "你擅长把复杂的技术论文翻译成人话，但绝不为了通俗而牺牲准确性。" +
      "你对 hype 天然免疫，能精准区分「真正的突破」和「换皮改进」。" +
      "你的语气像一位耐心但严格的教授，偶尔会对论文中的巧妙设计表达克制的赞叹。",
  },
  {
    name: "方毅",
    title: "创业、融资与谁在造什么",
    style_prompt:
      "你是方毅，创业圈的观察者和参与者。你关注融资动态、新公司、商业模式创新和竞争格局变化。" +
      "你的嗅觉敏锐，善于从一笔融资或一次人事变动中读出行业信号。" +
      "你的风格务实、接地气，喜欢问「这个东西能赚钱吗」「谁在买单」。" +
      "你对创业者有天然的同理心，但对不靠谱的商业计划毫不客气。",
  },
  {
    name: "陆月",
    title: "AI × 生活，带点幽默",
    style_prompt:
      "你是陆月，AI 新闻界的开心果。你的超能力是让严肃的技术新闻变得有趣好玩。" +
      "你善用比喻、类比和网络梗来解释复杂概念，但幽默只是你的表达方式，不是你的全部——" +
      "你的洞察力其实很强。你关注 AI 如何改变普通人的工作和生活，视角贴近用户。" +
      "你的文风轻松活泼，像在和朋友发微信语音，偶尔会自嘲，但观点总是言之有物。",
  },
];

const CACHE_TTL_SECONDS = 48 * 3600;
const CACHE_KEY_PREFIX = "editorial:daily:";

const EDITION_INSTRUCTIONS: Record<string, string> = {
  morning:
    "请基于昨晚到今晨的最新动态，撰写今日晨间编辑综述。" +
    "重点关注昨晚深夜至今早出现的新进展，如果今日内容尚少可回顾昨日重要动态。",
  noon: "请基于今日上午的精选文章，撰写午间编辑综述。",
  evening: "请基于今日全天的精选文章，撰写晚间编辑综述，做好今日总结和前瞻。",
};

function buildSystemPrompt(editor: EditorPersona, edition?: EditorialEdition): string {
  const task =
    EDITION_INSTRUCTIONS[edition || ""] ||
    "请基于今日精选文章列表，以你的视角撰写今日编辑综述。";

  return (
    `你是 ${editor.name}，一位 AI 领域的资深编辑。${editor.style_prompt}\n\n` +
    "你用中文写作，保持你独特的表达风格和视角。\n" +
    `${task}\n\n` +
    "严格输出 JSON，不要输出 Markdown 或解释。字段：\n" +
    '{\n  "headline": "一句话概括今日最重要的 AI 动态（15-25字，体现你的风格）",\n' +
    '  "body_paragraphs": [\n' +
    '    "第一段：今日最值得关注的 1-2 个核心事件或趋势（80-120字）",\n' +
    '    "第二段：补充其他值得留意的动态，串联今日整体脉络（60-100字）",\n' +
    '    "第三段（可选）：一句你的个人观点或前瞻（30-50字）"\n' +
    "  ],\n" +
    '  "tags": ["关键词1", "关键词2", ...（3-8个技术/产品维度标签）]\n' +
    "}"
  );
}

function getEditorForDate(date: string): EditorPersona {
  const dayOfWeek = new Date(date + "T12:00:00").getDay();
  return EDITORS[dayOfWeek] || EDITORS[0];
}

export class EditorialGenerator {
  private readonly forceRefresh: boolean;

  constructor(
    private readonly llmClient: DeepSeekClient,
    private readonly redis: UpstashClient | null,
    options: { forceRefresh?: boolean } = {},
  ) {
    this.forceRefresh = Boolean(options.forceRefresh);
  }

  async getDailyEditorial(date: string, articles: ArticleBrief[], edition?: EditorialEdition): Promise<DailyEditorial | null> {
    if (!articles.length) {
      return null;
    }

    // Check cache (skip if force refresh)
    if (this.redis && !this.forceRefresh) {
      const cached = await this.tryGetCached(date);
      if (cached) return cached;
    }

    // Generate
    const editorial = await this.generate(date, articles, edition);

    // Cache
    if (this.redis) {
      await this.tryCacheResult(date, editorial);
    }

    return editorial;
  }

  private async tryGetCached(date: string): Promise<DailyEditorial | null> {
    try {
      const raw = await this.redis!.get(`${CACHE_KEY_PREFIX}${date}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.headline && parsed.editor_name) {
        return parsed as DailyEditorial;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async tryCacheResult(date: string, editorial: DailyEditorial): Promise<void> {
    try {
      await this.redis!.set(`${CACHE_KEY_PREFIX}${date}`, JSON.stringify(editorial), CACHE_TTL_SECONDS);
    } catch {
      // Silently ignore cache write failures
    }
  }

  private async generate(date: string, articles: ArticleBrief[], edition?: EditorialEdition): Promise<DailyEditorial> {
    const editor = getEditorForDate(date);

    const inputs = articles.slice(0, 20).map((a) => ({
      title: a.title,
      summary: a.summary,
      source: a.source_host,
      tags: this.flattenTags(a.tag_groups),
    }));

    const userPrompt = JSON.stringify({ date, edition: edition || "default", article_count: articles.length, articles: inputs });

    const result = await this.llmClient.chatJson(
      [
        { role: "system", content: buildSystemPrompt(editor, edition) },
        { role: "user", content: userPrompt },
      ],
      0.3,
    );

    const headline = String(result.headline || "").trim();
    if (!headline) {
      throw new DeepSeekError("Editorial generation returned empty headline");
    }

    const bodyParagraphs = Array.isArray(result.body_paragraphs)
      ? result.body_paragraphs.map((p: unknown) => String(p || "").trim()).filter(Boolean)
      : [];

    const tags = Array.isArray(result.tags)
      ? result.tags
          .map((t: unknown) => String(t || "").trim().replace(/^#+/, ""))
          .filter(Boolean)
          .slice(0, 10)
      : [];

    return {
      date,
      edition,
      editor_name: editor.name,
      editor_title: editor.title,
      headline,
      body_paragraphs: bodyParagraphs,
      tags,
      generated_at: new Date().toISOString(),
    };
  }

  private flattenTags(tagGroups: Record<string, string[]>): string[] {
    if (!tagGroups || typeof tagGroups !== "object") return [];
    const result: string[] = [];
    for (const key of ["topic", "tech", "role", "scenario"]) {
      const tags = tagGroups[key];
      if (!Array.isArray(tags)) continue;
      for (const tag of tags) {
        if (result.length >= 6) break;
        const cleaned = String(tag || "").trim();
        if (cleaned) result.push(cleaned);
      }
    }
    return result;
  }
}
