import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

function candidateEnvFiles(): string[] {
  const cwd = process.cwd();
  const byCwd = [
    resolve(cwd, ".env"),
    resolve(cwd, "../.env"),
    resolve(cwd, "../../.env"),
    resolve(cwd, "../../../.env"),
  ];

  const byModule = [
    resolve(__dirname, "../.env"),
    resolve(__dirname, "../../.env"),
    resolve(__dirname, "../../../.env"),
  ];

  return Array.from(new Set([...byCwd, ...byModule]));
}

export function bootstrapEnvFromDotenv(): void {
  for (const filePath of candidateEnvFiles()) {
    if (!existsSync(filePath)) {
      continue;
    }
    loadDotenv({
      path: filePath,
      override: false,
    });
  }
}
