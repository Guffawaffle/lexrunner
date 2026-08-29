import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { GateExecutionService } from "../../src/application/gate-execution-service.js";
import { captureGateCandidateIdentity } from "../../src/application/gate-candidate-identity.js";
import { IntegrationStatusQueryService } from "../../src/application/integration-query-services.js";
import type { Plan } from "../../src/schema.js";
import { canonicalJSONStringify } from "../../src/util/canonicalJson.js";
import { sha256 } from "../../src/util/hash.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("explicit gate evidence", () => {
  it("observes matching passed evidence without minting merge eligibility", async () => {
    const fixture = repositoryFixture();
    const plan = testPlan();
    const { reference } = await execute(plan, fixture.root);

    expect(new IntegrationStatusQueryService().run(plan).mergeSummary).toMatchObject({
      eligible: [],
      pending: ["one"],
    });
    expect(status(plan, reference, fixture.root)).toMatchObject({
      evidence: {
        kind: "gate-evidence-manifest",
        applied: 1,
        authority: "unverified",
        observations: { passed: ["one/test"], failed: [], other: [] },
      },
      mergeSummary: { eligible: [], pending: ["one"], failed: [] },
    });
  });

  it("observes a bound failed receipt without treating it as authoritative state", async () => {
    const fixture = repositoryFixture();
    const plan = testPlan('node -e "process.exit(1)"');
    const { reference } = await execute(plan, fixture.root);
    expect(status(plan, reference, fixture.root)).toMatchObject({
      evidence: { observations: { passed: [], failed: ["one/test"], other: [] } },
      mergeSummary: { eligible: [], pending: ["one"], failed: [] },
    });
  });

  it("fails closed for another plan or a tampered underlying receipt", async () => {
    const fixture = repositoryFixture();
    const plan = testPlan();
    const { reference, receiptPath } = await execute(plan, fixture.root);
    expect(() =>
      status(testPlan('node -e "process.exit(1)"'), reference, fixture.root)
    ).toThrowError(expect.objectContaining({ code: "GATE_EVIDENCE_PLAN_MISMATCH" }));

    writeFileSync(receiptPath, `${readFileSync(receiptPath, "utf8")} `, "utf8");
    expect(() => status(plan, reference, fixture.root)).toThrowError(
      expect.objectContaining({ code: "GATE_EVIDENCE_DIGEST_MISMATCH" })
    );
  });

  it("rejects evidence after the tested candidate changes", async () => {
    const fixture = repositoryFixture();
    const plan = testPlan();
    const { reference } = await execute(plan, fixture.root);
    writeFileSync(fixture.candidateFile, "changed\n", "utf8");
    expect(() => status(plan, reference, fixture.root)).toThrowError(
      expect.objectContaining({ code: "GATE_EVIDENCE_PLAN_MISMATCH" })
    );
  });

  it("excludes only the owned in-repository artifact root from candidate freshness", async () => {
    const fixture = repositoryFixture();
    const plan = testPlan();
    const artifactDir = join(fixture.root, "artifacts");
    mkdirSync(artifactDir);
    const preexistingCandidateInput = join(artifactDir, "preexisting-input.txt");
    writeFileSync(preexistingCandidateInput, "candidate input\n", "utf8");
    const { reference } = await execute(plan, fixture.root, artifactDir);
    expect(status(plan, reference, fixture.root)).toMatchObject({
      evidence: { observations: { passed: ["one/test"] } },
      mergeSummary: { eligible: [], pending: ["one"] },
    });

    rmSync(preexistingCandidateInput);
    expect(() => status(plan, reference, fixture.root)).toThrowError(
      expect.objectContaining({ code: "GATE_EVIDENCE_PLAN_MISMATCH" })
    );
  });

  it("ignores ambient Git repository-selection variables during candidate capture", () => {
    const first = repositoryFixture();
    const second = repositoryFixture();
    const previousDir = process.env.GIT_DIR;
    const previousWorkTree = process.env.GIT_WORK_TREE;
    try {
      process.env.GIT_DIR = join(second.root, ".git");
      process.env.GIT_WORK_TREE = second.root;
      expect(captureGateCandidateIdentity(first.root).repositoryRoot.toLowerCase()).toBe(
        first.root.toLowerCase()
      );
    } finally {
      if (previousDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previousDir;
      if (previousWorkTree === undefined) delete process.env.GIT_WORK_TREE;
      else process.env.GIT_WORK_TREE = previousWorkTree;
    }
  });

  it("rejects a receipt replayed across two items even when the manifest is rehashed", async () => {
    const fixture = repositoryFixture();
    const plan = twoItemPlan();
    const { reference } = await execute(plan, fixture.root);
    const manifest = JSON.parse(readFileSync(reference.path, "utf8"));
    const failed = manifest.entries.find((entry: { item: string }) => entry.item === "must-fail");
    const passed = manifest.entries.find((entry: { item: string }) => entry.item === "passes");
    failed.result = { ...passed.result };
    failed.receipt = { ...passed.receipt };
    writeFileSync(reference.path, canonicalJSONStringify(manifest), "utf8");
    const digest = `sha256:${sha256(readFileSync(reference.path))}`;
    expect(() => status(plan, { ...reference, sha256: digest }, fixture.root)).toThrowError(
      expect.objectContaining({ code: "GATE_EVIDENCE_ENTRY_MISMATCH" })
    );
  });

  it("never turns a coordinated receipt and manifest forgery into merge eligibility", async () => {
    const fixture = repositoryFixture();
    const plan = testPlan('node -e "process.exit(9)"');
    const { reference, receiptPath } = await execute(plan, fixture.root);
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    receipt.outcome = {
      ...receipt.outcome,
      status: "pass",
      exitCode: 0,
      failureKind: null,
      evidenceComplete: true,
    };
    writeFileSync(receiptPath, canonicalJSONStringify(receipt), "utf8");

    const manifest = JSON.parse(readFileSync(reference.path, "utf8"));
    manifest.entries[0].result = {
      ...manifest.entries[0].result,
      status: "pass",
      exitCode: 0,
    };
    delete manifest.entries[0].result.failureKind;
    manifest.entries[0].receipt.sha256 = `sha256:${sha256(readFileSync(receiptPath))}`;
    writeFileSync(reference.path, canonicalJSONStringify(manifest), "utf8");
    const digest = `sha256:${sha256(readFileSync(reference.path))}`;

    expect(status(plan, { ...reference, sha256: digest }, fixture.root)).toMatchObject({
      evidence: { authority: "unverified", observations: { passed: ["one/test"] } },
      mergeSummary: { eligible: [], pending: ["one"], failed: [] },
    });
  });

  it("rejects duplicate item and per-item gate identities before execution", async () => {
    const fixture = repositoryFixture();
    const duplicateItems = { ...testPlan(), items: [testPlan().items[0]!, testPlan().items[0]!] };
    await expect(execute(duplicateItems, fixture.root)).rejects.toThrow();

    const duplicateGates = testPlan();
    duplicateGates.items[0]!.gates.push({ ...duplicateGates.items[0]!.gates[0]! });
    await expect(execute(duplicateGates, fixture.root)).rejects.toThrow();
  });

  it("derives contained artifact paths from arbitrary plan identities", async () => {
    const fixture = repositoryFixture();
    const plan = testPlan();
    plan.items[0]!.name = "../outside-item";
    plan.items[0]!.gates[0]!.name = "../../outside-gate";
    const { reference, receiptPath } = await execute(plan, fixture.root);
    const evidenceRoot = dirname(reference.path);
    const receiptRelative = relative(evidenceRoot, resolve(receiptPath));
    expect(receiptRelative).not.toBe("..");
    expect(receiptRelative.startsWith(`..${sep}`)).toBe(false);
    expect(isAbsolute(receiptRelative)).toBe(false);
    expect(readFileSync(receiptPath, "utf8")).toContain("outside-gate");
  });

  it("fails an unsupported container runtime closed and never emits passing evidence", async () => {
    const fixture = repositoryFixture();
    const plan = testPlan();
    plan.items[0]!.gates[0] = {
      ...plan.items[0]!.gates[0]!,
      runtime: "container",
      container: { image: "does-not-exist.invalid/never:latest" },
    };
    const { reference, result } = await execute(plan, fixture.root);
    expect(result.summary).toMatchObject({
      allGreen: false,
      items: [{ gates: [{ status: "fail", failureKind: "evidence_error" }] }],
    });
    expect(status(plan, reference, fixture.root).mergeSummary).toMatchObject({
      eligible: [],
      pending: ["one"],
    });
  });
});

