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
  KEEP,
  UNCONFIGURABLE_STATUSES,
  buildAdapterConfigPatch,
  buildAgentPatchBody,
  agentPatchUrl,
  describeSelection,
  type ApplySelection,
  type EffortOption,
  type ModelOption,
  type RosterData,
  type RosterRow,
} from "../shared.js";

// -----------------------------------------------------------------------------
// Bulk Model Switcher — plugin UI (single page export: ModelSwitcherPage).
//
// Mounts at /:companyPrefix/bulk-model-switcher. Multiselect any set of the
// company's agents and set their model and/or reasoning effort in one action.
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

// The page slot's routePath mounts at /:companyPrefix/bulk-model-switcher.
// linkProps() takes a company-relative path (leading slash, no prefix) and the
// host resolves the active company prefix at render time.
const PAGE_HREF = "/bulk-model-switcher";

// ---- Error helper -----------------------------------------------------------

// A same-origin fetch that failed returns a Response; the host may wrap the
// error body as JSON or a JSON-quoted string. Reduce it to a readable line.
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
    /* not JSON — fall through to raw text */
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
    // Drop the platform chevron; ChevronSelect overlays a themed one instead.
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
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

function roleLabel(row: RosterRow): string | null {
  if (row.title) return row.title;
  if (row.role) return row.role.toUpperCase();
  return null;
}

// Lucide `hat-glasses` (24×24 stroke icon), rendered at the host's 16px nav size.
// stroke="currentColor" so it inherits the link's muted→foreground color.
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

// The exact class string the host uses for its own sidebar links (copied from a
// live "See all agents" entry), so the plugin link is pixel-identical: same
// size, weight, muted colour, padding, radius, and hover treatment.
const HOST_NAV_LINK_CLASS =
  "flex items-center gap-2.5 mx-2 rounded-lg px-2 py-1.5 pointer-coarse:py-1 " +
  "text-(length:--text-compact) font-medium text-muted-foreground transition-colors " +
  "hover:bg-accent/50 hover:text-foreground";

// =============================================================================
// ModelSwitcherSidebar — left-nav entry that links to the page.
//
// The host mounts plugin `sidebar` slots at the end of the WORK group; there's
// no manifest option to target the AGENTS group. Since the plugin UI is trusted,
// same-origin host code, we relocate our own link node to sit right after the
// "See all agents" entry, and keep it there with a MutationObserver so it
// survives host re-renders (badge updates, navigation, etc.). If the agents
// group isn't present, the link simply stays where the host put it.
// =============================================================================
export function ModelSwitcherSidebar(): JSX.Element {
  const nav = useHostNavigation();
  const pageLink = nav.linkProps(PAGE_HREF);
  const linkRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    const link = linkRef.current;
    if (!link) return;
    // The host wraps each plugin sidebar item in its own container; once we move
    // the link out, hide that now-empty wrapper so it leaves no gap in WORK.
    const originalWrapper = link.parentElement;
    let cancelled = false;

    const place = () => {
      if (cancelled) return;
      const seeAll = document.querySelector<HTMLAnchorElement>('a[href$="/agents/all"]');
      if (!seeAll || !seeAll.parentElement) return;
      if (seeAll.nextElementSibling === link) return; // already in position
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
      title="Bulk-set agents' model and reasoning effort"
    >
      <HatGlassesIcon />
      Bulk Model Switcher
    </a>
  );
}

