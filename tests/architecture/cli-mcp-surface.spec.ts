import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

import { inspectRegisteredCliSurface } from "../../src/cli.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const matrixPath = resolve(repositoryRoot, "docs/architecture/cli-mcp-surface.json");

type Disposition = "canonical" | "compatibility" | "deprecated" | "internal-only" | "remove";

interface Replacement {
  path?: string;
  tool?: string;
  replacement: string;
  owner?: string;
}

interface SurfaceMatrix {
  dispositions: Disposition[];
  nouns: Array<{ noun: string; owner: string; surface: string; decision: string }>;
  contractProfiles: Record<string, unknown>;
  cli: {
    canonical: string[];
    compatibility: Replacement[];
    deprecated: Replacement[];
    "internal-only": string[];
    remove: Array<string | Replacement>;
    humanOnly: string[];
    contractOverrides: Array<{ profile: string; operations: string[] }>;
    defaultCanonicalOperationContract: string;
    humanOnlyContract: string;
  };
  mcp: {
    canonical: string[];
    compatibility: Replacement[];
    deprecated: Replacement[];
    "internal-only": string[];
    remove: Array<string | Replacement>;
    contractOverrides: Array<{ profile: string; operations: string[] }>;
    defaultCanonicalOperationContract: string;
    parity: Array<{ tool: string; cli: string; owner: string }>;
    intentionalParityExceptions: Array<{ tool?: string; cli?: string; reason: string }>;
  };
  implementationGaps: Array<{ issue: number; title: string; surface: string[] }>;
}

describe("canonical CLI and MCP surface", () => {
  it("gives every live CLI registration exactly one explicit disposition", async () => {
    const matrix = await loadMatrix();
    const registered = inspectRegisteredCliSurface();
    const classified = flattenClassifications(matrix.cli, "path");

    expect(matrix.dispositions).toEqual([
      "canonical",
      "compatibility",
      "deprecated",
      "internal-only",
      "remove",
    ]);
    expect(new Set(classified).size).toBe(classified.length);
    expect([...classified].sort()).toEqual(registered.map(({ path }) => path).sort());

    for (const entry of [...matrix.cli.compatibility, ...matrix.cli.deprecated]) {
      expect(entry.path).toBeTruthy();
      expect(entry.replacement).toBeTruthy();
    }

    const canonicalOperations = registered
      .filter(({ kind, path }) => kind === "operation" && matrix.cli.canonical.includes(path))
      .map(({ path }) => path);
    expect(new Set(matrix.cli.humanOnly).size).toBe(matrix.cli.humanOnly.length);
    expect(matrix.cli.humanOnly.every((path) => canonicalOperations.includes(path))).toBe(true);

    assertContractCoverage(
      canonicalOperations,
      matrix.cli.humanOnly,
      matrix.cli.contractOverrides,
      matrix.cli.defaultCanonicalOperationContract,
      matrix.cli.humanOnlyContract,
      matrix.contractProfiles
    );
  });

  it("gives every published MCP tool exactly one disposition and a parity decision", async () => {
    const matrix = await loadMatrix();
    const published = await publishedMcpTools();
    const classified = flattenClassifications(matrix.mcp, "tool");

    expect(new Set(classified).size).toBe(classified.length);
    expect([...classified].sort()).toEqual([...published].sort());

    for (const entry of [...matrix.mcp.compatibility, ...matrix.mcp.deprecated]) {
      expect(entry.tool).toBeTruthy();
      expect(entry.replacement).toBeTruthy();
    }
    for (const entry of matrix.mcp.compatibility) expect(entry.owner).toBeTruthy();

    const parityTools = matrix.mcp.parity.map(({ tool }) => tool);
    const exceptionTools = matrix.mcp.intentionalParityExceptions.flatMap(({ tool }) =>
      tool ? [tool] : []
    );
    expect(new Set([...parityTools, ...exceptionTools]).size).toBe(
      parityTools.length + exceptionTools.length
    );
    expect([...parityTools, ...exceptionTools].sort()).toEqual([...matrix.mcp.canonical].sort());
    expect(matrix.mcp.parity.every(({ cli, owner }) => cli.length > 0 && owner.length > 0)).toBe(
      true
    );
    expect(matrix.mcp.intentionalParityExceptions.every(({ reason }) => reason.length > 0)).toBe(
      true
    );

    assertContractCoverage(
      matrix.mcp.canonical,
      [],
      matrix.mcp.contractOverrides,
      matrix.mcp.defaultCanonicalOperationContract,
      undefined,
      matrix.contractProfiles
    );
  });

  it("locks ADR-010 orchestration ownership away from the frozen RunStore", async () => {
    const matrix = await loadMatrix();
    const nouns = new Map(matrix.nouns.map((entry) => [entry.noun, entry]));

    expect(nouns.get("Run")?.owner).toBe("CoordinationStore");
    expect(nouns.get("IntegrationRun")?.owner).toBe("frozen RunStore");
    expect(nouns.get("IntegrationRun")?.decision).toContain("never orchestration authority");
    expect(nouns.get("Task")?.decision).toContain("compatibility only");
    expect(inspectRegisteredCliSurface().some(({ path }) => path === "task")).toBe(false);
  });

  it("assigns every planned parity service to an independently tracked gap", async () => {
    const matrix = await loadMatrix();
    const issueNumbers = matrix.implementationGaps.map(({ issue }) => issue);
    const coveredSurface = new Set(matrix.implementationGaps.flatMap(({ surface }) => surface));

    expect(new Set(issueNumbers).size).toBe(issueNumbers.length);
    expect(
      matrix.implementationGaps.every(({ issue, title }) => issue > 773 && title.length > 0)
    ).toBe(true);
    for (const parity of matrix.mcp.parity.filter(({ owner }) => owner.startsWith("planned "))) {
      expect(coveredSurface, `No implementation issue covers MCP ${parity.tool}`).toContain(
        parity.tool
      );
      if (!parity.cli.startsWith("planned ")) {
        expect(coveredSurface, `No implementation issue covers CLI ${parity.cli}`).toContain(
          parity.cli
        );
      }
    }
  });
});

