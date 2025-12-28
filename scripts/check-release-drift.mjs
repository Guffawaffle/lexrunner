#!/usr/bin/env node
/**
 * Release Drift Check
 *
 * Detects misalignment between package.json version and Git tags.
 *
 * Usage:
 *   npm run check:release-drift
 *   node scripts/check-release-drift.mjs
 *
 * Exit codes:
 *   0 - No drift (tag exists for current version)
 *   1 - Drift detected (tag missing for current version)
 *   2 - Script error
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

function getPackageVersion() {
  const pkgPath = join(rootDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  return pkg.version;
}

function getGitTags() {
  try {
    const output = execSync('git tag -l "v*"', {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function main() {
  const version = getPackageVersion();
  const expectedTag = `v${version}`;
  const tags = getGitTags();

  console.log(`📦 package.json version: ${version}`);
  console.log(`🏷️  Expected tag: ${expectedTag}`);

  if (tags.includes(expectedTag)) {
    console.log(`✅ Tag ${expectedTag} exists. No drift detected.`);
    process.exit(0);
  } else {
    console.log(`\n❌ DRIFT DETECTED: Tag ${expectedTag} does not exist.`);
    console.log(`\nExisting tags:`);
    const semverTags = tags.filter((t) => /^v\d+\.\d+\.\d+/.test(t));
    if (semverTags.length > 0) {
      semverTags.slice(-5).forEach((t) => console.log(`  - ${t}`));
      if (semverTags.length > 5) {
        console.log(`  ... and ${semverTags.length - 5} more`);
      }
    } else {
      console.log("  (none matching vX.Y.Z pattern)");
    }

    console.log(`\nTo fix, create the missing tag:`);
    console.log(`  git tag -s "${expectedTag}" -m "Release ${expectedTag}"`);
    console.log(`  git push origin "${expectedTag}"`);

    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error("❌ Script error:", err.message);
  process.exit(2);
}
