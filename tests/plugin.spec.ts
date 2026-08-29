import { describe, expect, it } from "vitest";

import manifest from "../src/manifest";
import {
  MODEL_OPTIONS,
  EFFORT_OPTIONS,
  KEEP,
  UNCONFIGURABLE_STATUSES,
  extractModelEffort,
  buildAdapterConfigPatch,
  buildAgentPatchBody,
  agentPatchUrl,
  describeSelection,
} from "../src/shared";

/**
 * Tests assert the plugin against the REAL SDK manifest type and the pure
 * decision logic in shared.ts. No live SDK, host, or database is required.
 *
 *   1. Manifest validity — id, apiVersion, the single page slot + routePath,
 *      and a minimal, correct capability set (read-only worker; the write is
 *      UI-side and needs no capability).
 *   2. shared.ts contract — reading model/effort off adapterConfig, building
 *      the partial patch, and the merge-preserving request body.
 */

const CAPS: string[] = manifest.capabilities ?? [];
const SLOTS = manifest.ui?.slots ?? [];
const ROUTE_SLUG = /^[a-z0-9][a-z0-9-]*$/;

describe("manifest: identity", () => {
  it("declares apiVersion 1", () => {
    expect(manifest.apiVersion).toBe(1);
  });

  it("carries the bulk-model-switcher plugin id", () => {
    expect(manifest.id).toBe("bulk-model-switcher");
  });

  it("points entrypoints.ui at dist/ui and declares a worker", () => {
    expect(manifest.entrypoints?.ui).toBe("dist/ui");
    expect(manifest.entrypoints?.worker).toBeTruthy();
  });
});

describe("manifest: ui slots", () => {
  const page = SLOTS.find((s) => s.type === "page");
  const sidebar = SLOTS.find((s) => s.type === "sidebar");
  const settings = SLOTS.find((s) => s.type === "settingsPage");

  it("mounts a page, a sidebar, and a settingsPage slot", () => {
    expect(SLOTS).toHaveLength(3);
    expect(page?.id).toBe("model-switcher-page");
    expect(sidebar?.id).toBe("model-switcher-sidebar");
    expect(settings?.id).toBe("model-switcher-settings");
  });

  it("exports a component name for every slot", () => {
    expect(page?.exportName).toBe("ModelSwitcherPage");
    expect(sidebar?.exportName).toBe("ModelSwitcherSidebar");
    expect(settings?.exportName).toBe("ModelSwitcherSettings");
  });

  it("declares routePath on the page slot as a single lowercase slug with no slash", () => {
    const p = page as { routePath?: string };
    expect(p.routePath).toBe("bulk-model-switcher");
    expect(p.routePath).toMatch(ROUTE_SLUG);
    expect(p.routePath).not.toContain("/");
  });

  it("does NOT put a routePath on the settingsPage slot (it mounts in plugin settings)", () => {
    expect((settings as { routePath?: string }).routePath ?? null).toBeNull();
  });
});

describe("manifest: capabilities", () => {
  it("declares agents.read (the worker's only host method) and ui.page.register", () => {
    expect(CAPS).toContain("agents.read");
    expect(CAPS).toContain("ui.page.register");
  });

  it("declares companies.read for the header name", () => {
    expect(CAPS).toContain("companies.read");
  });

  it("declares instance.settings.register for the settingsPage signpost slot", () => {
    expect(CAPS).toContain("instance.settings.register");
  });

  it("declares ui.sidebar.register for the sidebar link", () => {
    expect(CAPS).toContain("ui.sidebar.register");
  });

  it("does NOT declare any agent WRITE / pause capability — the write is UI-side", () => {
    expect(CAPS).not.toContain("agents.write");
    expect(CAPS).not.toContain("agents.pause");
    expect(CAPS).not.toContain("agents.resume");
  });

  it("declares no database, state, events, jobs, or api-route capabilities (none are used)", () => {
    for (const cap of CAPS) {
      expect(cap.startsWith("database.")).toBe(false);
      expect(cap.startsWith("plugin.state.")).toBe(false);
      expect(cap).not.toBe("events.subscribe");
      expect(cap).not.toBe("jobs.schedule");
      expect(cap).not.toBe("api.routes.register");
    }
  });

  it("has no duplicate capability entries", () => {
    expect(new Set(CAPS).size).toBe(CAPS.length);
  });
});

