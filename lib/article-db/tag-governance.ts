import { DeepSeekClient } from "@/lib/llm/deepseek-client";
import {
  createTagGovernanceRun,
  deactivateTagDefinition,
  finishTagGovernanceRun,
  getTagDefinition,
  getTagGovernanceObjective,
  listTagGovernanceFeedbackStats,
  listTagGroups,
  listTagUsageStats,
  replaceTagInAnalysisTagGroups,
  upsertTagDefinition,
} from "@/lib/article-db/repository";
import { TagDefinition, TagGovernanceAction } from "@/lib/article-db/types";

const VALID_ACTION_TYPES = new Set<TagGovernanceAction["type"]>([
  "create_canonical",
  "update_tag",
  "add_alias",
  "merge",
  "deprecate",
  "reactivate",
]);

const DEFAULT_GOVERNANCE_OBJECTIVE: Record<string, unknown> = {
  mission: "Maintain a high-signal, low-duplication tag system optimized for downstream retrieval.",
  principles: [
    "ai_first",
    "prefer_reuse_over_creation",
    "maximize_semantic_distinctiveness",
    "preserve_backward_compatibility_via_aliases",
  ],
  north_star_metrics: [
    "tag_reuse_ratio",
    "duplicate_tag_rate",
    "retrieval_hit_rate",
    "new_tag_survival_rate_30d",
  ],
  action_budget: {
    max_actions_per_run: 12,
  },
};

function normalizeTagKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseAliases(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((item) => normalizeTagKey(String(item || "")))
        .filter(Boolean),
    ),
  );
}

function parseAction(raw: unknown): TagGovernanceAction | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const type = String(row.type || "").trim() as TagGovernanceAction["type"];
  if (!VALID_ACTION_TYPES.has(type)) {
    return null;
  }
  const groupKey = normalizeTagKey(String(row.group_key || row.group || ""));
  const tagKey = normalizeTagKey(String(row.tag_key || row.tag || ""));
  if (!groupKey || !tagKey) {
    return null;
  }
  const targetTagKey = normalizeTagKey(String(row.target_tag_key || row.target || ""));
  const managedBy = String(row.managed_by || "ai_governance").trim() || "ai_governance";
  const confidence = Number(row.confidence);

  return {
    type,
    group_key: groupKey,
    tag_key: tagKey,
    target_tag_key: targetTagKey || undefined,
    display_name: String(row.display_name || "").trim() || undefined,
    description: String(row.description || "").trim() || undefined,
    aliases: parseAliases(row.aliases),
    managed_by: managedBy,
    reason: String(row.reason || "").trim() || undefined,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : undefined,
  };
}

function parseActions(raw: unknown): TagGovernanceAction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => parseAction(item))
    .filter((item): item is TagGovernanceAction => Boolean(item));
}

function mergeObject(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = { ...base };
  Object.entries(override || {}).forEach(([key, value]) => {
    const current = output[key];
    if (
      current &&
      value &&
      typeof current === "object" &&
      typeof value === "object" &&
      !Array.isArray(current) &&
      !Array.isArray(value)
    ) {
      output[key] = mergeObject(current as Record<string, unknown>, value as Record<string, unknown>);
      return;
    }
    output[key] = value;
  });
  return output;
}

function unionAliases(...arrays: Array<string[] | undefined>): string[] {
  return Array.from(
    new Set(
      arrays
        .flat()
        .map((item) => normalizeTagKey(String(item || "")))
        .filter(Boolean),
    ),
  );
}

async function upsertWithExisting(params: {
  groupKey: string;
  tagKey: string;
  managedBy: string;
  displayName?: string;
  description?: string;
  aliases?: string[];
  isActive?: boolean;
}): Promise<TagDefinition | null> {
  const existing = await getTagDefinition(params.groupKey, params.tagKey);
  await upsertTagDefinition({
    groupKey: params.groupKey,
    tagKey: params.tagKey,
    displayName: params.displayName || existing?.display_name || params.tagKey,
    description: params.description !== undefined ? params.description : existing?.description || "",
    aliases:
      params.aliases !== undefined ? unionAliases(params.aliases) : unionAliases(existing?.aliases || []),
    isActive: params.isActive !== undefined ? params.isActive : existing?.is_active ?? true,
    managedBy: params.managedBy,
  });
  return getTagDefinition(params.groupKey, params.tagKey);
}

