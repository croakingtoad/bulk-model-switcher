// esbuild.config.mjs — three build targets for the Model Switcher plugin.
//
//   dist/worker.js    — worker entry (Node/host runtime)
//   dist/manifest.js  — plugin manifest (Node/host runtime)
//   dist/ui/index.js  — UI bundle (browser); entrypoints.ui is a DIRECTORY
//
// React is provided by the host page at runtime, so it stays external in the UI
// bundle. The worker + manifest MUST bundle @paperclipai/plugin-sdk — the host
// installs the plugin where the SDK is NOT a sibling, so an external SDK import
// throws ERR_MODULE_NOT_FOUND at worker spawn.

import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

// The browser UI gets React from the host at runtime — keep it (and the SDK UI
// entry) external so it isn't double-bundled into the page.
const uiExternals = [
  "@paperclipai/plugin-sdk",
  "@paperclipai/plugin-sdk/ui",
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react-dom/client",
];

// React is never imported server-side; keep it external as a no-op guard so an
// accidental import never bloats the worker bundle.
const serverExternals = ["react", "react-dom", "react/jsx-runtime", "react-dom/client"];

/** @type {import('esbuild').BuildOptions[]} */
const targets = [
  {
    entryPoints: ["src/worker.ts"],
    outfile: "dist/worker.js",
    platform: "node",
    format: "esm",
    target: "node22",
    bundle: true,
    sourcemap: true,
    external: serverExternals,
  },
  {
    entryPoints: ["src/manifest.ts"],
    outfile: "dist/manifest.js",
    platform: "node",
    format: "esm",
    target: "node22",
    bundle: true,
    sourcemap: true,
    external: serverExternals,
  },
  {
    entryPoints: ["src/ui/index.tsx"],
    outfile: "dist/ui/index.js",
    platform: "browser",
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    bundle: true,
    sourcemap: true,
    external: uiExternals,
  },
];

if (watch) {
  const contexts = await Promise.all(targets.map((t) => context(t)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log("esbuild: watching worker + manifest + ui …");
} else {
  await Promise.all(targets.map((t) => build(t)));
  console.log("esbuild: built worker + manifest + ui");
}
