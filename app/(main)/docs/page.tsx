export default function DocsPage(): React.ReactNode {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 16px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 650, marginBottom: 8 }}>AI News CLI</h1>
      <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 32 }}>
        为 AI Agent 设计的命令行工具，通过终端访问 AI News 的全部能力。
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>安装</h2>
        <pre style={{ background: "var(--surface)", padding: 16, borderRadius: 8, overflow: "auto", fontSize: 13 }}>
{`npm install -g ai-news-cli`}
        </pre>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>登录</h2>
        <pre style={{ background: "var(--surface)", padding: 16, borderRadius: 8, overflow: "auto", fontSize: 13 }}>
{`# 浏览器 OAuth 登录
ai-news login

# 直接提供 JWT（无头环境）
ai-news login --token <jwt>

# 查看当前用户
ai-news whoami

# 登出
ai-news logout`}
        </pre>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>命令示例</h2>
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>
          所有业务命令从服务端动态加载，运行 <code>ai-news --help</code> 查看完整列表。
        </p>
        <pre style={{ background: "var(--surface)", padding: 16, borderRadius: 8, overflow: "auto", fontSize: 13 }}>
{`# 文章
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
ai-news stats:types --days 30`}
        </pre>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>AI Agent 集成</h2>
        <ul style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.8, paddingLeft: 20 }}>
          <li>所有命令输出 JSON，方便程序解析</li>
          <li>退出码：<code>0</code> 成功 / <code>1</code> 错误 / <code>2</code> 需登录</li>
          <li>业务命令从 <code>/api/manifest</code> 动态加载，无需更新 CLI 即可获得新功能</li>
          <li>支持环境变量 <code>AI_NEWS_API_URL</code> 覆盖服务端地址</li>
        </ul>
      </section>

      <section>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>源码</h2>
        <p style={{ fontSize: 13 }}>
          <a
            href="https://github.com/strzhao/ai-news-cli"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent)" }}
          >
            github.com/strzhao/ai-news-cli
          </a>
        </p>
      </section>
    </div>
  );
}