function flattenClassifications(
  surface: Record<Disposition, Array<string | Replacement>>,
  key: "path" | "tool"
): string[] {
  return surfaceDispositionNames().flatMap((disposition) =>
    surface[disposition].map((entry) => {
      if (typeof entry === "string") return entry;
      const value = entry[key];
      if (!value) throw new Error(`Missing ${key} for ${disposition} surface entry`);
      return value;
    })
  );
}

function assertContractCoverage(
  canonical: string[],
  humanOnly: string[],
  overrides: Array<{ profile: string; operations: string[] }>,
  defaultProfile: string,
  humanProfile: string | undefined,
  profiles: Record<string, unknown>
): void {
  expect(profiles).toHaveProperty(defaultProfile);
  if (humanProfile) expect(profiles).toHaveProperty(humanProfile);

  const explicitlyCovered = new Set<string>();
  for (const { profile, operations } of overrides) {
    expect(profiles).toHaveProperty(profile);
    for (const operation of operations) {
      expect(canonical).toContain(operation);
      expect(explicitlyCovered.has(operation)).toBe(false);
      explicitlyCovered.add(operation);
    }
  }
  for (const operation of humanOnly) {
    expect(explicitlyCovered.has(operation)).toBe(false);
    explicitlyCovered.add(operation);
  }

  for (const operation of canonical) {
    expect(
      explicitlyCovered.has(operation) || Object.hasOwn(profiles, defaultProfile),
      `No output contract for ${operation}`
    ).toBe(true);
  }
}

function surfaceDispositionNames(): Disposition[] {
  return ["canonical", "compatibility", "deprecated", "internal-only", "remove"];
}

async function loadMatrix(): Promise<SurfaceMatrix> {
  return JSON.parse(await readFile(matrixPath, "utf8")) as SurfaceMatrix;
}

async function publishedMcpTools(): Promise<string[]> {
  const subprocess = execa("node", ["mcp-server.mjs"], {
    cwd: repositoryRoot,
    env: { ...process.env, ALLOW_MUTATIONS: "false" },
  });
  let stdout = "";
  const response = new Promise<{ result: { tools: Array<{ name: string }> } }>(
    (resolveResponse, rejectResponse) => {
      subprocess.stdout?.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
        const newline = stdout.indexOf("\n");
        if (newline >= 0) {
          resolveResponse(
            JSON.parse(stdout.slice(0, newline)) as {
              result: { tools: Array<{ name: string }> };
            }
          );
        }
      });
      subprocess.once("error", rejectResponse);
    }
  );

  subprocess.stdin?.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`
  );
  const result = await response;
  subprocess.stdin?.end();
  await subprocess;
  return result.result.tools.map(({ name }) => name);
}
