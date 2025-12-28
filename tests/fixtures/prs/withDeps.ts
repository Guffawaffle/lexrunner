/**
 * PR fixtures with dependencies
 */

import { basic, type MockPR } from "./basic.js";

export interface PRWithDepsOptions {
  number: number;
  title: string;
  dependsOn: number[];
  files?: string[];
  labels?: string[];
}

/**
 * Create a PR with dependency annotations in the body
 */
export function withDeps(options: PRWithDepsOptions): MockPR {
  const { number, title, dependsOn, files, labels } = options;

  // Create dependency annotations
  const depsText =
    dependsOn.length > 0 ? `\n\nDepends on: ${dependsOn.map((n) => `#${n}`).join(", ")}` : "";

  const body = `This PR implements ${title.toLowerCase()}.${depsText}`;

  return basic({
    number,
    title,
    body,
    files: files ?? [`src/feature-${number}.ts`],
    labels: labels ?? ["feature"],
  });
}

/**
 * Create a PR with blocking labels (blocks other PRs)
 */
export function blocking(options: { number: number; title: string; blocks: number[] }): MockPR {
  const { number, title, blocks } = options;

  const blocksText =
    blocks.length > 0 ? `\n\nBlocks: ${blocks.map((n) => `#${n}`).join(", ")}` : "";

  return basic({
    number,
    title,
    body: `Foundation PR.${blocksText}`,
    labels: ["foundation", "blocking"],
  });
}

/**
 * Create a chain of dependent PRs
 * Returns array where each PR depends on the previous one
 */
export function chain(count: number, startNumber: number = 100): MockPR[] {
  const prs: MockPR[] = [];

  for (let i = 0; i < count; i++) {
    const number = startNumber + i;
    const dependsOn = i === 0 ? [] : [number - 1];

    prs.push(
      withDeps({
        number,
        title: `Chain step ${i + 1}`,
        dependsOn,
        files: [`src/chain/step-${i + 1}.ts`],
      })
    );
  }

  return prs;
}

/**
 * Create a diamond pattern of PRs:
 *     A   B
 *      \ /
 *       C
 */
export function diamond(startNumber: number = 100): MockPR[] {
  const a = startNumber;
  const b = startNumber + 1;
  const c = startNumber + 2;

  return [
    withDeps({
      number: a,
      title: "Foundation A",
      dependsOn: [],
    }),
    withDeps({
      number: b,
      title: "Foundation B",
      dependsOn: [],
    }),
    withDeps({
      number: c,
      title: "Integration C",
      dependsOn: [a, b],
    }),
  ];
}

/**
 * Create a complex dependency graph
 */
export function complex(prCount: number = 15): MockPR[] {
  const prs: MockPR[] = [];
  const startNumber = 100;

  // Create foundation PRs (no dependencies)
  const foundationCount = Math.ceil(prCount * 0.2);
  for (let i = 0; i < foundationCount; i++) {
    prs.push(
      withDeps({
        number: startNumber + i,
        title: `Foundation ${i + 1}`,
        dependsOn: [],
        labels: ["foundation"],
      })
    );
  }

  // Create feature PRs (depend on foundations)
  const featureCount = Math.ceil(prCount * 0.5);
  for (let i = 0; i < featureCount; i++) {
    const number = startNumber + foundationCount + i;
    const dependsOn = [startNumber + (i % foundationCount)];

    prs.push(
      withDeps({
        number,
        title: `Feature ${i + 1}`,
        dependsOn,
        labels: ["feature"],
      })
    );
  }

  // Create integration PRs (depend on features)
  const integrationCount = prCount - foundationCount - featureCount;
  for (let i = 0; i < integrationCount; i++) {
    const number = startNumber + foundationCount + featureCount + i;
    const featureStart = startNumber + foundationCount;
    const dependsOn = [
      featureStart + ((i * 2) % featureCount),
      featureStart + ((i * 2 + 1) % featureCount),
    ];

    prs.push(
      withDeps({
        number,
        title: `Integration ${i + 1}`,
        dependsOn,
        labels: ["integration"],
      })
    );
  }

  return prs;
}

/**
 * Create PRs with mixed dependency formats (testing parser robustness)
 */
export function mixedDependencyFormats(): MockPR[] {
  return [
    basic({
      number: 100,
      title: "Format test 1",
      body: "Depends on: #101",
    }),
    basic({
      number: 101,
      title: "Format test 2",
      body: "Depends-on: #102, #103",
    }),
    basic({
      number: 102,
      title: "Format test 3",
      body: "depends on #104",
    }),
    basic({
      number: 103,
      title: "Format test 4",
      body: "Blocked by: #104",
    }),
    basic({
      number: 104,
      title: "Format test 5",
      body: null,
    }),
  ];
}
