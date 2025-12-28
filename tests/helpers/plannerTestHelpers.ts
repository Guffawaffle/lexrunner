/**
 * Test helpers for diffgraph planner E2E tests
 * Provides mock creation, fixture loading, and assertion utilities
 */

import * as fs from "fs/promises";
import * as path from "path";

/**
 * Mock PR structure matching GitHub API response
 */
export interface MockPR {
  number: number;
  title: string;
  body: string | null;
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes?: number;
    patch?: string;
  }>;
  state?: "open" | "closed";
  merged?: boolean;
  base?: {
    ref: string;
    sha?: string;
  };
  head?: {
    ref: string;
    sha?: string;
  };
}

/**
 * Create a mock PR with controlled properties
 */
export function createMockPR(params: {
  number: number;
  title: string;
  body: string | null;
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes?: number;
    patch?: string;
  }>;
  state?: "open" | "closed";
  merged?: boolean;
}): MockPR {
  return {
    number: params.number,
    title: params.title,
    body: params.body,
    files: params.files.map((f) => ({
      ...f,
      changes: f.changes ?? f.additions + f.deletions,
    })),
    state: params.state ?? "open",
    merged: params.merged ?? false,
    base: {
      ref: "main",
      sha: `base-sha-${params.number}`,
    },
    head: {
      ref: `pr-${params.number}`,
      sha: `head-sha-${params.number}`,
    },
  };
}

/**
 * Mock Octokit client interface
 */
export interface MockOctokit {
  rest: {
    pulls: {
      list: () => Promise<{ data: MockPR[] }>;
      get: (params: { pull_number: number }) => Promise<{ data: MockPR }>;
      listFiles: (params: { pull_number: number }) => Promise<{ data: MockPR["files"] }>;
    };
  };
}

/**
 * Create a mock Octokit client with fixture PRs
 */
export function createMockGitHub(prs: MockPR[]): MockOctokit {
  const prMap = new Map(prs.map((pr) => [pr.number, pr]));

  return {
    rest: {
      pulls: {
        list: async () => ({
          data: prs.filter((pr) => pr.state === "open"),
        }),
        get: async ({ pull_number }: { pull_number: number }) => {
          const pr = prMap.get(pull_number);
          if (!pr) {
            throw new Error(`PR #${pull_number} not found`);
          }
          return { data: pr };
        },
        listFiles: async ({ pull_number }: { pull_number: number }) => {
          const pr = prMap.get(pull_number);
          if (!pr) {
            throw new Error(`PR #${pull_number} not found`);
          }
          return { data: pr.files };
        },
      },
    },
  };
}

/**
 * Fixture structure for plan tests
 */
export interface PlanFixture {
  description: string;
  prs: MockPR[];
  expectedPlan?: {
    layers?: string[][];
    orphans?: string[];
    warnings?: number;
    errors?: string[];
    suggestions?: number;
  };
}

/**
 * Load fixture from file
 */
