# Bulk Model Switcher

A [Paperclip](https://paperclip.ing) plugin for changing the **model** and
**reasoning effort** of many agents at once.

Open the page at `/:companyPrefix/bulk-model-switcher`, select the agents you want, pick a model and/or an effort, and hit
**Apply**. Every other adapter setting on each agent is left exactly as it was,
and the adapter *type* is never touched.

## Why

Paperclip lets you set each agent's model and reasoning effort individually, but
there's no built-in way to retune a whole roster in one go. If you want to move
every agent from `model a` to `model b`, or bump the whole team's effort to
`high` for a hard sprint, you'd otherwise edit them one at a time. This does it
as a single multiselect action.

## Features

- **Multiselect** agents (with select-all); terminated agents are skipped.
- Curated **Model** dropdown and **Reasoning effort** dropdown
  (`low` / `medium` / `high` / `xhigh`).
- Either field can be left **unchanged**, so you can retarget just the model,
  just the effort, or both.
- Single-click **Apply** with a per-agent ✓ / ✗ result. The table's current
  model/effort columns refresh to show what actually stuck.
- **Non-destructive:** only `model` and `effort` are written; the adapter type
  and every other `adapterConfig` key (instructions paths, skill sync, turn
  limits, …) are preserved.

Reachable three ways: a **sidebar** entry (in the left nav, next to the agents),
a link on the plugin's **settings** screen, and directly at
`/:companyPrefix/bulk-model-switcher`.

## Install

From npm, into a local Paperclip instance:

```bash
npm i -g @herrhelms/bulk-model-switcher   # or add to your instance's plugins
paperclipai plugin install @herrhelms/bulk-model-switcher
```

Or from a checkout, using an absolute path:

```bash
pnpm install && pnpm build
paperclipai plugin install /absolute/path/to/bulk-model-switcher
```

Then open `http://<host>/<companyPrefix>/bulk-model-switcher` (or click **Bulk
Model Switcher** in the sidebar).

## How it works

A Paperclip plugin **worker** has no host method to write another agent's
adapter config — its agent surface is read plus pause/resume/invoke. So this
plugin splits its two jobs across the two trusted surfaces it does have:

- **Read → worker.** A `roster` data handler calls `ctx.agents.list`
  (capability `agents.read`) and projects each agent down to
  `{ id, name, role, status, adapterType, model, effort }`. Model and effort are
  extracted in the worker so the UI never has to reach into raw `adapterConfig`.

- **Write → UI.** The plugin page is trusted, **same-origin** host code, so it
  issues `PATCH /api/agents/:id` directly, riding the operator's **existing
  board session** (`credentials: "same-origin"`). The request body is:

  ```json
  { "adapterConfig": { "model": "model name", "effort": "high" }, "replaceAdapterConfig": false }
  ```

  `replaceAdapterConfig: false` tells the host to **merge** those keys into the
  agent's existing config rather than replace it — which is what preserves every
  untouched field.

Because the write is a same-origin browser request made in the operator's own
session — not a worker host call — it needs **no capability and stores no
secret**. There is no API key anywhere; your existing login authorises the exact
click you made.

## Capabilities

| Capability                   | Why                                                         |
| ---------------------------- | ----------------------------------------------------------- |
| `agents.read`                | List the company's agents and their current model/effort.   |
| `companies.read`             | Resolve the company display name for the header.            |
| `ui.page.register`           | The full-page multiselect UI.                               |
| `ui.sidebar.register`        | The left-nav entry.                                         |
| `instance.settings.register` | The signpost on the plugin's settings screen.               |

No agent-**write** capability is declared, because none exists and none is used —
the write happens UI-side, same-origin.

## Scope & compatibility

- Sets `model` and `effort` only. Never changes `adapterType`.
- The curated Model list reflects your adapter's model vocabulary. The table
  still *displays* whatever value an agent currently has, even if it predates or
  diverges from that list; the curated set only constrains what a bulk-apply can
  set.
- Changes are immediate and reversible — re-apply to roll back.

## Development

```bash
pnpm install
pnpm typecheck   # tsc for src + tests
pnpm test        # vitest — manifest shape + pure helpers
pnpm build       # esbuild → dist/{worker,manifest}.js + dist/ui/index.js
```

The worker and manifest bundle the SDK; React is provided by the host page at
runtime and stays external in the UI bundle.

## License

MIT © [@herrhelms](https://github.com/herrhelms)
