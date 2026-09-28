// shared.ts — pure vocabulary + helpers shared by the worker, the UI, and the
// tests. No SDK, React, DOM, or host imports here: this module must stay
// bundleable into all three targets and unit-testable in isolation.
//
// The plugin's whole job is small and mechanical: for a set of agents, overwrite
// just two keys inside each agent's `adapterConfig` — `model` and `effort` —
// and leave every other key untouched. These helpers encode that contract and
// the curated option vocabulary the UI offers.

// ---------------------------------------------------------------------------
// Curated option vocabulary
// ---------------------------------------------------------------------------
//
// Reasoning models are the bare names; the non-reasoning counterparts carry the
// `-instruct` suffix. Effort maps to the adapter's reasoning-effort setting.
// The table still DISPLAYS whatever value an agent currently has, even if it
// predates or diverges from this list — the curated set only constrains what a
// bulk-apply can SET.

export const MODEL_OPTIONS = [
  "coder",
  "agent",
  "research",
  "coder-instruct",
  "agent-instruct",
  "research-instruct",
] as const;

export type ModelOption = (typeof MODEL_OPTIONS)[number];

export const EFFORT_OPTIONS = ["low", "medium", "high", "xhigh"] as const;

export type EffortOption = (typeof EFFORT_OPTIONS)[number];

// The two adapterConfig keys this plugin is allowed to touch. Everything else
// in adapterConfig is out of scope and preserved by the merge write.
export const MODEL_KEY = "model" as const;
export const EFFORT_KEY = "effort" as const;

// ---------------------------------------------------------------------------
// Roster shapes — the worker's `roster` data handler returns these, the UI
// consumes them. Declared here (not in worker.ts) so both bundles share ONE
// definition and can never drift; the UI must not import worker.ts, which runs
// runWorker() at module load.
// ---------------------------------------------------------------------------

export interface RosterRow {
  id: string;
  name: string;
  role: string | null;
  title: string | null;
  status: string;
  adapterType: string | null;
  /** Current adapterConfig.model, or null when unset. */
  model: string | null;
  /** Current adapterConfig.effort, or null when unset. */
  effort: string | null;
  /** Agent UUID this agent reports to, or null when unset. */
  reportsTo: string | null;
}

export interface RosterData {
  agents: RosterRow[];
  companyName: string | null;
}

/** Statuses an agent can't meaningfully be reconfigured in — excluded from selection. */
export const UNCONFIGURABLE_STATUSES = new Set(["terminated"]);

// ---------------------------------------------------------------------------
// Reading current values off an agent's adapterConfig
// ---------------------------------------------------------------------------

export interface ModelEffort {
  /** Current model, or null when the adapter carries no model key. */
  model: string | null;
  /** Current reasoning effort, or null when unset. */
  effort: string | null;
}

/**
 * Pull the current model + effort out of an agent's adapterConfig. Tolerant of
 * anything: missing keys, non-string values, or a non-object config all
 * degrade to null rather than throwing. Never assumes a particular key exists
 * (the recurring pricing-plugin crash class was exactly this).
 */
export function extractModelEffort(adapterConfig: unknown): ModelEffort {
  if (!adapterConfig || typeof adapterConfig !== "object") {
    return { model: null, effort: null };
  }
  const cfg = adapterConfig as Record<string, unknown>;
  const model = typeof cfg[MODEL_KEY] === "string" ? (cfg[MODEL_KEY] as string) : null;
  const effort = typeof cfg[EFFORT_KEY] === "string" ? (cfg[EFFORT_KEY] as string) : null;
  return { model, effort };
}

// ---------------------------------------------------------------------------
// Building the write payload
// ---------------------------------------------------------------------------

/**
 * A bulk-apply selection: either a concrete value to set, or the sentinel
 * `KEEP` meaning "leave this field as it is on every selected agent." This lets
 * an operator change ONLY model, ONLY effort, or both in one action.
 */
export const KEEP = "__keep__" as const;
export type Keep = typeof KEEP;

export interface ApplySelection {
  model: ModelOption | Keep;
  effort: EffortOption | Keep;
}

/**
 * Build the partial `adapterConfig` to send, containing only the fields the
 * operator chose to change. Returns null when nothing is selected (both KEEP) —
 * callers use that to disable Apply and to no-op an agent.
 */
export function buildAdapterConfigPatch(
  selection: ApplySelection,
): Record<string, string> | null {
  const patch: Record<string, string> = {};
  if (selection.model !== KEEP) patch[MODEL_KEY] = selection.model;
  if (selection.effort !== KEEP) patch[EFFORT_KEY] = selection.effort;
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * The full request body for `PATCH /api/agents/:id`. `replaceAdapterConfig:
 * false` is the load-bearing flag — it makes the host MERGE the supplied keys
 * into the existing adapterConfig instead of replacing the whole object, so the
 * other ~11 keys (instructions paths, skill sync, turn limits…) survive.
 */
export interface AgentPatchBody {
  adapterConfig: Record<string, string>;
  replaceAdapterConfig: false;
}

export function buildAgentPatchBody(
  patch: Record<string, string>,
): AgentPatchBody {
  return { adapterConfig: patch, replaceAdapterConfig: false };
}

/** The origin-relative host route for updating a single agent. */
export function agentPatchUrl(agentId: string): string {
  return `/api/agents/${encodeURIComponent(agentId)}`;
}

// ---------------------------------------------------------------------------
// Summarising a selection for the Apply button / confirmation copy
// ---------------------------------------------------------------------------

/** Human-readable summary of what a bulk-apply will change. */
export function describeSelection(selection: ApplySelection): string {
  const parts: string[] = [];
  if (selection.model !== KEEP) parts.push(`model → ${selection.model}`);
  if (selection.effort !== KEEP) parts.push(`effort → ${selection.effort}`);
  return parts.length > 0 ? parts.join(", ") : "no changes";
}

// ---------------------------------------------------------------------------
// ReportsTo patch
// ---------------------------------------------------------------------------

/** Sentinel meaning "leave reportsTo unchanged". */
export const KEEP_REPORTS_TO = "__keep_reports_to__" as const;
export type KeepReportsTo = typeof KEEP_REPORTS_TO;

/** Sentinel meaning "clear the reportsTo relationship". */
export const CLEAR_REPORTS_TO = "__clear_reports_to__" as const;
export type ClearReportsTo = typeof CLEAR_REPORTS_TO;

export type ReportsToSelection = string | KeepReportsTo | ClearReportsTo;

/**
 * Build the reportsTo patch body. Pass null to clear, a UUID to set.
 * Returns null when selection is KEEP_REPORTS_TO (no-op).
 */
export function buildReportsToPatch(
  selection: ReportsToSelection,
): { reportsTo: string | null } | null {
  if (selection === KEEP_REPORTS_TO) return null;
  return { reportsTo: selection === CLEAR_REPORTS_TO ? null : selection };
}
