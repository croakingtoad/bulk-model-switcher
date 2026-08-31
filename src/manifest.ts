import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

/**
 * Model Switcher — bulk-reconfigure agent model + reasoning effort.
 *
 * A single company-scoped page: multiselect any set of the company's agents and
 * set their `adapterConfig.model` and/or `adapterConfig.effort` in one action.
 * Every other adapter setting is preserved; the adapter TYPE is never changed.
 *
 * Split of responsibility (this is the whole architecture):
 *   - READ  → worker. A `roster` data handler calls ctx.agents.list (capability
 *             `agents.read`) and returns a clean { id, name, role, model, effort,
 *             adapterType, status } per agent. Model/effort are extracted in the
 *             worker so the UI never spelunks raw adapterConfig in render code.
 *   - WRITE → UI. The plugin page is trusted, same-origin host code, so it
 *             PATCHes `/api/agents/:id` directly using the operator's existing
 *             board session (credentials: same-origin). No worker write path
 *             exists for agent config, and none is needed — and crucially, NO
 *             secret or API key is ever stored. The write rides the session the
 *             operator is already in.
 *
 * Because the write is a same-origin browser fetch (not a worker host method),
 * it needs no capability: capabilities gate the WORKER only. The manifest below
 * therefore declares just what the worker's read path uses.
 */
const manifest: PaperclipPluginManifestV1 = {
  id: "bulk-model-switcher",
  apiVersion: 1,
  version: "0.0.2",
  displayName: "Bulk Model Switcher",
  description:
    "Bulk-reconfigure agents. Multiselect any set of a company's agents and set their model and reasoning effort in one action — every other adapter setting is preserved, and the adapter type is never changed.",
  author: "@herrhelms",
  categories: ["automation"],
  capabilities: [
    // agents.read — the live roster (id, name, role, status, adapterType,
    // adapterConfig) for the table's current model/effort columns. This is the
    // ONLY host method the worker calls. There is intentionally no agent-config
    // WRITE capability: no such worker method exists, and the write happens
    // browser-side from the trusted plugin page instead.
    "agents.read",
    // companies.read — resolve the company display name for the page header.
    // Falls back silently to the id when denied.
    "companies.read",
    // ui.page.register — the single full-page slot at /:companyPrefix/bulk-model-switcher.
    "ui.page.register",
    // ui.sidebar.register — the sidebar entry that links to the page from the
    // left nav (near the agents), so it's reachable in one click from anywhere.
    "ui.sidebar.register",
    // instance.settings.register — the settingsPage slot that renders the
    // "Open Model Switcher →" signpost on the plugin's own settings screen.
    "instance.settings.register",
  ],
  entrypoints: {
    worker: "dist/worker.js",
    ui: "dist/ui",
  },
  ui: {
    slots: [
      {
        type: "page",
        id: "model-switcher-page",
        displayName: "Bulk Model Switcher",
        exportName: "ModelSwitcherPage",
        // Host validation: routePath is a single lowercase slug (letters,
        // numbers, hyphens; no slashes). Mounts at /:companyPrefix/bulk-model-switcher.
        routePath: "bulk-model-switcher",
      },
      {
        // Left-nav entry (near the agents) that links straight to the page —
        // the primary way operators reach the switcher day to day.
        type: "sidebar",
        id: "model-switcher-sidebar",
        displayName: "Bulk Model Switcher",
        exportName: "ModelSwitcherSidebar",
      },
      {
        // Renders on THIS plugin's settings screen (overriding the empty
        // auto-generated config form), so an operator who opens the plugin's
        // settings sees a clear signpost + link to the page. The plugin has no
        // configurable options, so this slot exists purely for discoverability.
        // settingsPage takes no routePath — it mounts inside plugin settings.
        type: "settingsPage",
        id: "model-switcher-settings",
        displayName: "Bulk Model Switcher",
        exportName: "ModelSwitcherSettings",
      },
    ],
  },
};

export default manifest;
