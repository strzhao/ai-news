import { CliError, isRecord, readErrorMessage } from "../errors";

export function ensureRecord(value: unknown, fallbackMessage: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new CliError(4, fallbackMessage);
  }
  return value;
}

export function throwForStatus(
  status: number,
  payload: unknown,
  endpoint: string,
  authHint?: string,
): void {
  if (status < 400) {
    return;
  }
  if (status === 401) {
    throw new CliError(3, readErrorMessage(payload, "鉴权失败（401）"), {
      status,
      endpoint,
      hint: authHint,
    });
  }
  throw new CliError(4, readErrorMessage(payload, `请求失败（HTTP ${status}）`), {
    status,
    endpoint,
  });
}

export function ensureOkField(payload: Record<string, unknown>, endpoint: string): void {
  if (payload.ok === true) {
    return;
  }
  throw new CliError(5, readErrorMessage(payload, "服务返回 ok=false"), {
    endpoint,
  });
}

export function boolTo01(value: boolean | undefined): string | undefined {
  return value ? "1" : undefined;
}
