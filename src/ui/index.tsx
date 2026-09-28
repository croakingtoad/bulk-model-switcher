import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useHostContext,
  useHostNavigation,
  usePluginData,
  usePluginToast,
} from "@paperclipai/plugin-sdk/ui";
import {
  MODEL_OPTIONS,
  EFFORT_OPTIONS,
  ROLE_OPTIONS,
  KEEP,
  KEEP_REPORTS_TO,
  CLEAR_REPORTS_TO,
  UNCONFIGURABLE_STATUSES,
  CAPABILITIES_MAX_LENGTH,
  buildAdapterConfigPatch,
  buildRolePatch,
  buildCapabilitiesPatch,
  buildReportsToPatch,
  buildBudgetPatch,
  dollarsToCents,
  applySkillsDelta,
  agentPatchUrl,
  describeSelection,
  type ApplySelection,
  type EffortOption,
  type ModelOption,
  type AgentRole,
  type ReportsToSelection,
  type SkillsDelta,
  type RosterData,
  type RosterRow,
} from "../shared.js";

// -----------------------------------------------------------------------------
// Bulk Model Switcher — plugin UI (single page export: ModelSwitcherPage).
//
// Mounts at /:companyPrefix/bulk-model-switcher. Multiselect any set of the
// company's agents and set their model, reasoning effort, role, reports-to,
// budget, skills, and/or capabilities in one action.
//
// Read  path: usePluginData("roster") ← worker's ctx.agents.list.
// Write path: same-origin `PATCH /api/agents/:id` from THIS page, riding the
//   operator's existing board session (credentials: same-origin). The plugin
//   page is trusted, same-origin host code, so no capability and NO stored
//   secret are involved. `replaceAdapterConfig: false` merges the two keys we
//   set and preserves every other adapterConfig field.
//
// Theme: reference the host's shadcn-style CSS variables directly
// (var(--background), var(--card), var(--border), var(--foreground),
// var(--muted-foreground), var(--primary), var(--destructive)). The plugin
// subtree inherits the host's light/dark class for free — no plugin palette.
// -----------------------------------------------------------------------------

const PAGE_HREF = "/bulk-model-switcher";

// ---- Error helper -----------------------------------------------------------

async function readErrorMessage(res: Response): Promise<string> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    return `HTTP ${res.status}`;
  }
  if (!text) return `HTTP ${res.status}`;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      if (typeof o.message === "string") return o.message;
      if (typeof o.error === "string") return o.error;
    }
    if (typeof parsed === "string" && parsed) return parsed;
  } catch {
    /* not JSON */
  }
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

// ---- Per-agent apply result -------------------------------------------------

type ApplyResult = { ok: true } | { ok: false; error: string };

