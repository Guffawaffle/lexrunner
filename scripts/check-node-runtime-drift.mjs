#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const read = (path) => readFileSync(join(rootDir, path), "utf8");
const requireMatch = (path, pattern, message) => {
  if (!pattern.test(read(path))) failures.push(`${path}: ${message}`);
};

const packageJson = JSON.parse(read("package.json"));
const packageLock = JSON.parse(read("package-lock.json"));
if (packageJson.engines?.node !== ">=24") {
  failures.push(`package.json: engines.node must be >=24, got ${packageJson.engines?.node}`);
}
if (packageLock.packages?.[""]?.engines?.node !== ">=24") {
  failures.push(
    `package-lock.json: root engines.node must be >=24, got ${packageLock.packages?.[""]?.engines?.node}`
  );
}
if (packageJson.packageManager !== "npm@11.16.0") {
  failures.push(`package.json: packageManager must match Node 24's npm 11.16.0 toolchain`);
}

if (read(".nvmrc").trim() !== "24") failures.push(".nvmrc: expected major-only pin 24");
requireMatch(".tool-versions", /^node 24$/m, "Node pin must agree with .nvmrc");
requireMatch(".tool-versions", /^npm 11\.16\.0$/m, "npm pin must agree with Node 24 toolchain");
requireMatch(
  "src/runtime-contract.ts",
  /NODE_RUNTIME_MAJOR = 24;[\s\S]*NODE_ENGINE_RANGE = ">=24";/,
  "runtime constants must agree with package metadata"
);
requireMatch(
  "src/application/workspace-config-services.ts",
  /required: NODE_ENGINE_RANGE/,
  "doctor must report the package runtime floor"
);

const expectedActions = new Map([
  ["checkout", "7"],
  ["setup-node", "7"],
  ["cache", "6"],
  ["cache/save", "6"],
  ["cache/restore", "6"],
  ["upload-artifact", "7"],
  ["github-script", "9"],
  ["add-to-project", "2"],
]);

for (const path of filesUnder(".github/workflows", /\.ya?ml$/)) {
  const source = read(path);
  for (const match of source.matchAll(/actions\/([\w/-]+)@v(\d+)/g)) {
    const expected = expectedActions.get(match[1]);
    if (!expected) failures.push(`${path}: unreviewed first-party JavaScript action ${match[0]}`);
    else if (match[2] !== expected) {
      failures.push(`${path}: ${match[1]} must use Node-24-native major v${expected}`);
    }
  }
  if (/node-version:\s*["']?(?:20|22)["']?/i.test(source)) {
    failures.push(`${path}: active workflows must not select Node 20 or 22`);
  }
  if (/actions\/create-release@/i.test(source)) {
    failures.push(`${path}: retired create-release action must be replaced by GitHub CLI`);
  }
}

const guidanceFiles = [
  "README.md",
  "CONTRIBUTING.md",
  "MERGE_WEAVE_QUICKSTART.md",
  ...filesUnder("docs", /\.md$/),
  ...filesUnder("examples", /\.md$/),
  ...filesUnder("executors", /\.md$/),
];
for (const path of guidanceFiles) {
  const source = read(path);
  if (/node-version:\s*["']?(?:20|22)["']?/i.test(source)) {
    failures.push(`${path}: current example selects Node 20 or 22`);
  }
  if (/Node(?:\.js)? (?:20|22)(?:\+| LTS| or later|\.x)/i.test(source)) {
    failures.push(`${path}: current guidance advertises Node 20 or 22`);
  }
}

if (failures.length > 0) {
  console.error(`Node runtime drift detected (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify({
    engine: packageJson.engines.node,
    pin: read(".nvmrc").trim(),
    workflowFiles: filesUnder(".github/workflows", /\.ya?ml$/).length,
    guidanceFiles: guidanceFiles.length,
    status: "aligned",
  })
);

function filesUnder(directory, pattern) {
  const absolute = join(rootDir, directory);
  return readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => {
      const child = join(absolute, entry.name);
      if (entry.isDirectory()) return filesUnder(relative(rootDir, child), pattern);
      return pattern.test(entry.name) ? [relative(rootDir, child)] : [];
    })
    .sort();
}
