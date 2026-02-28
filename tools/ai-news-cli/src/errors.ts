export type ExitCode = 1 | 2 | 3 | 4 | 5;

export interface CliErrorOptions {
  status?: number;
  endpoint?: string;
  hint?: string;
  details?: unknown;
}

export class CliError extends Error {
  readonly code: ExitCode;
  readonly status?: number;
  readonly endpoint?: string;
  readonly hint?: string;
  readonly details?: unknown;

  constructor(code: ExitCode, message: string, options: CliErrorOptions = {}) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.status = options.status;
    this.endpoint = options.endpoint;
    this.hint = options.hint;
    this.details = options.details;
  }

  toJSON() {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        status: this.status,
        endpoint: this.endpoint,
        hint: this.hint,
        details: this.details,
      },
    };
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readErrorMessage(value: unknown, fallback: string): string {
  if (!isRecord(value)) {
    return fallback;
  }
  const raw = value.error;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  return fallback;
}
