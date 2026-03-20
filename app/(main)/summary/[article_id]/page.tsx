"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

interface ArticleMeta {
  title: string;
  url: string;
  original_url: string;
  source_host: string;
  ai_summary: string;
}

export default function SummaryPage(): React.ReactNode {
  const params = useParams<{ article_id: string }>();
  const articleId = params.article_id;

  const [meta, setMeta] = useState<ArticleMeta | null>(null);
  const [summaryMarkdown, setSummaryMarkdown] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!articleId) return;
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        // Fetch meta + summary in parallel
        const [metaRes, summaryRes] = await Promise.all([
          fetch(`/api/v1/article-meta/${encodeURIComponent(articleId)}`),
          fetch(`/api/article_summary/${encodeURIComponent(articleId)}`),
        ]);

        if (cancelled) return;

        const metaData = await metaRes.json();
        const summaryData = await summaryRes.json();

        if (!metaRes.ok || !metaData.ok) {
          setError("文章不存在或已被删除");
          setLoading(false);
          return;
        }

        setMeta(metaData);

        // Use ai_summary from meta as fallback
        if (
          summaryData.ok &&
          summaryData.status === "completed" &&
          summaryData.summary_markdown
        ) {
          setSummaryMarkdown(summaryData.summary_markdown);
        } else if (metaData.ai_summary) {
          setSummaryMarkdown(metaData.ai_summary);
        } else {
          setSummaryMarkdown("");
        }

        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载失败");
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  if (loading) {
    return (
      <div className="summary-page">
        <p className="empty-note">加载中...</p>
      </div>
    );
  }

  if (error || !meta) {
    return (
      <div className="summary-page">
        <p className="empty-note">{error || "文章不存在"}</p>
      </div>
    );
  }

  const articleUrl = meta.original_url || meta.url;

  return (
    <div className="summary-page">
      <h1 className="summary-page-title">{meta.title}</h1>
      <div className="summary-drawer-meta">
        <span>{meta.source_host || "未知来源"}</span>
        {articleUrl ? (
          <>
            <span> · </span>
            <a
              href={articleUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="summary-page-origin-link"
            >
              阅读原文
            </a>
          </>
        ) : null}
      </div>

      {summaryMarkdown ? (
        <div className="summary-content">
          <ReactMarkdown
            components={{
              a: ({ children, href, ...props }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  {...props}
                >
                  {children}
                </a>
              ),
            }}
          >
            {summaryMarkdown}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="empty-note">暂无 AI 总结</p>
      )}

      <div className="summary-page-footer">
        <a
          className="article-cta"
          href={articleUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          阅读原文
        </a>
      </div>
    </div>
  );
}
