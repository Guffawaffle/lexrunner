import * as fs from "node:fs";
import * as path from "node:path";

import { resolveProfile } from "../config/profileResolver.js";
import { loadPlan, type Plan } from "../schema.js";
import { computeCanonicalHash } from "../schemas/task-contract.js";

const MAX_PLAN_REFERENCE_BYTES = 4_096;
const MAX_PLAN_BYTES = 4 * 1024 * 1024;
const MAX_PLAN_ITEMS = 256;
const MAX_GATES_PER_ITEM = 64;
const MAX_IDENTITY_LABEL_BYTES = 512;

export type PlanArtifactSource = "explicit" | "repository-root" | "profile-runner";

export interface PlanArtifactIdentity {
  contract: "plan-artifact-identity-v1";
  kind: "execution-plan";
  schema: "lexrunner.execution-plan";
  schemaVersion: string;
  digest: string;
  target: string;
  itemCount: number;
}

export interface ResolvedPlanArtifact {
  plan: Plan;
  identity: PlanArtifactIdentity;
  source: PlanArtifactSource;
  /** Adapter-only location. It is deliberately excluded from the public identity. */
  filePath: string;
}

export type PlanArtifactFailureCode =
  "PLAN_REFERENCE_INVALID" | "PLAN_NOT_FOUND" | "PLAN_UNREADABLE" | "PLAN_ARTIFACT_LIMIT_EXCEEDED";

export class PlanArtifactServiceError extends Error {
  constructor(
    readonly code: PlanArtifactFailureCode,
    message: string,
    readonly source?: PlanArtifactSource
  ) {
    super(message);
    this.name = "PlanArtifactServiceError";
  }
}

export interface ResolvePlanArtifactInput {
  planFile?: string;
  workingDir?: string;
  profileDir?: string;
}

/**
 * Resolve one immutable integration plan without creating mutable "active plan" state.
 *
 * Precedence is explicit reference, repository-root plan.json, then the legacy
 * profile runner plan. An explicit reference is authoritative: a bad explicit
 * path never falls through to another plan.
 */
export class PlanArtifactService {
  resolve(input: ResolvePlanArtifactInput = {}): ResolvedPlanArtifact {
    const workingDir = path.resolve(input.workingDir ?? process.cwd());
    if (input.planFile !== undefined) {
      const explicitPath = resolveExplicitReference(input.planFile, workingDir);
      return readArtifact(explicitPath, "explicit");
    }

    const repositoryPlan = path.join(workingDir, "plan.json");
    if (isRegularFile(repositoryPlan)) {
      return readArtifact(repositoryPlan, "repository-root");
    }

    let profilePlan: string | undefined;
    try {
      const profile = resolveProfile(input.profileDir, workingDir);
      profilePlan = path.join(profile.path, "runner", "plan.json");
    } catch {
      // A profile is only the backward-compatible final fallback. Keep failure
      // diagnostics about the plan reference bounded and independent of host paths.
    }
    if (profilePlan && isRegularFile(profilePlan)) {
      return readArtifact(profilePlan, "profile-runner");
    }

    throw new PlanArtifactServiceError(
      "PLAN_NOT_FOUND",
      "No integration plan was found in the repository root or profile runner"
    );
  }
}

function resolveExplicitReference(reference: string, workingDir: string): string {
  if (
    reference.length === 0 ||
    reference.includes("\0") ||
    Buffer.byteLength(reference, "utf8") > MAX_PLAN_REFERENCE_BYTES
  ) {
    throw new PlanArtifactServiceError(
      "PLAN_REFERENCE_INVALID",
      "The explicit plan reference is empty, overlong, or contains an invalid character",
      "explicit"
    );
  }
  return path.isAbsolute(reference)
    ? path.normalize(reference)
    : path.resolve(workingDir, reference);
}

function readArtifact(filePath: string, source: PlanArtifactSource): ResolvedPlanArtifact {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new PlanArtifactServiceError(
      "PLAN_NOT_FOUND",
      "The referenced integration plan does not exist",
      source
    );
  }
  if (!stat.isFile() || stat.size > MAX_PLAN_BYTES) {
    throw new PlanArtifactServiceError(
      "PLAN_UNREADABLE",
      "The referenced integration plan is not a readable bounded file",
      source
    );
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    throw new PlanArtifactServiceError(
      "PLAN_UNREADABLE",
      "The referenced integration plan could not be read",
      source
    );
  }

  const plan = loadPlan(content);
  assertBoundedArtifact(plan, source);
  return {
    plan,
    identity: {
      contract: "plan-artifact-identity-v1",
      kind: "execution-plan",
      schema: "lexrunner.execution-plan",
      schemaVersion: plan.schemaVersion,
      digest: computeCanonicalHash(plan),
      target: plan.target,
      itemCount: plan.items.length,
    },
    source,
    filePath,
  };
}

function assertBoundedArtifact(plan: Plan, source: PlanArtifactSource): void {
  const labels = [
    plan.schemaVersion,
    plan.target,
    ...plan.items.flatMap((item) => [item.name, ...item.gates.map((gate) => gate.name)]),
  ];
  if (
    plan.items.length > MAX_PLAN_ITEMS ||
    plan.items.some(({ gates }) => gates.length > MAX_GATES_PER_ITEM) ||
    labels.some((label) => Buffer.byteLength(label, "utf8") > MAX_IDENTITY_LABEL_BYTES)
  ) {
    throw new PlanArtifactServiceError(
      "PLAN_ARTIFACT_LIMIT_EXCEEDED",
      "The integration plan exceeds bounded item, gate, or identity-label limits",
      source
    );
  }
}

function isRegularFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
