# Changelog

## 0.0.2

- After **Apply**, successfully-updated agents are cleared from the selection
  for a fresh slate; any that failed stay selected so you can retry them.

## 0.0.1

Initial release.

- Company page at `/:companyPrefix/bulk-model-switcher`.
- Multiselect agents (with select-all); terminated agents are not selectable.
- Curated **Model** and **Reasoning effort** dropdowns, each with a
  "Leave unchanged" option so you can retarget one field or both.
- Single-click **Apply** with a per-agent ✓/✗ result and a roster refresh.
- Reachable from a sidebar entry and a link on the plugin's settings screen.
- Read via `ctx.agents.list` (`agents.read`); write via same-origin
  `PATCH /api/agents/:id` with `replaceAdapterConfig: false` (merge-preserving).
  No stored secret; the adapter type is never changed.