// ---- Styles (host CSS variables) --------------------------------------------

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const styles = {
  page: {
    padding: 24,
    fontFamily: FONT,
    color: "var(--foreground)",
    maxWidth: 1040,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column" as const,
    gap: 20,
  } as React.CSSProperties,
  card: {
    border: "1px solid var(--border)",
    borderRadius: 12,
    background: "var(--card)",
    color: "var(--foreground)",
    padding: 20,
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    margin: 0,
    color: "var(--foreground)",
  } as React.CSSProperties,
  muted: {
    fontSize: 12,
    color: "var(--muted-foreground)",
    margin: 0,
  } as React.CSSProperties,
  toolbar: {
    display: "flex",
    alignItems: "flex-end",
    gap: 16,
    flexWrap: "wrap" as const,
  } as React.CSSProperties,
  field: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    minWidth: 160,
  } as React.CSSProperties,
  label: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    color: "var(--muted-foreground)",
  } as React.CSSProperties,
  select: {
    width: "100%",
    padding: "8px 34px 8px 10px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--background)",
    color: "var(--foreground)",
    fontSize: 13,
    fontFamily: FONT,
    cursor: "pointer",
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
  } as React.CSSProperties,
  multiSelect: {
    width: "100%",
    height: 80,
    padding: "2px 6px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--background)",
    color: "var(--foreground)",
    fontSize: 13,
    fontFamily: FONT,
    cursor: "pointer",
  } as React.CSSProperties,
  input: {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--background)",
    color: "var(--foreground)",
    fontSize: 13,
    fontFamily: FONT,
    boxSizing: "border-box" as const,
  } as React.CSSProperties,
  textarea: {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--background)",
    color: "var(--foreground)",
    fontSize: 13,
    fontFamily: FONT,
    resize: "vertical" as const,
    minHeight: 72,
    boxSizing: "border-box" as const,
  } as React.CSSProperties,
  applyButton: {
    padding: "10px 18px",
    border: "1px solid var(--primary)",
    borderRadius: 10,
    background: "var(--primary)",
    color: "var(--primary-foreground)",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 700,
    fontFamily: FONT,
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
  cancelButton: {
    padding: "10px 14px",
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--background)",
    color: "var(--foreground)",
    cursor: "pointer",
    fontSize: 13,
    fontFamily: FONT,
  } as React.CSSProperties,
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 13,
    color: "var(--foreground)",
  } as React.CSSProperties,
  th: {
    textAlign: "left" as const,
    padding: "8px 10px",
    borderBottom: "1px solid var(--border)",
    color: "var(--muted-foreground)",
    fontWeight: 600,
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
  td: {
    padding: "8px 10px",
    borderBottom: "1px solid var(--border)",
    color: "var(--foreground)",
    verticalAlign: "middle" as const,
  } as React.CSSProperties,
  code: {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 12,
    padding: "2px 6px",
    borderRadius: 6,
    background: "var(--muted)",
    color: "var(--foreground)",
  } as React.CSSProperties,
  skeleton: {
    background: "var(--muted)",
    borderRadius: 8,
    height: 20,
    width: "100%",
    opacity: 0.6,
  } as React.CSSProperties,
  pill: {
    fontSize: 11,
    fontWeight: 600,
    padding: "1px 8px",
    borderRadius: 999,
    border: "1px solid var(--border)",
    color: "var(--muted-foreground)",
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
};

// ---- Small display helpers --------------------------------------------------

function fmtValue(value: string | null): React.ReactNode {
  if (!value) return <span style={{ color: "var(--muted-foreground)" }}>—</span>;
  return <span style={styles.code}>{value}</span>;
}

function fmtCapabilities(value: string | null): React.ReactNode {
  if (!value) return <span style={{ color: "var(--muted-foreground)" }}>—</span>;
  const truncated = value.length > 60 ? `${value.slice(0, 60)}…` : value;
  return (
    <span style={{ cursor: "default" }} title={value}>
      {truncated}
    </span>
  );
}

function fmtBudget(cents: number | null): React.ReactNode {
  if (cents === null) return <span style={{ color: "var(--muted-foreground)" }}>—</span>;
  return <span style={styles.code}>${(cents / 100).toFixed(2)}/mo</span>;
}

function roleLabel(row: RosterRow): string | null {
  if (row.title) return row.title;
  if (row.role) return row.role.toUpperCase();
  return null;
}

function HatGlassesIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flex: "0 0 auto" }}
    >
      <path d="M14 18a2 2 0 0 0-4 0" />
      <path d="m19 11-2.11-6.657a2 2 0 0 0-2.752-1.148l-1.276.61A2 2 0 0 1 12 4H8.5a2 2 0 0 0-1.925 1.456L5 11" />
      <path d="M2 11h20" />
      <circle cx="17" cy="18" r="3" />
      <circle cx="7" cy="18" r="3" />
    </svg>
  );
}

const HOST_NAV_LINK_CLASS =
  "flex items-center gap-2.5 mx-2 rounded-lg px-2 py-1.5 pointer-coarse:py-1 " +
  "text-(length:--text-compact) font-medium text-muted-foreground transition-colors " +
  "hover:bg-accent/50 hover:text-foreground";