async function applyAction(action: TagGovernanceAction): Promise<Record<string, unknown>> {
  const managedBy = String(action.managed_by || "ai_governance").trim() || "ai_governance";
  const groupKey = normalizeTagKey(action.group_key);
  const tagKey = normalizeTagKey(action.tag_key);

  if (!groupKey || !tagKey) {
    return { ok: false, action, error: "invalid_group_or_tag" };
  }

  if (action.type === "create_canonical" || action.type === "update_tag") {
    const row = await upsertWithExisting({
      groupKey,
      tagKey,
      managedBy,
      displayName: action.display_name,
      description: action.description,
      aliases: action.aliases,
      isActive: true,
    });
    return { ok: true, action, result: row };
  }

  if (action.type === "add_alias") {
    const existing = await getTagDefinition(groupKey, tagKey);
    const aliases = unionAliases(existing?.aliases || [], action.aliases || []);
    const row = await upsertWithExisting({
      groupKey,
      tagKey,
      managedBy,
      displayName: action.display_name || existing?.display_name || tagKey,
      description: action.description !== undefined ? action.description : existing?.description || "",
      aliases,
      isActive: existing?.is_active ?? true,
    });
    return { ok: true, action, result: row };
  }

  if (action.type === "deprecate") {
    const row = await upsertWithExisting({
      groupKey,
      tagKey,
      managedBy,
      displayName: action.display_name,
      description: action.description,
      aliases: action.aliases,
      isActive: false,
    });
    return { ok: true, action, result: row };
  }

  if (action.type === "reactivate") {
    const row = await upsertWithExisting({
      groupKey,
      tagKey,
      managedBy,
      displayName: action.display_name,
      description: action.description,
      aliases: action.aliases,
      isActive: true,
    });
    return { ok: true, action, result: row };
  }

  if (action.type === "merge") {
    const targetTag = normalizeTagKey(String(action.target_tag_key || ""));
    if (!targetTag || targetTag === tagKey) {
      return { ok: false, action, error: "invalid_target_tag" };
    }

    const source = await getTagDefinition(groupKey, tagKey);
    const target = await getTagDefinition(groupKey, targetTag);
    const targetAliases = unionAliases(
      target?.aliases || [],
      source?.aliases || [],
      [tagKey],
      action.aliases || [],
    );

    const merged = await upsertWithExisting({
      groupKey,
      tagKey: targetTag,
      managedBy,
      displayName: action.display_name || target?.display_name || targetTag,
      description: action.description !== undefined ? action.description : target?.description || "",
      aliases: targetAliases,
      isActive: true,
    });

    const replacedCount = await replaceTagInAnalysisTagGroups(groupKey, tagKey, targetTag);
    const deactivated = await deactivateTagDefinition(groupKey, tagKey);

    return {
      ok: true,
      action,
      result: {
        merged_target: merged,
        source_deactivated: deactivated,
        replaced_analysis_rows: replacedCount,
      },
    };
  }

  return { ok: false, action, error: "unsupported_action_type" };
}

async function planActionsWithAi(params: {
  client: DeepSeekClient;
  objective: Record<string, unknown>;
  context: Record<string, unknown>;
  maxActions: number;
  extraContext?: string;
}): Promise<Record<string, unknown>> {
  const systemPrompt =
    "You are the planner AI for tag governance. " +
    "Follow the provided objectives and context. " +
    "Output JSON only with keys: summary, actions. " +
    "actions must be an array of action objects with fields: " +
    "type, group_key, tag_key, optional target_tag_key, display_name, description, aliases, managed_by, reason, confidence. " +
    "Allowed type values: create_canonical, update_tag, add_alias, merge, deprecate, reactivate.";

  return params.client.chatJson(
    [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          objective: params.objective,
          context: params.context,
          max_actions: params.maxActions,
          extra_context: params.extraContext || "",
        }),
      },
    ],
    0.2,
  );
}

async function reviewActionsWithAi(params: {
  client: DeepSeekClient;
  objective: Record<string, unknown>;
  context: Record<string, unknown>;
  plannedActions: TagGovernanceAction[];
}): Promise<Record<string, unknown>> {
  const systemPrompt =
    "You are the critic AI for tag governance. " +
    "Evaluate planner actions against objective and context. " +
    "Output JSON only with keys: summary, final_actions, rejected. " +
    "final_actions must use allowed type values: create_canonical, update_tag, add_alias, merge, deprecate, reactivate. " +
    "rejected must be an array of {index, reason}.";

  return params.client.chatJson(
    [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          objective: params.objective,
          context: params.context,
          planned_actions: params.plannedActions,
        }),
      },
    ],
    0.1,
  );
}

