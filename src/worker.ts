import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { extractModelEffort, type RosterData, type RosterRow } from "./shared.js";

/**
 * Model Switcher — worker.
 *
 * The worker is deliberately thin: it exposes ONE read-only data handler,
 * `roster`, that lists the company's agents and projects each down to the
 * fields the page needs. All mutation happens browser-side (see manifest and
 * src/ui/index.tsx) — the worker never writes agent config, because no such
 * host method exists and none is needed.
 *
 * RosterRow / RosterData live in shared.ts so the worker and UI share one
 * definition. The worker returns a bare object; the UI reads `.agents` /
 * `.companyName`.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Map one host Agent into the flat RosterRow the page renders. */
function toRosterRow(agent: any): RosterRow {
  const id = String(agent?.id ?? "");
  const { model, effort } = extractModelEffort(agent?.adapterConfig);
  return {
    id,
    name: str(agent?.name) ?? id,
    role: str(agent?.role),
    title: str(agent?.title),
    status: str(agent?.status) ?? "unknown",
    adapterType: str(agent?.adapterType),
    model,
    effort,
    capabilities: str(agent?.capabilities),
  };
}

/** Resolve the company display name; silently degrade to null when unavailable. */
async function resolveCompanyName(ctx: any, companyId: string): Promise<string | null> {
  try {
    const company = await ctx.companies?.get?.({ companyId });
    return str(company?.name);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin = definePlugin({
  async setup(ctx: any) {
    // 'roster' → the company's agents projected to { id, name, role, title,
    // status, adapterType, model, effort, capabilities }, plus the resolved
    // company name. Read after every apply so current-value columns reflect
    // the new state.
    ctx.data.register("roster", async (input: any): Promise<RosterData> => {
      const companyId = String(input?.companyId ?? "");
      if (!companyId) return { agents: [], companyName: null };

      const raw = (await ctx.agents.list({ companyId })) ?? [];
      const agents = (Array.isArray(raw) ? raw : [])
        .map(toRosterRow)
        .sort((a, b) => a.name.localeCompare(b.name));

      const companyName = await resolveCompanyName(ctx, companyId);
      return { agents, companyName };
    });
  },
});

runWorker(plugin, import.meta.url);

export default plugin;
