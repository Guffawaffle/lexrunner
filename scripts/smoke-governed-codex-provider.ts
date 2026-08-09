import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { computeCanonicalHash } from "../src/schemas/task-contract.js";
import { ExternalWsl2CodexProviderBridge } from "../src/runs/external-wsl2-codex-provider-bridge.js";
import { ProtectedEvidenceCaptureSession } from "../src/runs/governed-attempt-evidence.js";
import {
  GovernedCapabilityGrant_v1,
  GovernedControlId,
  GovernedReviewRequirements_v1,
  authorizeGovernedReview,
  type AttemptExecutorHandle_v1,
} from "../src/runs/governed-attempt-executor.js";
import { QualifiedWsl2CodexExecutor } from "../src/runs/qualified-wsl2-codex-executor.js";
import { LocalProtectedEvidenceStore } from "../src/store/local-protected-evidence-store.js";
import {
  WindowsProtectedEvidenceAuthority,
  defaultWindowsProtectedEvidenceRoot,
} from "../src/store/windows-protected-evidence-authority.js";
import { canonicalJSONStringify } from "../src/util/canonicalJson.js";

const arguments_ = parseArgs({
  options: {
    distribution: { type: "string" },
    "environment-id": { type: "string" },
  },
  strict: true,
});
const DISTRIBUTION = arguments_.values.distribution;
const ENVIRONMENT_ID = arguments_.values["environment-id"];
if (!DISTRIBUTION || !ENVIRONMENT_ID) {
  throw new Error("--distribution and --environment-id are required");
}
const REPOSITORY_ID = "lexrunner-synthetic-retry-window";
const BASE_OBJECT_ID = "1".repeat(40);
const CANDIDATE_OBJECT_ID = "2".repeat(40);

const authority = new WindowsProtectedEvidenceAuthority();
let executor: QualifiedWsl2CodexExecutor | undefined;
let handle: AttemptExecutorHandle_v1 | undefined;