export interface RunTagGovernanceOptions {
  objectiveId?: string;
  dryRun?: boolean;
  lookbackDays?: number;
  maxActions?: number;
  sampleLimit?: number;
  focusGroups?: string[];
  extraContext?: string;
  candidateActions?: unknown;
}

export interface RunTagGovernanceResult {
  ok: boolean;
  runId: string;
  objectiveId: string;
  dryRun: boolean;
  context: Record<string, unknown>;
  plannedActions: TagGovernanceAction[];
  finalActions: TagGovernanceAction[];
  applied: Array<Record<string, unknown>>;
  planner: Record<string, unknown>;
  critic: Record<string, unknown>;
}

export async function runTagGovernance(options: RunTagGovernanceOptions = {}): Promise<RunTagGovernanceResult> {
  const objectiveId = String(options.objectiveId || "default").trim() || "default";
  const dryRun = options.dryRun !== undefined ? Boolean(options.dryRun) : true;
  const lookbackDays = Math.max(1, Math.min(180, Math.trunc(options.lookbackDays || 30)));
  const maxActions = Math.max(1, Math.min(40, Math.trunc(options.maxActions || 12)));
  const sampleLimit = Math.max(100, Math.min(5000, Math.trunc(options.sampleLimit || 800)));
  const focusGroups = Array.from(
    new Set((options.focusGroups || []).map((item) => normalizeTagKey(item)).filter(Boolean)),
  );

  const objectiveRow = await getTagGovernanceObjective(objectiveId);
  const objective = mergeObject(DEFAULT_GOVERNANCE_OBJECTIVE, objectiveRow.config_json || {});

  const runId = await createTagGovernanceRun({
    objectiveId,
    dryRun,
    requestJson: {
      lookback_days: lookbackDays,
      max_actions: maxActions,
      sample_limit: sampleLimit,
      focus_groups: focusGroups,
      extra_context: options.extraContext || "",
      candidate_actions_provided: Array.isArray(options.candidateActions),
    },
  });

  let context: Record<string, unknown> = {};
  let planner: Record<string, unknown> = {};
  let critic: Record<string, unknown> = {};
  let plannedActions: TagGovernanceAction[] = [];
  let finalActions: TagGovernanceAction[] = [];
  let applied: Array<Record<string, unknown>> = [];

  try {
    const [dictionary, usageStats, feedbackStats] = await Promise.all([
      listTagGroups(),
      listTagUsageStats({
        lookbackDays,
        groupKeys: focusGroups.length ? focusGroups : undefined,
        limit: sampleLimit,
      }),
      listTagGovernanceFeedbackStats({
        objectiveId,
        days: lookbackDays,
        limit: sampleLimit,
      }),
    ]);

    context = {
      generated_at: new Date().toISOString(),
      lookback_days: lookbackDays,
      focus_groups: focusGroups,
      dictionary,
      usage_stats: usageStats,
      feedback_stats: feedbackStats,
    };

    const externalActions = parseActions(options.candidateActions);
    if (externalActions.length) {
      planner = {
        source: "external_candidate_actions",
        summary: "Using externally provided candidate actions.",
        actions: externalActions,
      };
      plannedActions = externalActions.slice(0, maxActions);
    } else {
      const client = new DeepSeekClient();
      planner = await planActionsWithAi({
        client,
        objective,
        context,
        maxActions,
        extraContext: options.extraContext,
      });
      plannedActions = parseActions(planner.actions).slice(0, maxActions);
    }

    const criticClient = new DeepSeekClient();
    critic = await reviewActionsWithAi({
      client: criticClient,
      objective,
      context,
      plannedActions,
    });
    const reviewed = parseActions(critic.final_actions);
    finalActions = (reviewed.length ? reviewed : plannedActions).slice(0, maxActions);

    if (!dryRun) {
      for (const action of finalActions) {
        const item = await applyAction(action);
        applied.push(item);
      }
    } else {
      applied = finalActions.map((action) => ({ ok: true, preview: true, action }));
    }

    await finishTagGovernanceRun({
      runId,
      status: "success",
      contextJson: context,
      plannerJson: planner,
      criticJson: critic,
      appliedJson: {
        dry_run: dryRun,
        actions: applied,
      },
    });

    return {
      ok: true,
      runId,
      objectiveId,
      dryRun,
      context,
      plannedActions,
      finalActions,
      applied,
      planner,
      critic,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishTagGovernanceRun({
      runId,
      status: "failed",
      contextJson: context,
      plannerJson: planner,
      criticJson: critic,
      appliedJson: {
        dry_run: dryRun,
        actions: applied,
      },
      errorMessage: message,
    });
    throw error;
  }
}
