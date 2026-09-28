// shared.ts — pure vocabulary + helpers shared by the worker, the UI, and the
// tests. No SDK, React, DOM, or host imports here: this module must stay
// bundleable into all three targets and unit-testable in isolation.
//
// The plugin's whole job is small and mechanical: for a set of agents, overwrite
// just two keys inside each agent's `adapterConfig` — `model` and `effort` —
// and leave every other key untouched, and optionally set the top-level `role`.
// These helpers encode that contract and the curated option vocabulary the UI offers.

// ---------------------------------------------------------------------------
// Curated option vocabulary
// ---------------------------------------------------------------------------

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

export const ROLE_OPTIONS = [
  "ceo",
  "cto",
  "cmo",
  "cfo",
  "security",
  "engineer",
  "designer",
  "pm",
  "qa",
  "devops",
  "researcher",
  "general",
] as const;

export type AgentRole = (typeof ROLE_OPTIONS)[number];

// The two adapterConfig keys this plugin is allowed to touch. Everything else
// in adapterConfig is out of scope and preserved by the merge write.
export const MODEL_KEY = "model" as const;
export const EFFORT_KEY = "effort" as const;

/** Max length enforced by the API for the capabilities field. */
export const CAPABILITIES_MAX_LENGTH = 2000;

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
  /** Current top-level capabilities string, or null when unset. */
  capabilities: string | null;
  /** Current desiredSkills, normalized to string keys. */
  desiredSkills: string[];
  /** Agent UUID this agent reports to, or null when unset. */
  reportsTo: string | null;
  /** Current budgetMonthlyCents, or null when unset. */
  budgetMonthlyCents: number | null;
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
 * degrade to null rather than throwing.
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
 * `KEEP` meaning "leave this field as it is on every selected agent."
 */
export const KEEP = "__keep__" as const;
export type Keep = typeof KEEP;

export interface ApplySelection {
  model: ModelOption | Keep;
  effort: EffortOption | Keep;
  role: AgentRole | Keep;
}

/**
 * Build the partial `adapterConfig` to send, containing only the fields the
 * operator chose to change. Returns null when nothing is selected (both KEEP).
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
 * Build the `{ role }` patch for a top-level role change. Returns null when
 * role is KEEP.
 */
export function buildRolePatch(role: AgentRole | Keep): { role: AgentRole } | null {
  return role !== KEEP ? { role } : null;
}

/**
 * The full request body for `PATCH /api/agents/:id`. `replaceAdapterConfig:
 * false` is the load-bearing flag — it makes the host MERGE the supplied keys
 * into the existing adapterConfig instead of replacing the whole object.
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

/**
 * Build the PATCH body for updating the top-level capabilities field.
 * No replaceAdapterConfig flag needed — capabilities is not inside adapterConfig.
 */
export function buildCapabilitiesPatch(capabilities: string): { capabilities: string } {
  return { capabilities };
}

// ---------------------------------------------------------------------------
// Skills delta — add/remove semantics for desiredSkills bulk-edit
// ---------------------------------------------------------------------------

export interface SkillsDelta {
  add: string[];
  remove: string[];
}

/**
 * Apply an add/remove delta to an agent's current skill list.
 * Preserves skills not mentioned in the delta; deduplicates the result.
 */
export function applySkillsDelta(current: string[], delta: SkillsDelta): string[] {
  const set = new Set(current);
  for (const k of delta.add) set.add(k);
  for (const k of delta.remove) set.delete(k);
  return Array.from(set);
}

/** Build the PATCH body fragment for a desiredSkills update. */
export function buildSkillsPatch(mergedSkills: string[]): { desiredSkills: string[] } {
  return { desiredSkills: mergedSkills };
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

// ---------------------------------------------------------------------------
// Budget helpers
// ---------------------------------------------------------------------------

/** Convert a dollar amount (user input) to integer cents for the API. */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Build the patch body for updating budgetMonthlyCents. */
export function buildBudgetPatch(budgetMonthlyCents: number): { budgetMonthlyCents: number } {
  return { budgetMonthlyCents };
}

// ---------------------------------------------------------------------------
// Summarising a selection for the Apply button / confirmation copy
// ---------------------------------------------------------------------------

/** Human-readable summary of what a bulk-apply will change. */
export function describeSelection(selection: ApplySelection): string {
  const parts: string[] = [];
  if (selection.model !== KEEP) parts.push(`model → ${selection.model}`);
  if (selection.effort !== KEEP) parts.push(`effort → ${selection.effort}`);
  if (selection.role !== KEEP) parts.push(`role → ${selection.role}`);
  return parts.length > 0 ? parts.join(", ") : "no changes";
}