async function execute(plan: Plan, repoRoot: string, requestedArtifactDir?: string) {
  const artifactDir = requestedArtifactDir ?? mkdtempSync(join(tmpdir(), "lexrunner-evidence-"));
  if (!requestedArtifactDir) temporaryDirectories.push(artifactDir);
  const result = await new GateExecutionService().run({
    plan,
    artifactDir,
    repoRoot,
  });
  const reference = result.summary.artifactRefs.find(
    (candidate) => candidate.kind === "gate-evidence-manifest"
  );
  if (!reference || reference.kind !== "gate-evidence-manifest") {
    throw new Error("gate evidence manifest was not returned");
  }
  const manifest = JSON.parse(readFileSync(reference.path, "utf8"));
  const evidenceRoot = dirname(reference.path);
  const receiptPath = manifest.entries[0]
    ? join(evidenceRoot, ...String(manifest.entries[0].receipt.path).split("/"))
    : "";
  return { reference, receiptPath, result };
}

function status(plan: Plan, reference: { path: string; sha256: string }, repoRoot: string) {
  return new IntegrationStatusQueryService().run(plan, {
    evidenceFile: reference.path,
    evidenceSha256: reference.sha256,
    repoRoot,
  });
}

function repositoryFixture(): { root: string; candidateFile: string } {
  const root = mkdtempSync(join(tmpdir(), "lexrunner-candidate-"));
  temporaryDirectories.push(root);
  const candidateFile = join(root, "candidate.txt");
  writeFileSync(candidateFile, "initial\n", "utf8");
  git(root, "init", "--quiet");
  git(root, "add", "candidate.txt");
  git(
    root,
    "-c",
    "user.name=LexRunner Test",
    "-c",
    "user.email=lexrunner@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "fixture"
  );
  return { root, candidateFile };
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, windowsHide: true, stdio: "ignore" });
}

function testPlan(run = 'node -e "process.exit(0)"'): Plan {
  return {
    schemaVersion: "1.0.0",
    target: "main",
    policy: {
      requiredGates: ["test"],
      optionalGates: [],
      maxWorkers: 1,
      retries: {},
      overrides: {},
      blockOn: [],
      mergeRule: { type: "strict-required" },
    },
    items: [{ name: "one", deps: [], gates: [{ name: "test", run, env: {} }] }],
  };
}

function twoItemPlan(): Plan {
  const plan = testPlan();
  plan.items = [
    {
      name: "must-fail",
      deps: [],
      gates: [{ name: "test", run: 'node -e "process.exit(7)"', env: {} }],
    },
    {
      name: "passes",
      deps: [],
      gates: [{ name: "test", run: 'node -e "process.exit(0)"', env: {} }],
    },
  ];
  return plan;
}
