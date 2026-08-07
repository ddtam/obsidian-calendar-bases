// Single-step release for the Calendar Bases fork. Bumps versions, builds,
// commits, pushes, and creates a GitHub release with the build artifacts
// attached.
//
// Usage:
//   $ npm run brat:release -- <version> [--notes "..."]
//
// Examples:
//   $ npm run brat:release -- 0.3.15
//   $ npm run brat:release -- 0.3.15 --notes "faster month flips"
//
// If --notes is omitted, the release notes are populated from
// `git log <previous-version>..HEAD` between the prior release tag and HEAD.
// The notes can always be edited on GitHub afterward.
//
// Note: `main.js` is gitignored in this repo (upstream's convention, kept).
// It is therefore attached to the GitHub release but never committed —
// BRAT reads it from the release assets, not from the tree.

import { execSync } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const die = (msg) => {
  console.error(`error: ${msg}`);
  process.exit(1);
};

const args = process.argv.slice(2);
const version = args[0];
if (!version || version.startsWith("--")) {
  die('version is required\n  usage: npm run brat:release -- <version> [--notes "..."]');
}

let userNotes;
const notesFlagIdx = args.indexOf("--notes");
if (notesFlagIdx !== -1) {
  userNotes = args[notesFlagIdx + 1];
  if (!userNotes) {
    die("--notes flag provided without a value");
  }
}

// 1. Read + bump manifest.json
const manifestPath = resolve(root, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const previousVersion = manifest.version;
if (previousVersion === version) {
  die(`version ${version} is already the current version in manifest.json`);
}
manifest.version = version;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest.json: ${previousVersion} -> ${version}`);

// 2. Add to versions.json (insert at top so newest is first)
const versionsPath = resolve(root, "versions.json");
const versions = JSON.parse(await readFile(versionsPath, "utf8"));
if (versions[version]) {
  die(`${version} already exists in versions.json`);
}
const newVersions = { [version]: manifest.minAppVersion, ...versions };
await writeFile(versionsPath, `${JSON.stringify(newVersions, null, 2)}\n`);
console.log(`versions.json: + "${version}": "${manifest.minAppVersion}"`);

// 3. Build (esbuild writes main.js to the repo root in production mode)
console.log("\n--- building ---");
execSync("npm run build", { cwd: root, stdio: "inherit" });

// 4. Verify artifacts exist at root
for (const f of ["main.js", "styles.css", "manifest.json"]) {
  try {
    await access(resolve(root, f));
  } catch {
    die(`build did not produce ${f} at ${resolve(root, f)}`);
  }
}
console.log("verified: main.js, styles.css, manifest.json");

// 5. Determine fork remote + GitHub repo (org/repo)
let forkRemote = "fork";
try {
  execSync("git remote get-url fork", { cwd: root, stdio: "ignore" });
} catch {
  // Fall back to whatever the current branch tracks.
  forkRemote = execSync("git rev-parse --abbrev-ref --symbolic-full-name @{upstream}", {
    cwd: root,
  })
    .toString()
    .trim()
    .split("/")[0];
}
const remoteUrl = execSync(`git remote get-url ${forkRemote}`, { cwd: root }).toString().trim();
const repoMatch = remoteUrl.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
if (!repoMatch) {
  die(`cannot parse GitHub repo from remote URL '${remoteUrl}'`);
}
const repo = repoMatch[1];
console.log(`\nfork remote: ${forkRemote} -> ${repo}`);

// 6. Auto-generate notes from commits since the previous release tag,
//    unless the user supplied --notes.
let notes;
if (userNotes !== undefined) {
  notes = userNotes;
} else {
  try {
    execSync(`git fetch ${forkRemote} --tags --quiet`, { cwd: root });
    // The format string must be quoted: unquoted, the shell splits it on the
    // space and git reads "%s" as a revision, failing with "ambiguous argument".
    const log = execSync(`git log --pretty='format:- %s' ${previousVersion}..HEAD`, {
      cwd: root,
    })
      .toString()
      .trim();
    notes = log.length > 0 ? log : `Release ${version}.`;
  } catch {
    notes = `Release ${version}.`;
  }
}

// 7. Commit + push. main.js is gitignored here, so only the tracked
//    artifacts are staged.
console.log("\n--- committing + pushing ---");
execSync("git add manifest.json versions.json styles.css", { cwd: root, stdio: "inherit" });
execSync(`git commit -m "release: ${version}"`, { cwd: root, stdio: "inherit" });
execSync(`git push ${forkRemote} HEAD`, { cwd: root, stdio: "inherit" });

// 8. Create GitHub release. Published immediately — no draft is left behind.
console.log("\n--- creating GitHub release ---");
execSync(
  `gh release create ${version} main.js styles.css manifest.json` +
    ` --repo ${repo}` +
    ` --title "Calendar Bases ${version}"` +
    " --notes-file -",
  { cwd: root, stdio: ["pipe", "inherit", "inherit"], input: notes },
);

console.log(`\ndone: Calendar Bases ${version} released to ${repo}.`);
