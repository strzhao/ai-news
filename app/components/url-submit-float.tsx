"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { submitExtraction, pollTaskStatus } from "@/lib/client/url-analysis";
import { saveUserPick } from "@/lib/client/user-picks";
import type { AuthUser } from "@/lib/client/types";

type FloatState = "hidden" | "input" | "running" | "done" | "error";
type RunStep = "submitting" | "extracting" | "summarizing" | "saving";

const STEPS: { key: RunStep; label: string }[] = [
  { key: "submitting", label: "提交" },
  { key: "extracting", label: "提取内容" },
  { key: "summarizing", label: "AI 总结" },
  { key: "saving", label: "保存" },
];

function stepClassName(idx: number, currentIdx: number): string {
  if (idx < currentIdx) return "url-float-step done";
  if (idx === currentIdx) return "url-float-step active";
  return "url-float-step pending";
}

export default function UrlSubmitFloat({ authUser }: { authUser: AuthUser | null }): React.ReactNode {
  const router = useRouter();
  const [state, setState] = useState<FloatState>("hidden");
  const [url, setUrl] = useState("");
  const [runStep, setRunStep] = useState<RunStep>("submitting");
  const [errorMsg, setErrorMsg] = useState("");
  const [doneTitle, setDoneTitle] = useState("");
  const [doneArticleId, setDoneArticleId] = useState("");
  const [doneMissingSummary, setDoneMissingSummary] = useState(false);
  const abortRef = useRef(false);

  // Listen for custom event to open the float
  useEffect(() => {
    function handleOpen() {
      if (!authUser) return;
      setState("input");
      setUrl("");
      setErrorMsg("");
    }
    window.addEventListener("url-submit-open", handleOpen);
    return () => window.removeEventListener("url-submit-open", handleOpen);
  }, [authUser]);

  const handleClose = useCallback(() => {
    abortRef.current = true;
    setState("hidden");
    setUrl("");
    setErrorMsg("");
    setRunStep("submitting");
    setDoneTitle("");
    setDoneArticleId("");
    setDoneMissingSummary(false);
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    abortRef.current = false;
    setState("running");
    setRunStep("submitting");
    setErrorMsg("");

    try {
      const result = await submitExtraction(trimmed, true);
      if (abortRef.current) return;

      if (!result.ok || !result.task) {
        setState("error");
        setErrorMsg(result.error || "提交失败");
        return;
      }

      setRunStep("extracting");
      const taskId = result.task.task_id;

      // Poll until completed
      let task = result.task;
      let consecutiveFailures = 0;
      for (let i = 0; i < 120; i++) {
        if (abortRef.current) return;
        if (task.status === "completed") break;
        if (task.status === "failed") {
          setState("error");
          setErrorMsg(task.error_message || "提取失败");
          return;
        }
        await new Promise((r) => setTimeout(r, 5000));
        if (abortRef.current) return;
        const poll = await pollTaskStatus(taskId);
        if (poll.ok && poll.task) {
          task = poll.task;
          consecutiveFailures = 0;
        } else {
          consecutiveFailures++;
          if (consecutiveFailures >= 5) {
            setState("error");
            setErrorMsg("网络异常，请稍后重试");
            return;
          }
        }
      }

      if (task.status !== "completed") {
        setState("error");
        setErrorMsg("提取超时，请稍后重试");
        return;
      }

      if (abortRef.current) return;
      setRunStep("summarizing");

      // If ai_summary not yet ready, poll a few more times
      if (!task.ai_summary) {
        for (let i = 0; i < 24; i++) {
          if (abortRef.current) return;
          await new Promise((r) => setTimeout(r, 5000));
          if (abortRef.current) return;
          const poll = await pollTaskStatus(taskId);
          if (poll.ok && poll.task) {
            task = poll.task;
            if (task.ai_summary) break;
          }
        }
      }

      if (abortRef.current) return;
      setRunStep("saving");

      // Build article payload
      const thumbResource = task.resources?.find((r) => r.type === "thumbnail" || r.type === "image");
      const meta = task.metadata as unknown as Record<string, unknown> | undefined;
      const articleId = String(meta?.article_id || "") || `pick-${task.task_id}`;
      let sourceHost = "";
      try { sourceHost = new URL(task.url).hostname; } catch { /* ignore */ }
      const payload = {
        article_id: articleId,
        title: task.metadata?.title || task.url,
        url: task.url,
        original_url: task.url,
        source_host: sourceHost,
        image_url: thumbResource?.url || "",
        summary: task.metadata?.description || "",
        ai_summary: task.ai_summary || "",
      };

      await saveUserPick(payload);

      if (abortRef.current) return;

      setDoneMissingSummary(!task.ai_summary);
      setDoneTitle(payload.title);
      setDoneArticleId(articleId);
      setState("done");
    } catch (err) {
      if (abortRef.current) return;
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [url]);

  const handleDoneClick = useCallback(() => {
    router.push(`/hearts?open=${encodeURIComponent(doneArticleId)}`);
    handleClose();
  }, [router, doneArticleId, handleClose]);

  const handleRetry = useCallback(() => {
    setState("input");
    setErrorMsg("");
  }, []);

  if (!authUser || state === "hidden") return null;

  const currentStepIdx = STEPS.findIndex((s) => s.key === runStep);

  return (
    <div className="url-float">
      <div className="url-float-card">
        {/* Header */}
        <div className="url-float-header">
          <span className="url-float-title">
            {state === "input" && "收录文章"}
            {state === "running" && "处理中..."}
            {state === "done" && "收录完成"}
            {state === "error" && "收录失败"}
          </span>
          <button type="button" className="url-float-close" onClick={handleClose} aria-label="关闭">
            &times;
          </button>
        </div>

        {/* Input state */}
        {state === "input" ? (
          <form onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}>
            <input
              type="url"
              className="url-float-input"
              placeholder="https://..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
              required
            />
            <button type="submit" className="url-float-submit-btn" disabled={!url.trim()}>
              开始收录
            </button>
          </form>
        ) : null}

        {/* Running state */}
        {state === "running" ? (
          <div className="url-float-steps">
            {STEPS.map((step, idx) => (
              <div key={step.key} className={stepClassName(idx, currentStepIdx)}>
                <span className="url-float-step-icon">
                  {idx < currentStepIdx ? "\u2713" : ""}
                </span>
                <span className="url-float-step-label">{step.label}</span>
              </div>
            ))}
          </div>
        ) : null}

        {/* Done state */}
        {state === "done" ? (
          <div className="url-float-done-card" onClick={handleDoneClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") handleDoneClick(); }}>
            <div className={doneMissingSummary ? "url-float-done-check url-float-done-warn" : "url-float-done-check"}>{doneMissingSummary ? "\u26A0" : "\u2713"}</div>
            <div className="url-float-done-info">
              <div className="url-float-done-title">{doneTitle || "文章已保存"}</div>
              {doneMissingSummary ? (
                <div className="url-float-done-hint url-float-done-hint-warn">AI 总结生成失败，仅保存了文章信息</div>
              ) : (
                <div className="url-float-done-hint">点击查看收藏 &rarr;</div>
              )}
            </div>
          </div>
        ) : null}

        {/* Error state */}
        {state === "error" ? (
          <div className="url-float-error">
            <p className="url-float-error-msg">{errorMsg}</p>
            <button type="button" className="url-float-submit-btn" onClick={handleRetry}>
              重试
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
