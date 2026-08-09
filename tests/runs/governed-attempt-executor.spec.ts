import { describe, expect, it } from "vitest";

import {
  AttemptAuthorization_v1,
  GovernedAttemptResult_v1,
  GovernedCapabilityGrant_v1,
  GovernedControlId,
  GovernedReviewRequirements_v1,
  authorizeGovernedReview,
  type AttestedControl_v1,
  type EvidenceStrength,
} from "../../src/runs/governed-attempt-executor.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";

const hash = (value: string) => computeCanonicalHash({ value });
const base = "1".repeat(40);
const candidate = "2".repeat(40);
const observedAt = "2026-08-09T10:00:00.000Z";
const authorizedAt = "2026-08-09T10:01:00.000Z";
const expiresAt = "2026-08-09T10:10:00.000Z";
const attestationExpiresAt = "2026-08-09T10:15:00.000Z";

function controls(minimum: EvidenceStrength = "host_enforced_indirect") {
  return GovernedControlId.options.map((control) => ({
    control,
    minimum_strength: minimum,
  }));
}

function attested(
  strength: EvidenceStrength = "independently_enforced_verified"
): AttestedControl_v1[] {
  return GovernedControlId.options.map((control) => ({
    control,
    status: "enforced",
    strength,
    evidence_refs: [hash(`control:${control}`)],
    enforcement_owner: "lexrunner.provider",
  }));
}

function fixture() {
  const requirements = GovernedReviewRequirements_v1.parse({
    schema_version: "1.0.0",
    attempt_id: "attempt-1",
    delegation_id: "delegation-1",
    repository_id: "synthetic-repository",
    base_object_id: base,
    candidate_object_id: candidate,
    objective_hash: hash("objective"),
    authorized_model_provider: "openai",
    source_disclosure_allowed: true,
    controls: controls(),
    max_duration_ms: 600_000,
    max_output_bytes: 1_000_000,
  });
  const grant = GovernedCapabilityGrant_v1.parse({
    schema_version: "1.0.0",
    attempt_id: requirements.attempt_id,
    delegation_id: requirements.delegation_id,
    repository_id: requirements.repository_id,
    base_object_id: base,
    candidate_object_id: candidate,
    authorized_model_provider: "openai",
    source_disclosure_allowed: true,
    controls: requirements.controls,
    tools: ["read_only_shell"],
    max_duration_ms: requirements.max_duration_ms,
    max_output_bytes: requirements.max_output_bytes,
  });
  return {
    requirements,
    grant,
    executor: {
      schema_version: "1.0.0" as const,
      executor_id: "codex-cli",
      executor_version: "0.145.0",
      executable_hash: hash("codex"),
      protocol: "jsonl-stdin" as const,
      configuration_hash: hash("config"),
      tool_surface_hash: hash("tools"),
      observed_at: observedAt,
      expires_at: attestationExpiresAt,
    },
    environment: {
      schema_version: "1.0.0" as const,
      provider_id: "lexrunner.wsl2-bwrap",
      environment_id: "environment-1",
      topology_hash: hash("topology"),
      controls: attested(),
      observed_at: observedAt,
      expires_at: attestationExpiresAt,
    },
    workspace: {
      schema_version: "1.0.0" as const,
      workspace_id: "workspace-1",
      repository_id: requirements.repository_id,
      base_object_id: base,
      candidate_object_id: candidate,
      corpus_hash: hash("corpus"),
      selection_hash: hash("selection"),
      corpus_kind: "synthetic",
      observed_at: observedAt,
      expires_at: attestationExpiresAt,
    },
  };
}

describe("governed Attempt executor contracts", () => {
  it("authorizes exact fresh state with every denial control evidenced", () => {
    const value = fixture();
    const result = authorizeGovernedReview({
      authorizationId: "authorization-1",
      ...value,
      authorizedAt,
      expiresAt,
    });
    expect(result.authorized).toBe(true);
    if (!result.authorized) return;
    expect(() => AttemptAuthorization_v1.parse(result.authorization)).not.toThrow();
    expect(result.authorization.grant.tools).toEqual(["read_only_shell"]);
  });

  it("fails closed when one denial is only executor-reported", () => {
    const value = fixture();
    value.environment.controls = attested();
    value.environment.controls[0] = {
      ...value.environment.controls[0]!,
      strength: "executor_reported",
    };
    const result = authorizeGovernedReview({
      authorizationId: "authorization-1",
      ...value,
      authorizedAt,
      expiresAt,
    });
    expect(result).toEqual({
      authorized: false,
      reason: "control_unavailable",
      blocked_controls: [GovernedControlId.options[0]],
    });
  });

  it("rejects workspace identity substitution", () => {
    const value = fixture();
    value.workspace.candidate_object_id = "3".repeat(40);
    const result = authorizeGovernedReview({
      authorizationId: "authorization-1",
      ...value,
      authorizedAt,
      expiresAt,
    });
    expect(result).toEqual({ authorized: false, reason: "identity_mismatch" });
  });

  it("rejects an authorization outliving any attestation", () => {
    const value = fixture();
    const result = authorizeGovernedReview({
      authorizationId: "authorization-1",
      ...value,
      authorizedAt,
      expiresAt: "2026-08-09T10:20:00.000Z",
    });
    expect(result).toEqual({ authorized: false, reason: "stale_attestation" });
  });

  it("detects tampering with a persisted authorization body", () => {
    const value = fixture();
    const result = authorizeGovernedReview({
      authorizationId: "authorization-1",
      ...value,
      authorizedAt,
      expiresAt,
    });
    expect(result.authorized).toBe(true);
    if (!result.authorized) return;
    expect(() =>
      AttemptAuthorization_v1.parse({
        ...result.authorization,
        expires_at: "2026-08-09T10:09:00.000Z",
      })
    ).toThrow(/binding digest/u);
  });

  it("keeps task PASS orthogonal from invalid authorization", () => {
    expect(() =>
      GovernedAttemptResult_v1.parse({
        schema_version: "1.0.0",
        attempt_id: "attempt-1",
        delegation_id: "delegation-1",
        authorization_binding_digest: hash("authorization"),
        worker_outcome: "completed",
        task_outcome: "pass",
        authorization_outcome: "invalid",
        evidence_outcome: "sufficient",
        admissibility: "inadmissible",
        evidence_refs: [hash("evidence")],
      })
    ).not.toThrow();
  });

  it("forbids admissibility when authorization is invalid", () => {
    expect(() =>
      GovernedAttemptResult_v1.parse({
        schema_version: "1.0.0",
        attempt_id: "attempt-1",
        delegation_id: "delegation-1",
        authorization_binding_digest: hash("authorization"),
        worker_outcome: "completed",
        task_outcome: "pass",
        authorization_outcome: "invalid",
        evidence_outcome: "sufficient",
        admissibility: "admissible",
        evidence_refs: [],
      })
    ).toThrow(/admissibility/u);
  });
});