try {
  const bridge = new ExternalWsl2CodexProviderBridge({ distribution: DISTRIBUTION });
  const attestations = await bridge.prepareSynthetic({
    environment_id: ENVIRONMENT_ID,
    repository_id: REPOSITORY_ID,
    base_object_id: BASE_OBJECT_ID,
    candidate_object_id: CANDIDATE_OBJECT_ID,
  });
  const attemptId = `attempt-${randomUUID()}`;
  const delegationId = `delegation-${randomUUID()}`;
  const controls = GovernedControlId.options.map((control) => ({
    control,
    minimum_strength: "independently_enforced_verified" as const,
  }));
  const requirements = GovernedReviewRequirements_v1.parse({
    schema_version: "1.0.0",
    attempt_id: attemptId,
    delegation_id: delegationId,
    repository_id: REPOSITORY_ID,
    base_object_id: BASE_OBJECT_ID,
    candidate_object_id: CANDIDATE_OBJECT_ID,
    objective_hash: computeCanonicalHash({
      objective: "Review the bounded retry-window change for correctness",
    }),
    authorized_model_provider: "openai",
    source_disclosure_allowed: true,
    controls,
    max_duration_ms: 180_000,
    max_output_bytes: 2 * 1_024 * 1_024,
  });
  const grant = GovernedCapabilityGrant_v1.parse({
    schema_version: "1.0.0",
    attempt_id: attemptId,
    delegation_id: delegationId,
    repository_id: REPOSITORY_ID,
    base_object_id: BASE_OBJECT_ID,
    candidate_object_id: CANDIDATE_OBJECT_ID,
    authorized_model_provider: "openai",
    source_disclosure_allowed: true,
    controls,
    tools: ["read_only_shell"],
    max_duration_ms: requirements.max_duration_ms,
    max_output_bytes: requirements.max_output_bytes,
  });
  const authorizedAt = new Date();
  const attestationExpiry = Math.min(
    Date.parse(attestations.executor.expires_at),
    Date.parse(attestations.environment.expires_at),
    Date.parse(attestations.workspace.expires_at)
  );
  const requestedExpiry = new Date(
    Math.min(authorizedAt.getTime() + 4 * 60_000, attestationExpiry - 5_000)
  );
  const decision = authorizeGovernedReview({
    authorizationId: `authorization-${randomUUID()}`,
    requirements,
    grant,
    executor: attestations.executor,
    environment: attestations.environment,
    workspace: attestations.workspace,
    authorizedAt: authorizedAt.toISOString(),
    expiresAt: requestedExpiry.toISOString(),
  });
  if (!decision.authorized) {
    throw new Error(`Synthetic governed review was not authorized: ${decision.reason}`);
  }

  const root = defaultWindowsProtectedEvidenceRoot();
  if (!(await authority.attestRoot(root))) {
    throw new Error("The protected-evidence root failed Windows authority attestation");
  }
  const store = new LocalProtectedEvidenceStore(root, {
    attestRoot: (candidate) => authority.attestRoot(candidate),
    syncDirectory: (directory) => authority.syncDirectory(directory),
  });
  const evidence = await ProtectedEvidenceCaptureSession.open({
    store,
    openedAt: new Date().toISOString(),
    reservation: {
      capture_id: `capture-${randomUUID()}`,
      attempt_id: attemptId,
      delegation_id: delegationId,
      authorization_binding_digest: decision.authorization.binding_digest,
      executor_binding_digest: decision.authorization.executor_attestation_hash,
      environment_binding_digest: decision.authorization.environment_attestation_hash,
      workspace_binding_digest: decision.authorization.workspace_attestation_hash,
      reserved_bytes: 8 * 1_024 * 1_024,
      reserved_frames: 1_024,
      reserved_events: 1_024,
      max_duration_ms: requirements.max_duration_ms,
    },
  });

  executor = new QualifiedWsl2CodexExecutor(bridge);
  handle = await executor.start({
    authorization: decision.authorization,
    prompt: Buffer.from(
      [
        "Compare base/retry-window.ts with candidate/retry-window.ts.",
        "Review only for correctness and bounded-resource regressions.",
        "Use the read-only shell only if useful. Do not modify anything.",
        "Return verdict BLOCK if the candidate removes a safety bound; otherwise return PASS.",
        "For each finding, cite the candidate file and one-based line number.",
      ].join("\n"),
      "utf8"
    ),
    outputSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      required: ["verdict", "findings"],
      properties: {
        verdict: { type: "string", enum: ["PASS", "BLOCK"] },
        findings: {
          type: "array",
          maxItems: 16,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["severity", "file", "line", "message"],
            properties: {
              severity: { type: "string", enum: ["blocking", "advisory"] },
              file: { type: "string", minLength: 1, maxLength: 256 },
              line: { type: "integer", minimum: 1 },
              message: { type: "string", minLength: 1, maxLength: 2_048 },
            },
          },
        },
      },
    },
    evidence,
  });

  const eventTypes: string[] = [];
  for await (const event of executor.observe(handle)) eventTypes.push(event.type);
  const terminal = eventTypes.at(-1);
  if (terminal === "declined") {
    await executor.cancel(handle);
    await executor.release(handle);
    process.stdout.write(
      canonicalJSONStringify({
        status: "declined",
        decision: "NO",
        reason_required: false,
        event_count: eventTypes.length,
        evidence_status: evidence.getReference().status,
      })
    );
  } else if (terminal === "completed") {
    const result = await executor.collect(handle);
    const reference = evidence.getReference();
    await executor.release(handle);
    process.stdout.write(
      canonicalJSONStringify({
        status: "completed",
        task_outcome: result.task_outcome,
        admissibility: result.admissibility,
        event_count: eventTypes.length,
        evidence_status: reference.status,
        evidence_refs: result.evidence_refs,
        capture_id: reference.capture_id,
      })
    );
  } else {
    await executor.cancel(handle).catch(() => undefined);
    throw new Error(`Synthetic governed review did not reach a usable terminal event: ${terminal}`);
  }
} finally {
  await authority.close();
}
