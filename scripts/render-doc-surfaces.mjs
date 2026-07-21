#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { format, resolveConfig } from "prettier";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const matrix = JSON.parse(read("docs/architecture/cli-mcp-surface.json"));
const packageJson = JSON.parse(read("package.json"));
const prettierOptions = (await resolveConfig(join(root, "README.md"))) ?? {};

const classifications = ["canonical", "compatibility", "deprecated", "internal-only", "remove"];
const cliCounts = Object.fromEntries(
  classifications.map((classification) => [classification, matrix.cli[classification].length])
);
const mcpCounts = Object.fromEntries(
  classifications.map((classification) => [classification, matrix.mcp[classification].length])
);

const surface = await formatMarkdown(
  [
    "<!-- BEGIN GENERATED AX SURFACE -->",
    `Matrix schema: **${matrix.schemaVersion}**. Live inventory: **${sum(cliCounts)} CLI registrations** and **${sum(mcpCounts)} MCP tools**.`,
    "",
    "| Surface | Canonical | Compatibility | Deprecated | Internal only | Remove |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    `| CLI | ${cliCounts.canonical} | ${cliCounts.compatibility} | ${cliCounts.deprecated} | ${cliCounts["internal-only"]} | ${cliCounts.remove} |`,
    `| MCP | ${mcpCounts.canonical} | ${mcpCounts.compatibility} | ${mcpCounts.deprecated} | ${mcpCounts["internal-only"]} | ${mcpCounts.remove} |`,
    "",
    "### Canonical CLI/MCP semantic pairs",
    "",
    "| MCP tool | CLI operation | Owning application service |",
    "| --- | --- | --- |",
    ...matrix.mcp.parity.map(
      ({ tool, cli, owner }) => `| \`${tool}\` | \`lex-pr ${cli}\` | \`${owner}\` |`
    ),
    "",
    "### Intentional parity exceptions",
    "",
    ...matrix.mcp.intentionalParityExceptions.map(
      ({ tool, cli, reason }) =>
        `- ${tool ? `MCP \`${tool}\`` : `CLI \`lex-pr ${cli}\``}: ${reason}`
    ),
    "",
    "### Published deprecated MCP tools",
    "",
    ...matrix.mcp.deprecated.map(
      ({ tool, replacement, removeIn }) =>
        `- \`${tool}\` → ${replacement}; remove in ${removeIn ?? "a separately declared release"}.`
    ),
    "<!-- END GENERATED AX SURFACE -->",
  ].join("\n")
);

const version = await formatMarkdown(
  [
    "<!-- BEGIN GENERATED PACKAGE VERSION -->",
    `Current repository package version: **${packageJson.version}**. npm availability and dist-tags are separate`,
    "release evidence; inspect the registry rather than inferring publication from source metadata.",
    "<!-- END GENERATED PACKAGE VERSION -->",
  ].join("\n")
);

const results = [
  updateBlock("docs/AX.md", "GENERATED AX SURFACE", surface),
  updateBlock("README.md", "GENERATED PACKAGE VERSION", version),
];

if (check && results.some(({ changed }) => changed)) {
  for (const { path, changed } of results)
    if (changed) console.error(`${path}: generated block drift`);
  process.exit(1);
}

if (!check) {
  for (const result of results)
    if (result.changed) writeFileSync(join(root, result.path), result.next);
}

console.log(
  JSON.stringify({
    status: check ? "verified" : "rendered",
    packageVersion: packageJson.version,
    cliRegistrations: sum(cliCounts),
    mcpTools: sum(mcpCounts),
    changed: results.filter(({ changed }) => changed).map(({ path }) => path),
  })
);

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function updateBlock(path, name, replacement) {
  const current = read(path);
  const pattern = new RegExp(
    `<!-- BEGIN ${escapeRegExp(name)} -->[\\s\\S]*?<!-- END ${escapeRegExp(name)} -->`
  );
  if (!pattern.test(current)) throw new Error(`${path}: missing generated block ${name}`);
  const next = `${current.replace(pattern, replacement).trimEnd()}\n`;
  return { path, next, changed: next !== current };
}

function sum(counts) {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function formatMarkdown(value) {
  return (await format(value, { ...prettierOptions, parser: "markdown" })).trim();
}
