#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";

import {
  executeArchiveAnalysisCommand,
  executeArchiveItemCommand,
  executeArchiveListCommand,
} from "./commands/archive";
import { executeHealthCommand } from "./commands/health";
import { executeStatsSourcesCommand, executeStatsTypesCommand } from "./commands/stats";
import { executeTriggerCommand } from "./commands/trigger";
import { bootstrapEnvFromDotenv } from "./env";
import { CliError } from "./errors";
import { printCommandResult } from "./output";

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(`invalid positive integer: ${value}`);
  }
  return parsed;
}

function addCommonOptions(command: Command): Command {
  return command
    .option("--base-url <url>", "AI News 服务地址（可替代 AI_NEWS_BASE_URL）")
    .option("--timeout-ms <ms>", "请求超时（毫秒，默认 15000）", parsePositiveInt)
    .option("--json", "JSON 输出");
}

function addDaysOption(command: Command): Command {
  return command.option("--days <days>", "天数窗口", parsePositiveInt);
}

async function run() {
  bootstrapEnvFromDotenv();

  const program = new Command();
  program
    .name("ai-news")
    .description("AI News 运维 CLI（触发日报、归档、统计、健康检查）")
    .version("0.1.0");

  addCommonOptions(
    program
      .command("trigger")
      .description("触发一次日报生成（/api/cron_digest）")
      .option("--token <secret>", "CRON token（可替代 AI_NEWS_CRON_SECRET）")
      .option("--date <YYYY-MM-DD>", "目标日期")
      .option("--top-n <n>", "top_n 参数", parsePositiveInt)
      .option("--max-eval-articles <n>", "max_eval_articles 参数", parsePositiveInt)
      .option("--archive-analysis", "触发时写入分析归档（archive_analysis=1）")
      .option("--ignore-repeat-limit", "忽略重复阈值（高风险，需 --force）")
      .option("--force", "确认执行高风险参数")
      .action(async (options) => {
        const result = await executeTriggerCommand(options);
        printCommandResult(result, Boolean(options.json));
      }),
  );

  const archive = program.command("archive").description("归档查询");
  addCommonOptions(
    addDaysOption(
      archive
        .command("list")
        .description("查询归档列表（/api/archive）")
        .option("--limit-per-day <n>", "每日返回上限", parsePositiveInt)
        .action(async (options) => {
          const result = await executeArchiveListCommand(options);
          printCommandResult(result, Boolean(options.json));
        }),
    ),
  );
  addCommonOptions(
    archive
      .command("item")
      .description("读取日报正文（/api/archive_item）")
      .requiredOption("--id <digest_id>", "digest_id")
      .option("--raw-markdown", "仅输出 markdown 正文")
      .action(async (options) => {
        const result = await executeArchiveItemCommand(options);
        printCommandResult(result, Boolean(options.json));
      }),
  );
  addCommonOptions(
    archive
      .command("analysis")
      .description("读取分析报告（/api/archive_analysis）")
      .requiredOption("--id <digest_id>", "digest_id")
      .option("--raw-markdown", "仅输出 analysis markdown")
      .action(async (options) => {
        const result = await executeArchiveAnalysisCommand(options);
        printCommandResult(result, Boolean(options.json));
      }),
  );

  const stats = program.command("stats").description("消费统计查询");
  addCommonOptions(
    addDaysOption(
      stats
        .command("sources")
        .description("读取 source 维度统计（/api/stats/sources）")
        .option("--tracker-token <token>", "TRACKER token（可替代 AI_NEWS_TRACKER_TOKEN）")
        .action(async (options) => {
          const result = await executeStatsSourcesCommand(options);
          printCommandResult(result, Boolean(options.json));
        }),
    ),
  );
  addCommonOptions(
    addDaysOption(
      stats
        .command("types")
        .description("读取 type 维度统计（/api/stats/types）")
        .option("--tracker-token <token>", "TRACKER token（可替代 AI_NEWS_TRACKER_TOKEN）")
        .action(async (options) => {
          const result = await executeStatsTypesCommand(options);
          printCommandResult(result, Boolean(options.json));
        }),
    ),
  );

  addCommonOptions(
    program
      .command("health")
      .description("健康检查（/api/healthz）")
      .action(async (options) => {
        const result = await executeHealthCommand(options);
        printCommandResult(result, Boolean(options.json));
      }),
  );

  await program.parseAsync(process.argv);
}

function printError(error: unknown): void {
  const jsonMode = process.argv.includes("--json");
  if (error instanceof CliError) {
    if (jsonMode) {
      process.stderr.write(`${JSON.stringify(error.toJSON(), null, 2)}\n`);
    } else {
      process.stderr.write(`Error: ${error.message}\n`);
      if (error.hint) {
        process.stderr.write(`Hint: ${error.hint}\n`);
      }
      if (error.endpoint) {
        process.stderr.write(`Endpoint: ${error.endpoint}\n`);
      }
    }
    process.exit(error.code);
  }

  if (error instanceof Error) {
    if (jsonMode) {
      process.stderr.write(
        `${JSON.stringify({ ok: false, error: { code: 1, message: error.message } }, null, 2)}\n`,
      );
    } else {
      process.stderr.write(`Error: ${error.message}\n`);
    }
    process.exit(1);
  }

  if (jsonMode) {
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: { code: 1, message: String(error) } }, null, 2)}\n`,
    );
  } else {
    process.stderr.write(`Error: ${String(error)}\n`);
  }
  process.exit(1);
}

run().catch(printError);
