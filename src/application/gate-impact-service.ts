import * as fs from "node:fs";
import * as path from "node:path";

import { execa } from "execa";

import type { Plan } from "../schema.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";

const MAX_CHANGED_FILES = 2048;
const MAX_TESTS = 256;
const MAX_RECEIPT_BYTES = 256 * 1024;

export const GATE_IMPACT_MODEL = {
  version: "1.0.0",
  docsPrefixes: ["docs/"],
  docsFiles: ["README.md", "README.mcp.md"],
  fullSuitePrefixes: [
    ".github/",
    "schemas/",
    "scripts/",
    "src/mcp/",
    "src/sdk/",
    "src/store/",
    "tests/fixtures/",
    "tests/helpers/",
  ],
  fullSuiteFiles: [
    "mcp-server.mjs",
    ".npmrc",
    "CHANGELOG.md",
    "LICENSE.md",
    "NOTICE.md",
    "package.json",
    "package-lock.json",
    "src/cli.ts",
    "src/schema.ts",
    "tsconfig.json",
    "tsup.config.ts",
    "vitest.config.ts",
    "vitest.git.config.ts",
  ],
  adjacentOwners: {
    "src/gates.ts": [
      "tests/gates.test.ts",
      "tests/application/gate-execution-service.spec.ts",
      "tests/weave-contract.test.ts",
    ],
    "src/application/gate-execution-service.ts": [
      "tests/application/gate-execution-service.spec.ts",
      "tests/gates.test.ts",
      "tests/weave-contract.test.ts",
    ],
    "src/commands/execute.ts": [
      "tests/application/gate-execution-service.spec.ts",
      "tests/architecture/cli-mcp-surface.spec.ts",
      "tests/gates.test.ts",
    ],
  } as Record<string, string[]>,
} as const;

export type GateImpactMode = "focused" | "docs" | "full";

export interface GateImpactSelection {
  schemaVersion: "1.0.0";
  contract: "bounded-ax-v1";
  modelVersion: string;
  baseSha: string;
  headSha: string;
  mode: GateImpactMode;
  changedFiles: string[];
  selectedTests: Array<{ path: string; rationale: string[] }>;
  staticCommands: string[];
  testCommand: string;
  documentationCommand?: string;
  fallbackReason?: string;
}

export class GateImpactServiceError extends Error {
  constructor(
    readonly code:
      "GATE_IMPACT_INVALID_INPUT" | "GATE_IMPACT_DIFF_FAILED" | "GATE_IMPACT_RESULT_LIMIT_EXCEEDED",
    message: string
  ) {
    super(message);
    this.name = "GateImpactServiceError";
  }
}

type ChangedFileLoader = (repoRoot: string, baseSha: string, headSha: string) => Promise<string[]>;

/** Resolve a deterministic, conservative implementation-gate test selection. */
export class GateImpactService {
  constructor(private readonly loadChangedFiles: ChangedFileLoader = gitChangedFiles) {}

  async select(input: {
    repoRoot: string;
    baseSha: string;
    headSha: string;
  }): Promise<GateImpactSelection> {
    validateSha(input.baseSha, "baseSha");
    validateSha(input.headSha, "headSha");
    let changedFiles: string[];
    try {
      changedFiles = normalizeFiles(
        await this.loadChangedFiles(input.repoRoot, input.baseSha, input.headSha)
      );
    } catch {
      throw new GateImpactServiceError(
        "GATE_IMPACT_DIFF_FAILED",
        "Unable to resolve changed files for the explicit base/head pair"
      );
    }
    if (changedFiles.length > MAX_CHANGED_FILES) {
      return fullSelection(input, changedFiles.slice(0, MAX_CHANGED_FILES), "changed-file limit");
    }
    const highRisk = changedFiles.find(isFullSuiteTrigger);
    if (highRisk) return fullSelection(input, changedFiles, `high-risk surface: ${highRisk}`);

    if (changedFiles.length > 0 && changedFiles.every(isDocumentationFile)) {
      const documentationCommand = docsCommand(input.baseSha, input.headSha);
      return boundedSelection({
        ...baseSelection(input, changedFiles),
        mode: "docs",
        selectedTests: [],
        testCommand: documentationCommand,
        documentationCommand,
      });
    }

    const rationales = new Map<string, Set<string>>();
    for (const changedFile of changedFiles) {
      if (isDocumentationFile(changedFile)) continue;
      if (isTestFile(changedFile)) {
        addRationale(rationales, changedFile, `changed test: ${changedFile}`);
        continue;
      }
      const candidates = directOwnerCandidates(changedFile);
      const existing = candidates.filter((candidate) =>
        fs.existsSync(path.join(input.repoRoot, candidate))
      );
      for (const candidate of existing) {
        addRationale(rationales, candidate, `direct owner of ${changedFile}`);
      }
      for (const adjacent of GATE_IMPACT_MODEL.adjacentOwners[changedFile] ?? []) {
        if (fs.existsSync(path.join(input.repoRoot, adjacent))) {
          addRationale(rationales, adjacent, `adjacent contract for ${changedFile}`);
        }
      }
      if (existing.length === 0 && !(changedFile in GATE_IMPACT_MODEL.adjacentOwners)) {
        return fullSelection(input, changedFiles, `unknown source mapping: ${changedFile}`);
      }
    }

    const selectedTests = [...rationales.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([testPath, reasons]) => ({ path: testPath, rationale: [...reasons].sort() }));
    if (selectedTests.length > MAX_TESTS) {
      return fullSelection(input, changedFiles, "selected-test limit");
    }
    const focusedCommand =
      selectedTests.length === 0
        ? "npm run typecheck"
        : `npx vitest run ${selectedTests.map(({ path: testPath }) => shellQuote(testPath)).join(" ")}`;
    const documentationCommand = changedFiles.some(isDocumentationFile)
      ? docsCommand(input.baseSha, input.headSha)
      : undefined;
    const testCommand = documentationCommand
      ? `${documentationCommand} && ${focusedCommand}`
      : focusedCommand;
    return boundedSelection({
      ...baseSelection(input, changedFiles),
      mode: "focused",
      selectedTests,
      testCommand,
      ...(documentationCommand ? { documentationCommand } : {}),
    });
  }
}

