const card = {
  background: "var(--surface)",
  borderRadius: 12,
  padding: "24px",
  marginBottom: 24,
  border: "1px solid var(--border, #e5e7eb)",
} as const;

const cardTitle = {
  fontSize: 16,
  fontWeight: 600,
  marginBottom: 12,
} as const;

const codeBlock = {
  background: "var(--muted-bg, #f4f4f5)",
  padding: "12px 16px",
  borderRadius: 8,
  overflow: "auto" as const,
  fontSize: 13,
  fontFamily: "monospace",
  lineHeight: 1.7,
};

const desc = {
  color: "var(--muted)",
  fontSize: 13,
  lineHeight: 1.7,
} as const;

export default function DocsPage(): React.ReactNode {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 16px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 650, marginBottom: 8 }}>
        AI News CLI
      </h1>
      <p style={{ ...desc, fontSize: 14, marginBottom: 32 }}>
        为 AI Agent 设计的命令行工具，通过终端访问 AI News 的全部能力。
      </p>

      <div
        style={{
          ...card,
          borderColor: "var(--accent, #3b82f6)",
          background:
            "color-mix(in srgb, var(--accent, #3b82f6) 5%, var(--surface))",
        }}
      >
        <h2 style={cardTitle}>AI-First 设计</h2>
        <p style={desc}>
          所有命令输出 JSON，退出码语义化（<code>0</code> 成功 / <code>1</code>{" "}
          错误 / <code>2</code> 需登录），业务命令从服务端动态加载，无需更新 CLI
          即可获得新功能。
        </p>
      </div>

      <div style={card}>
        <h2 style={cardTitle}>安装</h2>
        <pre style={codeBlock}>{`npm install -g ai-news-cli`}</pre>
      </div>

      <div style={card}>
        <h2 style={cardTitle}>Claude Code Skill</h2>
        <p style={{ ...desc, marginBottom: 12 }}>
          安装 skill 后，可在 Claude Code 中通过 <code>/ai-news</code> 命令调用
          CLI 能力。
        </p>
        <pre
          style={codeBlock}
        >{`npx skills add github.com/strzhao/ai-news-cli`}</pre>
        <p style={{ ...desc, marginTop: 12 }}>
          安装后输入 <code>/ai-news</code> 即可让 agent 查询文章、分析 URL、管理
          Flomo 等。
        </p>
      </div>

      <div style={card}>
        <h2 style={cardTitle}>认证</h2>
        <pre style={codeBlock}>{`# 浏览器 OAuth 登录
ai-news login

# 直接提供 JWT（无头环境）
ai-news login --token <jwt>

# 查看当前用户
ai-news whoami

# 登出
ai-news logout`}</pre>
      </div>

      <div style={card}>
        <h2 style={cardTitle}>命令示例</h2>
        <p style={{ ...desc, marginBottom: 12 }}>
          所有业务命令从服务端动态加载，运行 <code>ai-news --help</code>{" "}
          查看完整列表。
        </p>
        <pre style={codeBlock}>{`# 文章
ai-news articles:list --days 7 --quality_tier high
ai-news articles:summary --article_id <id>

# URL 解析
ai-news url:analyze --url https://example.com/article
ai-news url:status --task_id <id>
ai-news url:tasks

# Flomo 集成
ai-news flomo:config
ai-news flomo:set-webhook --webhook_url https://flomoapp.com/...
ai-news flomo:push-log --limit 10
ai-news flomo:click-stats --days 30

# 统计
ai-news stats:sources --days 30
ai-news stats:types --days 30`}</pre>
      </div>

      <div style={card}>
        <h2 style={cardTitle}>源码</h2>
        <p style={desc}>
          <a
            href="https://github.com/strzhao/ai-news-cli"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent)" }}
          >
            github.com/strzhao/ai-news-cli
          </a>
        </p>
      </div>
    </div>
  );
}