export async function loadFixture(name: string): Promise<PlanFixture> {
  const fixturePath = path.join(process.cwd(), "tests", "fixtures", "planner", `${name}.json`);

  try {
    const content = await fs.readFile(fixturePath, "utf-8");
    return JSON.parse(content) as PlanFixture;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load fixture "${name}": ${message}`);
  }
}

/**
 * Expected plan structure for assertions
 */
export interface ExpectedPlanStructure {
  layers?: string[][];
  orphans?: string[];
  warnings?: number;
  errors?: string[];
}

/**
 * Plan structure returned by generatePlanFromParsedPRs
 */
export interface PlanStructure {
  layers: string[][];
  orphans: string[];
  nodes: string[];
  edges: Array<{ from: string; to: string }>;
  warnings?: any[];
  errors?: any[];
}

/**
 * Assert plan structure matches expected
 */
export function assertPlanStructure(plan: PlanStructure, expected: ExpectedPlanStructure): void {
  if (expected.layers) {
    // Verify layer count
    if (!plan.layers || !Array.isArray(plan.layers)) {
      throw new Error("Plan does not have layers array");
    }

    if (plan.layers.length !== expected.layers.length) {
      throw new Error(`Expected ${expected.layers.length} layers, got ${plan.layers.length}`);
    }

    // Verify each layer
    for (let i = 0; i < expected.layers.length; i++) {
      const expectedLayer = expected.layers[i].slice().sort();
      const actualLayer = plan.layers[i].slice().sort();

      if (JSON.stringify(expectedLayer) !== JSON.stringify(actualLayer)) {
        throw new Error(
          `Layer ${i} mismatch. Expected: ${JSON.stringify(expectedLayer)}, Got: ${JSON.stringify(actualLayer)}`
        );
      }
    }
  }

  if (expected.orphans) {
    if (!plan.orphans) {
      throw new Error("Plan does not have orphans array");
    }

    const expectedOrphans = expected.orphans.slice().sort();
    const actualOrphans = plan.orphans.slice().sort();

    if (JSON.stringify(expectedOrphans) !== JSON.stringify(actualOrphans)) {
      throw new Error(
        `Orphans mismatch. Expected: ${JSON.stringify(expectedOrphans)}, Got: ${JSON.stringify(actualOrphans)}`
      );
    }
  }

  if (expected.warnings !== undefined) {
    const actualWarnings = plan.warnings?.length ?? 0;
    if (actualWarnings !== expected.warnings) {
      throw new Error(`Expected ${expected.warnings} warnings, got ${actualWarnings}`);
    }
  }

  if (expected.errors) {
    if (!plan.errors || !Array.isArray(plan.errors)) {
      throw new Error("Plan does not have errors array");
    }

    if (plan.errors.length !== expected.errors.length) {
      throw new Error(`Expected ${expected.errors.length} errors, got ${plan.errors.length}`);
    }
  }
}

/**
 * Create mock file changes for a PR
 */
export function createMockFiles(
  filenames: string[],
  options: {
    status?: "added" | "modified" | "removed" | "renamed";
    additions?: number;
    deletions?: number;
  } = {}
): Array<{
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
}> {
  const status = options.status ?? "modified";
  const additions = options.additions ?? 10;
  const deletions = options.deletions ?? 5;

  return filenames.map((filename) => ({
    filename,
    status,
    additions,
    deletions,
    changes: additions + deletions,
  }));
}

/**
 * Create a batch of mock PRs for stress testing
 */
export function createMockPRBatch(count: number): MockPR[] {
  const prs: MockPR[] = [];

  for (let i = 0; i < count; i++) {
    const prNumber = 100 + i;
    prs.push(
      createMockPR({
        number: prNumber,
        title: `PR ${prNumber}: Feature ${i}`,
        body: i > 0 && i % 3 === 0 ? `Depends-on: #${100 + i - 1}` : null,
        files: createMockFiles([`src/feature-${i}.ts`, `tests/feature-${i}.spec.ts`]),
      })
    );
  }

  return prs;
}

/**
 * Assert that two objects are deeply equal (for determinism tests)
 */
export function assertDeepEqual<T>(actual: T, expected: T, path: string = "root"): void {
  if (actual === expected) return;

  if (actual == null || expected == null) {
    throw new Error(`Deep equal failed at ${path}: ${actual} !== ${expected}`);
  }

  if (typeof actual !== typeof expected) {
    throw new Error(`Type mismatch at ${path}: ${typeof actual} !== ${typeof expected}`);
  }

  if (typeof actual === "object") {
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();

    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
      throw new Error(
        `Keys mismatch at ${path}. Expected: ${expectedKeys.join(", ")}, Got: ${actualKeys.join(", ")}`
      );
    }

    for (const key of actualKeys) {
      assertDeepEqual(actual[key], expected[key], `${path}.${key}`);
    }
  } else {
    if (actual !== expected) {
      throw new Error(`Value mismatch at ${path}: ${actual} !== ${expected}`);
    }
  }
}