// =============================================================================
// ModelSwitcherSidebar
// =============================================================================
export function ModelSwitcherSidebar(): JSX.Element {
  const nav = useHostNavigation();
  const pageLink = nav.linkProps(PAGE_HREF);
  const linkRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    const link = linkRef.current;
    if (!link) return;
    const originalWrapper = link.parentElement;
    let cancelled = false;

    const place = () => {
      if (cancelled) return;
      const seeAll = document.querySelector<HTMLAnchorElement>('a[href$="/agents/all"]');
      if (!seeAll || !seeAll.parentElement) return;
      if (seeAll.nextElementSibling === link) return;
      seeAll.parentElement.insertBefore(link, seeAll.nextSibling);
      if (
        originalWrapper &&
        originalWrapper !== seeAll.parentElement &&
        originalWrapper.childElementCount === 0
      ) {
        originalWrapper.style.display = "none";
      }
    };

    place();
    const navEl = document.querySelector("nav") ?? document.body;
    const obs = new MutationObserver(() => place());
    obs.observe(navEl, { childList: true, subtree: true });
    return () => {
      cancelled = true;
      obs.disconnect();
    };
  }, []);

  return (
    <a
      {...pageLink}
      ref={linkRef}
      className={HOST_NAV_LINK_CLASS}
      style={{ textDecoration: "none" }}
      title="Bulk-set agents' model, effort, and other fields"
    >
      <HatGlassesIcon />
      Bulk Model Switcher
    </a>
  );
}

// =============================================================================
// ModelSwitcherSettings
// =============================================================================
export function ModelSwitcherSettings(): JSX.Element {
  const nav = useHostNavigation();
  const pageLink = nav.linkProps(PAGE_HREF);
  return (
    <div style={{ ...styles.card, display: "flex", flexDirection: "column", gap: 12, maxWidth: 640 }}>
      <h2 style={styles.sectionTitle}>Bulk Model Switcher</h2>
      <p style={{ ...styles.muted, lineHeight: 1.5 }}>
        There's nothing to configure here. Bulk Model Switcher lives on its own
        page, where you can multiselect this company's agents and set their model,
        reasoning effort, and other agent fields in one action. Every other adapter
        setting is preserved, and the adapter type is never changed.
      </p>
      <div>
        <a
          {...pageLink}
          style={{
            ...styles.applyButton,
            display: "inline-block",
            textDecoration: "none",
          }}
        >
          Open Bulk Model Switcher →
        </a>
      </div>
      <p style={{ ...styles.muted, fontSize: 11 }}>
        Also reachable any time at{" "}
        <code style={styles.code}>/&lt;company&gt;/bulk-model-switcher</code>.
      </p>
    </div>
  );
}

function ChevronSelect(props: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={{ position: "relative", display: "flex" }}>
      <select
        id={props.id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        style={styles.select}
      >
        {props.children}
      </select>
      <span
        aria-hidden
        style={{
          position: "absolute",
          right: 10,
          top: "50%",
          transform: "translateY(-50%)",
          display: "flex",
          pointerEvents: "none",
          color: "var(--muted-foreground)",
        }}
      >
        <svg
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
    </div>
  );
}

