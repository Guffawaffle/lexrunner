import { createHash } from "node:crypto";
import { z } from "zod";

import {
  AgentTaskPacketHashInput_v1,
  WorkItem_v1,
  createAgentTaskPacket,
} from "../schemas/agent-work.js";
import { ExecutionPlanV1Schema } from "../schemas/project.js";
import { computeCanonicalHash, SHA256Hash } from "../schemas/task-contract.js";

export const SELECTED_WORK_PROFILE = "lexrunner.selected-work.v1" as const;
export const MAX_SELECTED_WORK_BYTES = 256 * 1024;
const id = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim().length > 0);
const reference = z.object({ id, revision: id, digest: SHA256Hash }).strict();

/** Internal conversion boundary; not a CLI/MCP registration or launch request. */
export const SelectedWorkInputSchema = z
  .object({
    artifact: z
      .object({ id, text: z.string().max(MAX_SELECTED_WORK_BYTES), digest: SHA256Hash })
      .strict(),
    outcome: reference,
    workPlan: reference,
    selectedItemId: id,
    workItem: z
      .object({
        id,
        revision: z.number().int().nonnegative(),
        criterionIds: z.array(id).min(1).max(256),
      })
      .strict(),
    capturedAt: z.string().datetime(),
    repository: AgentTaskPacketHashInput_v1.shape.repository,
    packet: AgentTaskPacketHashInput_v1.pick({
      packet_id: true,
      run_id: true,
      attempt_id: true,
      instructions: true,
      scope: true,
      authority: true,
      verification: true,
      budget: true,
      created_at: true,
    }).strict(),
  })
  .strict();

const failures = {
  invalid_input: "Supply a valid bounded selection request and project artifact.",
  input_too_large: "Selection request and artifact must each fit within 256 KiB.",
  source_digest_mismatch: "The artifact bytes do not match the supplied expected digest.",
  unsupported_source_version:
    "This converter supports Execution Plan 1.0.0 with Feature Spec 0.1.0 only.",
  ambiguous_item: "Select exactly one existing item from a plan with unique item IDs.",
  unsupported_dependencies: "This initial converter supports dependency-free items only.",
  repository_mismatch: "The selected repository must match the source specification repository.",
  invalid_criteria:
    "Provide nonblank criteria and one distinct stable ID per criterion in source order.",
  invalid_packet:
    "Constructed context or explicit packet policy violates the existing portable packet contract; revise the supplied input before preparation.",
} as const;
export type SelectedWorkFailureCode = keyof typeof failures;
function failure(code: SelectedWorkFailureCode) {
  return { ok: false as const, error: { code, message: failures[code] } };
}

