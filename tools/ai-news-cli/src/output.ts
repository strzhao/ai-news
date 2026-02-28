import pc from "picocolors";

export interface CommandResult {
  payload: unknown;
  lines?: string[];
  rawText?: string;
}

export function printCommandResult(result: CommandResult, jsonMode: boolean): void {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(result.payload, null, 2)}\n`);
    return;
  }
  if (typeof result.rawText === "string") {
    if (result.rawText.length === 0) {
      return;
    }
    process.stdout.write(result.rawText.endsWith("\n") ? result.rawText : `${result.rawText}\n`);
    return;
  }
  const lines = result.lines || [];
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
}

export function printSuccessLine(text: string): string {
  return `${pc.green("✔")} ${text}`;
}

export function printWarnLine(text: string): string {
  return `${pc.yellow("!")} ${text}`;
}
