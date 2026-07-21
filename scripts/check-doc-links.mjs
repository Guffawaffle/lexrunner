#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";

const root = process.cwd();
let base = option("--base");
let head = option("--head");
if ((base && !head) || (!base && head)) {
  console.error("--base and --head must be supplied together");
  process.exit(2);
}
if (!base && !head) {
  head = "HEAD";
  try {
    base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    base = "HEAD";
  }
}
const markdownFiles = base
  ? execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMR", `${base}...${head}`], {
      cwd: root,
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .filter((file) => file.endsWith(".md"))
      .map((file) => join(root, file))
      .filter(existsSync)
  : [
      ...walk(join(root, "docs")),
      ...["README.md", "README.mcp.md", "CHANGELOG.md", "NOTICE.md", "LICENSE.md"]
        .map((file) => join(root, file))
        .filter(existsSync),
    ];
const failures = [];
for (const file of markdownFiles.sort()) {
  const content = readFileSync(file, "utf8");
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, "");
    if (
      !rawTarget ||
      rawTarget.startsWith("#") ||
      /^(?:https?:|mailto:|data:)/i.test(rawTarget) ||
      rawTarget.includes("{{")
    ) {
      continue;
    }
    const target = decodeURIComponent(rawTarget.split("#", 1)[0]);
    const resolvedTarget = isAbsolute(target)
      ? resolve(root, target.replace(/^[/\\]+/, ""))
      : resolve(dirname(file), target);
    if (!existsSync(resolvedTarget)) {
      failures.push(`${file.slice(root.length + 1)} -> ${rawTarget}`);
    }
  }
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (failures.length > 0) {
  console.error(`Broken local documentation links (${failures.length}):`);
  for (const failure of failures.slice(0, 100)) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ checkedMarkdownFiles: markdownFiles.length, brokenLinks: 0 }));
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const name of readdirSync(directory).sort()) {
    const entry = join(directory, name);
    if (statSync(entry).isDirectory()) files.push(...walk(entry));
    else if (extname(entry) === ".md") files.push(entry);
  }
  return files;
}