// =============================================================================
// ModelSwitcherSettings — renders on the plugin's settings screen.
//
// The plugin has no configurable options, so instead of an empty config form
// this slot is a signpost: it tells the operator what the plugin does and links
// straight to the page. `linkProps(PAGE_HREF)` resolves the active company
// prefix, so the same build works for every company.
// =============================================================================
export function ModelSwitcherSettings(): JSX.Element {
  const nav = useHostNavigation();
  const pageLink = nav.linkProps(PAGE_HREF);
  return (
    <div style={{ ...styles.card, display: "flex", flexDirection: "column", gap: 12, maxWidth: 640 }}>
      <h2 style={styles.sectionTitle}>Bulk Model Switcher</h2>
      <p style={{ ...styles.muted, lineHeight: 1.5 }}>
        There's nothing to configure here. Bulk Model Switcher lives on its own
        page, where you can multiselect this company's agents and set their model
        and reasoning effort in one action. Every other adapter setting is
        preserved, and the adapter type is never changed.
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

// A native <select> with the platform chevron removed and a single themed
// chevron overlaid on the right — so both dropdowns read as one consistent
// control instead of the OS default. The overlay is pointer-events:none so
// clicks still open the native menu.
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

  // Which agents can be selected (terminated agents can't be reconfigured).
  const selectable = useMemo(
    () => agents.filter((a) => !UNCONFIGURABLE_STATUSES.has(a.status)),
    [agents],
  );
  const selectableIds = useMemo(
    () => new Set(selectable.map((a) => a.id)),
    [selectable],
  );

  // Selection state.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [model, setModel] = useState<ModelOption | typeof KEEP>(KEEP);
  const [effort, setEffort] = useState<EffortOption | typeof KEEP>(KEEP);

  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<Map<string, ApplyResult>>(new Map());

  const selection: ApplySelection = { model, effort };
  const patch = buildAdapterConfigPatch(selection);
  const selectedCount = selected.size;
  const canApply = !!patch && selectedCount > 0 && !applying;

  // Changing selection or target values clears stale per-agent results.
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

  const allSelected =
    selectable.length > 0 && selected.size === selectable.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
    resetTransient();
  }, [allSelected, selectableIds, resetTransient]);

  const onModelChange = useCallback(
    (v: string) => {
      setModel(v as ModelOption | typeof KEEP);
      resetTransient();
    },
    [resetTransient],
  );
  const onEffortChange = useCallback(
    (v: string) => {
      setEffort(v as EffortOption | typeof KEEP);
      resetTransient();
    },
    [resetTransient],
  );

  // Apply — a single click performs the bulk PATCH on every selected agent.
  // The action is explicit (you picked the agents, the model/effort, and hit
  // Apply) and fully reversible, so there's no extra confirm step in the way.
  const doApply = useCallback(async () => {
    if (!patch || selectedCount === 0 || applying) return;
    setApplying(true);

    const body = JSON.stringify(buildAgentPatchBody(patch));
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
    setApplying(false);

    // Clear the selection for agents that applied cleanly so the operator gets a
    // fresh slate; keep any failures selected so they can be retried in place.
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
        body: describeSelection(selection),
        tone: "success",
      });
    } else {
      toast?.({
        title: `${okCount} updated, ${failCount} failed`,
        body: "See the per-agent status in the table.",
        tone: okCount > 0 ? "warn" : "error",
      });
    }

    // Pull fresh current-value columns so the table reflects what stuck.
    roster.refresh?.();
  }, [
    patch,
    selectedCount,
    applying,
    selected,
    selection,
    toast,
    roster,
  ]);

  const applyLabel = applying ? "Applying…" : `Apply to ${selectedCount} selected`;

  return (
    <div style={styles.page}>
      <header style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: -0.2 }}>
          Bulk Model Switcher
        </h1>
        <p style={styles.muted}>
          Select agents{companyName ? ` in ${companyName}` : ""} and set their
          model and reasoning effort in one action. Every other adapter setting
          is preserved; the adapter type is never changed.
        </p>
      </header>

      {/* Toolbar */}
      <section style={styles.card}>
        <div style={styles.toolbar}>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="ms-model">
              Model
            </label>
            <ChevronSelect id="ms-model" value={model} onChange={onModelChange}>
              <option value={KEEP}>Leave unchanged</option>
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </ChevronSelect>
          </div>

          <div style={styles.field}>
            <label style={styles.label} htmlFor="ms-effort">
              Reasoning effort
            </label>
            <ChevronSelect id="ms-effort" value={effort} onChange={onEffortChange}>
              <option value={KEEP}>Leave unchanged</option>
              {EFFORT_OPTIONS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </ChevronSelect>
          </div>

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
                patch
                  ? `Apply ${describeSelection(selection)} to the selected agents`
                  : "Pick a model and/or effort to apply"
              }
            >
              {applyLabel}
            </button>
          </div>
        </div>

        <p style={{ ...styles.muted, marginTop: 12 }}>
          {selectedCount === 0
            ? "Select one or more agents below."
            : patch
              ? `Will set ${describeSelection(selection)} on ${selectedCount} agent${selectedCount === 1 ? "" : "s"}.`
              : `${selectedCount} selected — choose a model and/or effort to apply.`}
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
                  <th style={styles.th}>Adapter</th>
                  <th style={styles.th}>Model</th>
                  <th style={styles.th}>Effort</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => {
                  const isSelectable = selectableIds.has(a.id);
                  const isSelected = selected.has(a.id);
                  const result = results.get(a.id);
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
                          {roleLabel(a) ? (
                            <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                              {roleLabel(a)}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td style={styles.td}>
                        <span style={styles.pill}>{a.adapterType ?? "—"}</span>
                      </td>
                      <td style={styles.td}>{fmtValue(a.model)}</td>
                      <td style={styles.td}>{fmtValue(a.effort)}</td>
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