export function applyGateImpactSelection(plan: Plan, selection: GateImpactSelection): Plan {
  if (selection.mode === "full") return structuredClone(plan);
  const effective = structuredClone(plan);
  for (const item of effective.items) {
    for (const gate of item.gates ?? []) {
      if (gate.name === "test") gate.run = selection.testCommand;
    }
  }
  return effective;
}

export function writeGateImpactReceipt(
  selection: GateImpactSelection,
  artifactDir: string
): string {
  fs.mkdirSync(artifactDir, { recursive: true });
  const receiptPath = path.join(artifactDir, "gate-impact-selection.json");
  fs.writeFileSync(receiptPath, canonicalJSONStringify(selection), "utf8");
  return receiptPath;
}

async function gitChangedFiles(
  repoRoot: string,
  baseSha: string,
  headSha: string
): Promise<string[]> {
  const { stdout } = await execa(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMR", `${baseSha}...${headSha}`],
    { cwd: repoRoot }
  );
  return stdout.split(/\r?\n/).filter(Boolean);
}

function baseSelection(
  input: { baseSha: string; headSha: string },
  changedFiles: string[]
): Omit<GateImpactSelection, "mode" | "selectedTests" | "testCommand"> {
  return {
    schemaVersion: "1.0.0",
    contract: "bounded-ax-v1",
    modelVersion: GATE_IMPACT_MODEL.version,
    baseSha: input.baseSha,
    headSha: input.headSha,
    changedFiles,
    staticCommands: ["npm run lint", "npm run build", "npm run validate:package"],
  };
}

function fullSelection(
  input: { baseSha: string; headSha: string },
  changedFiles: string[],
  fallbackReason: string
): GateImpactSelection {
  const documentationCommand = changedFiles.some(isDocumentationFile)
    ? docsCommand(input.baseSha, input.headSha)
    : undefined;
  return boundedSelection({
    ...baseSelection(input, changedFiles),
    mode: "full",
    selectedTests: [],
    testCommand: documentationCommand ? `${documentationCommand} && npm test` : "npm test",
    ...(documentationCommand ? { documentationCommand } : {}),
    fallbackReason,
  });
}

function boundedSelection(selection: GateImpactSelection): GateImpactSelection {
  if (Buffer.byteLength(JSON.stringify(selection), "utf8") > MAX_RECEIPT_BYTES) {
    throw new GateImpactServiceError(
      "GATE_IMPACT_RESULT_LIMIT_EXCEEDED",
      "Gate impact selection exceeds the bounded receipt limit"
    );
  }
  return selection;
}

function normalizeFiles(files: string[]): string[] {
  return [...new Set(files.map((file) => file.replace(/\\/g, "/").replace(/^\.\//, "")))].sort();
}

function isDocumentationFile(file: string): boolean {
  return (
    file.endsWith(".md") ||
    GATE_IMPACT_MODEL.docsFiles.includes(file as (typeof GATE_IMPACT_MODEL.docsFiles)[number]) ||
    GATE_IMPACT_MODEL.docsPrefixes.some((prefix) => file.startsWith(prefix))
  );
}

function isFullSuiteTrigger(file: string): boolean {
  return (
    GATE_IMPACT_MODEL.fullSuiteFiles.includes(
      file as (typeof GATE_IMPACT_MODEL.fullSuiteFiles)[number]
    ) ||
    GATE_IMPACT_MODEL.fullSuitePrefixes.some((prefix) => file.startsWith(prefix)) ||
    /(^|\/)(?:tsconfig|vitest|eslint|prettier)[^/]*\.(?:js|mjs|cjs|ts|json)$/.test(file)
  );
}

function isTestFile(file: string): boolean {
  return file.startsWith("tests/") && /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file);
}

function directOwnerCandidates(file: string): string[] {
  if (!file.startsWith("src/") || !/\.[cm]?tsx?$/.test(file)) return [];
  const relative = file.replace(/^src\//, "").replace(/\.[cm]?tsx?$/, "");
  const basename = path.posix.basename(relative);
  return [
    `tests/${relative}.spec.ts`,
    `tests/${relative}.test.ts`,
    `tests/${basename}.spec.ts`,
    `tests/${basename}.test.ts`,
  ];
}

function addRationale(target: Map<string, Set<string>>, testPath: string, rationale: string): void {
  const reasons = target.get(testPath) ?? new Set<string>();
  reasons.add(rationale);
  target.set(testPath, reasons);
}

function validateSha(value: string, field: string): void {
  if (!/^[0-9a-f]{7,40}$/i.test(value)) {
    throw new GateImpactServiceError(
      "GATE_IMPACT_INVALID_INPUT",
      `${field} must be an explicit Git commit SHA`
    );
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function docsCommand(baseSha: string, headSha: string): string {
  return `npm run docs:check -- --base ${baseSha} --head ${headSha}`;
}
