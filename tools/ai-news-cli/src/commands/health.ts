import { RuntimeOptionInput, resolveRuntimeContext } from "../config";
import { requestJson } from "../http";
import { CommandResult, printSuccessLine } from "../output";
import { ensureOkField, ensureRecord, throwForStatus } from "./common";

export interface HealthCommandOptions extends RuntimeOptionInput {}

export async function executeHealthCommand(options: HealthCommandOptions): Promise<CommandResult> {
  const runtime = resolveRuntimeContext(options);
  const started = Date.now();
  const response = await requestJson({
    baseUrl: runtime.baseUrl,
    path: "/api/healthz",
    timeoutMs: runtime.timeoutMs,
  });
  const latencyMs = Date.now() - started;
  const payload = ensureRecord(response.data, "healthz 接口返回格式异常");
  throwForStatus(response.status, payload, response.url);
  ensureOkField(payload, response.url);

  return {
    payload: {
      ...payload,
      latency_ms: latencyMs,
    },
    lines: [
      printSuccessLine("服务健康检查通过"),
      `now: ${String(payload.now || "-")}`,
      `latency_ms: ${latencyMs}`,
    ],
  };
}
