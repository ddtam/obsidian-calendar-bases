// Verify the plugin's build artifacts (main.js, styles.css, manifest.json)
// are present at the repo root, so a release can be cut from them.
//
// Run after `npm run build`:
//   $ npm run brat:build
//
// This is the dry-run half of `npm run brat:release` — it checks that a
// production build actually produced everything BRAT needs, without bumping
// versions, committing, or publishing anything.

import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const artifacts = ["main.js", "styles.css", "manifest.json"];

for (const f of artifacts) {
  const path = resolve(root, f);
  try {
    await access(path);
  } catch {
    console.error(`error: ${f} not found at ${path}`);
    console.error("Run `npm run build` first.");
    process.exit(1);
  }
  console.log(`ok: ${f}`);
}

console.log("\nArtifacts are ready. To publish them:");
console.log("  npm run brat:release -- <version>");