/** Pure construction only. Supplied references/digests do not establish approval or freshness. */
export function materializeSelectedWork(input: unknown) {
  try {
    const serialized = JSON.stringify(input);
    if (serialized === undefined) return failure("invalid_input");
    if (Buffer.byteLength(serialized, "utf8") > MAX_SELECTED_WORK_BYTES)
      return failure("input_too_large");
    const parsed = SelectedWorkInputSchema.safeParse(input);
    if (!parsed.success) return failure("invalid_input");
    const request = parsed.data;
    const bytes = Buffer.from(request.artifact.text, "utf8");
    if (bytes.length > MAX_SELECTED_WORK_BYTES) return failure("input_too_large");
    if (bytes.toString("utf8") !== request.artifact.text) return failure("invalid_input");
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (digest !== request.artifact.digest) return failure("source_digest_mismatch");
    const source = ExecutionPlanV1Schema.safeParse(JSON.parse(request.artifact.text));
    if (!source.success) return failure("invalid_input");
    const plan = source.data;
    if (plan.schemaVersion !== "1.0.0" || plan.sourceSpec.schemaVersion !== "0.1.0")
      return failure("unsupported_source_version");
    const ids = plan.subIssues.map((item) => item.id);
    const selected = plan.subIssues.find((item) => item.id === request.selectedItemId);
    if (new Set(ids).size !== ids.length || !selected) return failure("ambiguous_item");
    if (selected.dependsOn.length > 0) return failure("unsupported_dependencies");
    if (request.repository.id !== plan.sourceSpec.repo) return failure("repository_mismatch");
    const criterionIds = request.workItem.criterionIds;
    if (
      criterionIds.length !== selected.acceptanceCriteria.length ||
      new Set(criterionIds).size !== criterionIds.length ||
      selected.acceptanceCriteria.some((criterion) => criterion.trim().length === 0)
    )
      return failure("invalid_criteria");

    const { base_sha, ...repository } = request.repository;
    const technicalContext = plan.sourceSpec.technicalContext;
    const workItem = WorkItem_v1.parse({
      schema_version: "1.0.0",
      work_item_id: request.workItem.id,
      revision: request.workItem.revision,
      source: {
        kind: "manual",
        external_id: `${request.artifact.id}#${encodeURIComponent(selected.id)}`,
        revision: digest,
        captured_at: request.capturedAt,
      },
      repository,
      title: selected.title,
      objective: selected.title,
      description:
        selected.description +
        (technicalContext === undefined
          ? ""
          : `\n\nSupplied technical context:\n${technicalContext}`),
      acceptance_criteria: selected.acceptanceCriteria.map((text, index) => ({
        id: criterionIds[index],
        text,
      })),
      constraints: plan.sourceSpec.constraints === undefined ? [] : [plan.sourceSpec.constraints],
      labels: plan.sourceSpec.labels,
      dependencies: [],
    });
    const instructions = [
      ...request.packet.instructions,
      `Supplied work description:\n${workItem.description}`,
      ...workItem.constraints.map((constraint) => `Supplied constraint:\n${constraint}`),
    ];
    let packet: ReturnType<typeof createAgentTaskPacket>;
    try {
      packet = createAgentTaskPacket({
        ...request.packet,
        schema_version: "1.0.0",
        work_item: { work_item_id: workItem.work_item_id, revision: workItem.revision },
        repository: { ...repository, base_sha },
        objective: workItem.objective,
        acceptance_criteria: workItem.acceptance_criteria,
        instructions,
      });
    } catch {
      return failure("invalid_packet");
    }
    const correspondence = {
      schema_version: "1.0.0" as const,
      profile: SELECTED_WORK_PROFILE,
      source: { artifact_id: request.artifact.id, digest, selected_item_id: selected.id },
      supplied_references: { outcome: request.outcome, work_plan: request.workPlan },
      reference_content_verified: false as const,
      work_item: {
        id: workItem.work_item_id,
        revision: workItem.revision,
        digest: computeCanonicalHash(workItem),
      },
      criterion_mapping: criterionIds.map((criterionId, sourceIndex) => ({
        source_index: sourceIndex,
        criterion_id: criterionId,
      })),
      run_id: packet.run_id,
      attempt_id: packet.attempt_id,
      packet_id: packet.packet_id,
      packet_hash: packet.packet_hash,
    };
    return {
      ok: true as const,
      outcome: "materialized_input" as const,
      workItem,
      packet,
      correspondence: { ...correspondence, digest: computeCanonicalHash(correspondence) },
    };
  } catch {
    return failure("invalid_input");
  }
}

/** Machine discovery for the same bounded input accepted by CLI and MCP. */
export const SelectedWorkInputJsonSchema = z.toJSONSchema(SelectedWorkInputSchema, {
  target: "draft-7",
  unrepresentable: "any",
});

/** Return only the fragment needed by existing preparation, not duplicate packet text. */
export function materializeAttemptInput(input: unknown) {
  const materialized = materializeSelectedWork(input);
  if (!materialized.ok) return materialized;
  const { packet, workItem, correspondence } = materialized;
  return {
    ok: true as const,
    result: {
      outcome: "materialized_input" as const,
      preparationInput: {
        workItem,
        identity: {
          runId: packet.run_id,
          attemptId: packet.attempt_id,
          baseSha: packet.repository.base_sha,
        },
        packet: {
          packetId: packet.packet_id,
          instructions: packet.instructions,
          scope: packet.scope,
          authority: packet.authority,
          verification: packet.verification,
          budget: packet.budget,
          createdAt: packet.created_at,
        },
        expectedPacketHash: packet.packet_hash,
      },
      requiredPreparationFields: ["runtime", "envelope", "attempt"],
      correspondence,
    },
  };
}