// =============================================================================
// ModelSwitcherPage
// =============================================================================
export function ModelSwitcherPage(): JSX.Element {
  const host = useHostContext();
  const companyId = host?.companyId ?? "";
  const toast = usePluginToast();

  const roster = usePluginData<RosterData>("roster", { companyId });
  const agents = useMemo(() => roster.data?.agents ?? [], [roster.data]);
  const companyName = roster.data?.companyName ?? null;
  const loading = roster.loading && !roster.data;

  const selectable = useMemo(
    () => agents.filter((a) => !UNCONFIGURABLE_STATUSES.has(a.status)),
    [agents],
  );
  const selectableIds = useMemo(
    () => new Set(selectable.map((a) => a.id)),
    [selectable],
  );

  // Main toolbar state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [model, setModel] = useState<ModelOption | typeof KEEP>(KEEP);
  const [effort, setEffort] = useState<EffortOption | typeof KEEP>(KEEP);
  const [role, setRole] = useState<AgentRole | typeof KEEP>(KEEP);
  const [reportsTo, setReportsTo] = useState<ReportsToSelection>(KEEP_REPORTS_TO);
  const [budget, setBudget] = useState<string>("");

  // Skills state
  const [availableSkillKeys, setAvailableSkillKeys] = useState<string[]>([]);
  const [skillsToAdd, setSkillsToAdd] = useState<string[]>([]);
  const [skillsToRemove, setSkillsToRemove] = useState<string[]>([]);

  // Capabilities state (separate apply flow)
  const [capabilitiesText, setCapabilitiesText] = useState("");
  const [applyingCapabilities, setApplyingCapabilities] = useState(false);

  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<Map<string, ApplyResult>>(new Map());

  // Fetch available skills once on mount
  useEffect(() => {
    if (!companyId) return;
    fetch(`/api/companies/${encodeURIComponent(companyId)}/skills`, {
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        const arr = Array.isArray(data) ? data : [];
        setAvailableSkillKeys(
          arr
            .map((s: unknown) =>
              typeof s === "string"
                ? s
                : s && typeof (s as Record<string, unknown>).key === "string"
                  ? ((s as Record<string, unknown>).key as string)
                  : "",
            )
            .filter(Boolean),
        );
      })
      .catch(() => {});
  }, [companyId]);

  const selectedAgents = useMemo(
    () => selectable.filter((a) => selected.has(a.id)),
    [selectable, selected],
  );

  // Add candidates: available skills not already on ALL selected agents
  const addCandidates = useMemo(() => {
    if (availableSkillKeys.length === 0) return [];
    const onAll =
      selectedAgents.length === 0
        ? new Set<string>()
        : new Set(
            availableSkillKeys.filter((k) =>
              selectedAgents.every((a) => a.desiredSkills.includes(k)),
            ),
          );
    return availableSkillKeys.filter((k) => !onAll.has(k));
  }, [availableSkillKeys, selectedAgents]);

  // Remove candidates: skills present on at least one selected agent
  const removeCandidates = useMemo(
    () => [...new Set(selectedAgents.flatMap((a) => a.desiredSkills))].sort(),
    [selectedAgents],
  );

  // Computed patch values
  const selection: ApplySelection = { model, effort, role };
  const patch = buildAdapterConfigPatch(selection);
  const rolePatch = buildRolePatch(role);
  const reportsToPatch = buildReportsToPatch(reportsTo);
  const budgetDollars = budget !== "" ? parseFloat(budget) : null;
  const budgetValid = budgetDollars === null || (!isNaN(budgetDollars) && budgetDollars >= 0);
  const budgetCents = budgetDollars !== null && budgetValid ? dollarsToCents(budgetDollars) : null;
  const skillsDelta: SkillsDelta = { add: skillsToAdd, remove: skillsToRemove };
  const hasSkillsDelta = skillsDelta.add.length > 0 || skillsDelta.remove.length > 0;
  const selectedCount = selected.size;

  const canApply =
    (!!patch || !!rolePatch || !!reportsToPatch || budgetCents !== null || hasSkillsDelta) &&
    selectedCount > 0 &&
    !applying &&
    !applyingCapabilities &&
    budgetValid;

  const canApplyCapabilities =
    capabilitiesText.trim().length > 0 &&
    capabilitiesText.length <= CAPABILITIES_MAX_LENGTH &&
    selectedCount > 0 &&
    !applying &&
    !applyingCapabilities;

  const resetTransient = useCallback(() => {
    setResults(new Map());
  }, []);

  const toggleOne = useCallback(
    (id: string) => {
      if (!selectableIds.has(id)) return;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      resetTransient();
    },
    [selectableIds, resetTransient],
  );

  const allSelected = selectable.length > 0 && selected.size === selectable.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
    resetTransient();
  }, [allSelected, selectableIds, resetTransient]);

  const onModelChange = useCallback(
    (v: string) => { setModel(v as ModelOption | typeof KEEP); resetTransient(); },
    [resetTransient],
  );
  const onEffortChange = useCallback(
    (v: string) => { setEffort(v as EffortOption | typeof KEEP); resetTransient(); },
    [resetTransient],
  );
  const onRoleChange = useCallback(
    (v: string) => { setRole(v as AgentRole | typeof KEEP); resetTransient(); },
    [resetTransient],
  );
  const onReportsToChange = useCallback(
    (v: string) => { setReportsTo(v as ReportsToSelection); resetTransient(); },
    [resetTransient],
  );
  const onBudgetChange = useCallback(
    (v: string) => { setBudget(v); resetTransient(); },
    [resetTransient],
  );
  const onCapabilitiesChange = useCallback(
    (v: string) => { setCapabilitiesText(v); resetTransient(); },
    [resetTransient],
  );

  // Apply — bulk PATCH for model/effort/role/reportsTo/budget/skills fields.
  // Body is built per-agent so skills delta can be resolved against current state.
  const doApply = useCallback(async () => {
    if ((!patch && !rolePatch && !reportsToPatch && budgetCents === null && !hasSkillsDelta) || selectedCount === 0 || applying) return;
    setApplying(true);

    const ids = [...selected];
    const settled = await Promise.all(
      ids.map(async (id): Promise<[string, ApplyResult]> => {
        try {
          const bodyObj: Record<string, unknown> = {};
          if (patch) { bodyObj.adapterConfig = patch; bodyObj.replaceAdapterConfig = false; }
          if (rolePatch) Object.assign(bodyObj, rolePatch);
          if (reportsToPatch) bodyObj.reportsTo = reportsToPatch.reportsTo;
          if (budgetCents !== null) Object.assign(bodyObj, buildBudgetPatch(budgetCents));
          if (hasSkillsDelta) {
            const agentRow = agents.find((a) => a.id === id);
            bodyObj.desiredSkills = applySkillsDelta(agentRow?.desiredSkills ?? [], skillsDelta);
          }
          const res = await fetch(agentPatchUrl(id), {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bodyObj),
          });
          if (!res.ok) return [id, { ok: false, error: await readErrorMessage(res) }];
          return [id, { ok: true }];
        } catch (err) {
          return [id, { ok: false, error: err instanceof Error ? err.message : String(err) }];
        }
      }),
    );

    const nextResults = new Map<string, ApplyResult>(settled);
    setResults(nextResults);
    setApplying(false);

    const okIds = new Set(settled.filter(([, r]) => r.ok).map(([id]) => id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of okIds) next.delete(id);
      return next;
    });

    const okCount = okIds.size;
    const failCount = settled.length - okCount;

    const changeParts: string[] = [];
    if (patch || rolePatch) changeParts.push(describeSelection(selection));
    if (reportsToPatch) changeParts.push(`reportsTo → ${reportsToPatch.reportsTo ?? "(cleared)"}`);
    if (budgetCents !== null) changeParts.push(`budget → $${(budgetCents / 100).toFixed(2)}/mo`);
    if (skillsDelta.add.length > 0) changeParts.push(`+${skillsDelta.add.length} skill(s)`);
    if (skillsDelta.remove.length > 0) changeParts.push(`−${skillsDelta.remove.length} skill(s)`);

    if (failCount === 0) {
      toast?.({
        title: `Updated ${okCount} agent${okCount === 1 ? "" : "s"}`,
        body: changeParts.join(", "),
        tone: "success",
      });
    } else {
      toast?.({
        title: `${okCount} updated, ${failCount} failed`,
        body: "See the per-agent status in the table.",
        tone: okCount > 0 ? "warn" : "error",
      });
    }

    if (hasSkillsDelta && okIds.size > 0) {
      setSkillsToAdd([]);
      setSkillsToRemove([]);
    }

    roster.refresh?.();
  }, [
    patch,
    rolePatch,
    reportsToPatch,
    budgetCents,
    hasSkillsDelta,
    selectedCount,
    applying,
    selected,
    agents,
    skillsDelta,
    selection,
    toast,
    roster,
  ]);

  // Apply capabilities — separate bulk PATCH { capabilities }.
  const doApplyCapabilities = useCallback(async () => {
    if (!capabilitiesText.trim() || selectedCount === 0 || applyingCapabilities) return;
    setApplyingCapabilities(true);

    const body = JSON.stringify(buildCapabilitiesPatch(capabilitiesText));
    const ids = [...selected];
    const settled = await Promise.all(
      ids.map(async (id): Promise<[string, ApplyResult]> => {
        try {
          const res = await fetch(agentPatchUrl(id), {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body,
          });
          if (!res.ok) return [id, { ok: false, error: await readErrorMessage(res) }];
          return [id, { ok: true }];
        } catch (err) {
          return [id, { ok: false, error: err instanceof Error ? err.message : String(err) }];
        }
      }),
    );

    const nextResults = new Map<string, ApplyResult>(settled);
    setResults(nextResults);
    setApplyingCapabilities(false);

    const okIds = new Set(settled.filter(([, r]) => r.ok).map(([id]) => id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of okIds) next.delete(id);
      return next;
    });

    const okCount = okIds.size;
    const failCount = settled.length - okCount;
    if (failCount === 0) {
      toast?.({
        title: `Updated ${okCount} agent${okCount === 1 ? "" : "s"}`,
        body: "Capabilities updated.",
        tone: "success",
      });
    } else {
      toast?.({
        title: `${okCount} updated, ${failCount} failed`,
        body: "See the per-agent status in the table.",
        tone: okCount > 0 ? "warn" : "error",
      });
    }

    roster.refresh?.();
  }, [
    capabilitiesText,
    selectedCount,
    applyingCapabilities,
    selected,
    toast,
    roster,
  ]);

  const applyLabel = applying ? "Applying…" : `Apply to ${selectedCount} selected`;
  const applyCapLabel = applyingCapabilities ? "Applying…" : `Apply to ${selectedCount} selected`;

  // Human-readable description of pending main-toolbar changes
  const pendingDesc = (() => {
    const parts: string[] = [];
    if (patch || rolePatch) parts.push(describeSelection(selection));
    if (reportsToPatch) parts.push(`reportsTo → ${reportsToPatch.reportsTo ?? "(cleared)"}`);
    if (budgetCents !== null) parts.push(`budget → $${(budgetCents / 100).toFixed(2)}/mo`);
    if (skillsDelta.add.length > 0) parts.push(`+${skillsDelta.add.length} skill(s)`);
    if (skillsDelta.remove.length > 0) parts.push(`−${skillsDelta.remove.length} skill(s)`);
    return parts.join(", ");
  })();

  return (
    <div style={styles.page}>
      <header style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: -0.2 }}>
          Bulk Model Switcher
        </h1>
        <p style={styles.muted}>
          Select agents{companyName ? ` in ${companyName}` : ""} and set their
          model, reasoning effort, and other agent fields in one action. Every
          other adapter setting is preserved; the adapter type is never changed.
        </p>
      </header>

      {/* Toolbar — model / effort / role / reports-to / budget / skills */}
      <section style={styles.card}>
        <div style={styles.toolbar}>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="ms-model">Model</label>
            <ChevronSelect id="ms-model" value={model} onChange={onModelChange}>
              <option value={KEEP}>Leave unchanged</option>
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </ChevronSelect>
          </div>

          <div style={styles.field}>
            <label style={styles.label} htmlFor="ms-effort">Reasoning effort</label>
            <ChevronSelect id="ms-effort" value={effort} onChange={onEffortChange}>
              <option value={KEEP}>Leave unchanged</option>
              {EFFORT_OPTIONS.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </ChevronSelect>
          </div>

          <div style={styles.field}>
            <label style={styles.label} htmlFor="ms-role">Role</label>
            <ChevronSelect id="ms-role" value={role} onChange={onRoleChange}>
              <option value={KEEP}>Leave unchanged</option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </ChevronSelect>
          </div>

          <div style={{ ...styles.field, minWidth: 200 }}>
            <label style={styles.label} htmlFor="ms-reports-to">Reports to</label>
            <ChevronSelect id="ms-reports-to" value={reportsTo} onChange={onReportsToChange}>
              <option value={KEEP_REPORTS_TO}>Leave unchanged</option>
              <option value={CLEAR_REPORTS_TO}>(none — clear)</option>
              {agents
                .filter((a) => !selected.has(a.id))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.role ? ` (${a.role})` : ""}
                  </option>
                ))}
            </ChevronSelect>
          </div>

          <div style={{ ...styles.field, minWidth: 140 }}>
            <label style={styles.label} htmlFor="ms-budget">Monthly budget ($)</label>
            <input
              id="ms-budget"
              type="number"
              min="0"
              step="1"
              placeholder="Leave unchanged"
              value={budget}
              onChange={(e) => onBudgetChange(e.target.value)}
              style={{
                ...styles.input,
                borderColor: !budgetValid ? "var(--destructive)" : "var(--border)",
              }}
            />
          </div>

          {availableSkillKeys.length > 0 && (
            <>
              <div style={{ ...styles.field, minWidth: 180 }}>
                <label style={styles.label}>Add skills</label>
                <select
                  multiple
                  value={skillsToAdd}
                  onChange={(e) =>
                    setSkillsToAdd(Array.from(e.target.selectedOptions, (o) => o.value))
                  }
                  style={styles.multiSelect}
                  aria-label="Skills to add"
                >
                  {addCandidates.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div style={{ ...styles.field, minWidth: 180 }}>
                <label style={styles.label}>Remove skills</label>
                <select
                  multiple
                  value={skillsToRemove}
                  onChange={(e) =>
                    setSkillsToRemove(Array.from(e.target.selectedOptions, (o) => o.value))
                  }
                  style={styles.multiSelect}
                  disabled={removeCandidates.length === 0}
                  aria-label="Skills to remove"
                >
                  {removeCandidates.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
            </>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              onClick={doApply}
              disabled={!canApply}
              style={{
                ...styles.applyButton,
                opacity: canApply ? 1 : 0.5,
                cursor: canApply ? "pointer" : "not-allowed",
              }}
              title={
                canApply
                  ? `Apply changes to the selected agents`
                  : "Select agents and choose a field to change"
              }
            >
              {applyLabel}
            </button>
          </div>
        </div>

        <p style={{ ...styles.muted, marginTop: 12 }}>
          {selectedCount === 0
            ? "Select one or more agents below."
            : pendingDesc
              ? `Will set ${pendingDesc} on ${selectedCount} agent${selectedCount === 1 ? "" : "s"}.`
              : `${selectedCount} selected — choose a field to change.`}
        </p>
      </section>

      {/* Toolbar — capabilities (separate apply) */}
      <section style={styles.card}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={styles.label} htmlFor="ms-capabilities">Capabilities</label>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <textarea
                id="ms-capabilities"
                value={capabilitiesText}
                maxLength={CAPABILITIES_MAX_LENGTH}
                rows={3}
                placeholder="Enter capabilities text to apply to all selected agents…"
                onChange={(e) => onCapabilitiesChange(e.target.value)}
                style={styles.textarea}
              />
              <span style={{ ...styles.muted, textAlign: "right" }}>
                {capabilitiesText.length} / {CAPABILITIES_MAX_LENGTH}
              </span>
            </div>
            <button
              type="button"
              onClick={doApplyCapabilities}
              disabled={!canApplyCapabilities}
              style={{
                ...styles.applyButton,
                marginTop: 0,
                opacity: canApplyCapabilities ? 1 : 0.5,
                cursor: canApplyCapabilities ? "pointer" : "not-allowed",
              }}
              title={
                selectedCount === 0
                  ? "Select agents first"
                  : capabilitiesText.trim().length === 0
                    ? "Enter capabilities text to apply"
                    : `Apply capabilities to ${selectedCount} selected agent${selectedCount === 1 ? "" : "s"}`
              }
            >
              {applyCapLabel}
            </button>
          </div>
        </div>

        <p style={{ ...styles.muted, marginTop: 8 }}>
          {selectedCount === 0
            ? "Select one or more agents below."
            : capabilitiesText.trim().length > 0
              ? `Will overwrite capabilities on ${selectedCount} agent${selectedCount === 1 ? "" : "s"}.`
              : `${selectedCount} selected — enter capabilities text to apply.`}
        </p>
      </section>

      {/* Roster table */}
      <section style={styles.card}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 16,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <h2 style={styles.sectionTitle}>Agents</h2>
          <span style={styles.muted}>
            {loading
              ? "Loading…"
              : `${selectedCount} of ${selectable.length} selected`}
          </span>
        </div>

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={styles.skeleton} />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <p style={styles.muted}>No agents found for this company.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={{ ...styles.th, width: 36 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all agents"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={toggleAll}
                      style={{ cursor: "pointer" }}
                    />
                  </th>
                  <th style={styles.th}>Agent</th>
                  <th style={styles.th}>Role</th>
                  <th style={styles.th}>Adapter</th>
                  <th style={styles.th}>Model</th>
                  <th style={styles.th}>Effort</th>
                  <th style={styles.th}>Reports to</th>
                  <th style={styles.th}>Budget/mo</th>
                  <th style={styles.th}>Skills</th>
                  <th style={{ ...styles.th, maxWidth: 200 }}>Capabilities</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => {
                  const isSelectable = selectableIds.has(a.id);
                  const isSelected = selected.has(a.id);
                  const result = results.get(a.id);
                  const reportsToAgent = a.reportsTo
                    ? agents.find((r) => r.id === a.reportsTo) ?? null
                    : null;
                  const reportsToName = reportsToAgent
                    ? reportsToAgent.name
                    : a.reportsTo
                      ? `${a.reportsTo.slice(0, 8)}…`
                      : null;
                  return (
                    <tr
                      key={a.id}
                      style={{
                        opacity: isSelectable ? 1 : 0.5,
                        background: isSelected
                          ? "color-mix(in oklab, var(--primary) 8%, transparent)"
                          : "transparent",
                      }}
                    >
                      <td style={styles.td}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${a.name}`}
                          checked={isSelected}
                          disabled={!isSelectable}
                          onChange={() => toggleOne(a.id)}
                          style={{ cursor: isSelectable ? "pointer" : "not-allowed" }}
                        />
                      </td>
                      <td style={styles.td}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontWeight: 600 }}>{a.name}</span>
                          {a.title ? (
                            <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                              {a.title}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td style={styles.td}>{fmtValue(a.role)}</td>
                      <td style={styles.td}>
                        <span style={styles.pill}>{a.adapterType ?? "—"}</span>
                      </td>
                      <td style={styles.td}>{fmtValue(a.model)}</td>
                      <td style={styles.td}>{fmtValue(a.effort)}</td>
                      <td style={styles.td}>{fmtValue(reportsToName)}</td>
                      <td style={styles.td}>{fmtBudget(a.budgetMonthlyCents)}</td>
                      <td style={styles.td}>
                        <span
                          style={styles.pill}
                          title={a.desiredSkills.length > 0 ? a.desiredSkills.join(", ") : "none"}
                        >
                          {a.desiredSkills.length} skills
                        </span>
                      </td>
                      <td style={{ ...styles.td, maxWidth: 200, overflow: "hidden" }}>
                        {fmtCapabilities(a.capabilities)}
                      </td>
                      <td style={{ ...styles.td, textAlign: "right" }}>
                        {result ? (
                          result.ok ? (
                            <span style={{ color: "var(--primary)", fontWeight: 600 }}>
                              ✓ Updated
                            </span>
                          ) : (
                            <span
                              style={{ color: "var(--destructive)", fontWeight: 600 }}
                              title={result.error}
                            >
                              ✗ Failed
                            </span>
                          )
                        ) : (
                          <span style={{ color: "var(--muted-foreground)" }}>{a.status}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