describe("shared: extractModelEffort", () => {
  it("pulls model + effort out of a live-shaped adapterConfig", () => {
    const cfg = { mode: "", model: "research", effort: "medium", maxTurnsPerRun: 150 };
    expect(extractModelEffort(cfg)).toEqual({ model: "research", effort: "medium" });
  });

  it("returns null for missing keys rather than throwing", () => {
    expect(extractModelEffort({ maxTurnsPerRun: 150 })).toEqual({
      model: null,
      effort: null,
    });
  });

  it("is tolerant of non-object / non-string inputs", () => {
    expect(extractModelEffort(null)).toEqual({ model: null, effort: null });
    expect(extractModelEffort(undefined)).toEqual({ model: null, effort: null });
    expect(extractModelEffort("nope")).toEqual({ model: null, effort: null });
    expect(extractModelEffort({ model: 5, effort: true })).toEqual({
      model: null,
      effort: null,
    });
  });
});

describe("shared: buildAdapterConfigPatch", () => {
  it("includes only the fields that are set (both)", () => {
    expect(buildAdapterConfigPatch({ model: "coder", effort: "high" })).toEqual({
      model: "coder",
      effort: "high",
    });
  });

  it("includes only model when effort is KEEP", () => {
    expect(buildAdapterConfigPatch({ model: "agent", effort: KEEP })).toEqual({
      model: "agent",
    });
  });

  it("includes only effort when model is KEEP", () => {
    expect(buildAdapterConfigPatch({ model: KEEP, effort: "low" })).toEqual({
      effort: "low",
    });
  });

  it("returns null when nothing is selected (both KEEP)", () => {
    expect(buildAdapterConfigPatch({ model: KEEP, effort: KEEP })).toBeNull();
  });
});

describe("shared: request body is merge-preserving", () => {
  it("always sets replaceAdapterConfig:false so other keys survive", () => {
    const body = buildAgentPatchBody({ model: "coder" });
    expect(body.replaceAdapterConfig).toBe(false);
    expect(body.adapterConfig).toEqual({ model: "coder" });
  });
});

describe("shared: agentPatchUrl", () => {
  it("builds an origin-relative /api/agents/:id route", () => {
    expect(agentPatchUrl("abc-123")).toBe("/api/agents/abc-123");
  });

  it("encodes the id", () => {
    expect(agentPatchUrl("a/b c")).toBe("/api/agents/a%2Fb%20c");
  });
});

describe("shared: describeSelection", () => {
  it("summarises both changes", () => {
    expect(describeSelection({ model: "coder", effort: "high" })).toBe(
      "model → coder, effort → high",
    );
  });

  it("summarises a single change", () => {
    expect(describeSelection({ model: KEEP, effort: "low" })).toBe("effort → low");
  });

  it("says 'no changes' when both are KEEP", () => {
    expect(describeSelection({ model: KEEP, effort: KEEP })).toBe("no changes");
  });
});

describe("shared: vocabulary", () => {
  it("offers the curated reasoning + instruct models", () => {
    expect(MODEL_OPTIONS).toEqual([
      "coder",
      "agent",
      "research",
      "coder-instruct",
      "agent-instruct",
      "research-instruct",
    ]);
  });

  it("offers the four effort tiers", () => {
    expect(EFFORT_OPTIONS).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("treats terminated agents as unconfigurable", () => {
    expect(UNCONFIGURABLE_STATUSES.has("terminated")).toBe(true);
    expect(UNCONFIGURABLE_STATUSES.has("idle")).toBe(false);
  });
});
