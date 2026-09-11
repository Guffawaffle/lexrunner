import { z } from "zod";
import {
  AgentTaskReceipt_v2,
  type AgentTaskPacket_v1,
  type ExecutionEnvelope_v1,
} from "../schemas/agent-work.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";

const shape = AgentTaskReceipt_v2.in.shape;
const check = shape.claimed_checks.element.shape;
const cost = shape.cost.shape;
/** Required nullable wire fields express canonical omission; they never mean observed zero. */
export const CodexReceiptWire = z
  .object({
    ...shape,
    final_head_sha: shape.final_head_sha.unwrap().nullable(),
    patch_hash: shape.patch_hash.unwrap().nullable(),
    claimed_checks: z.array(
      z
        .object({
          ...check,
          exit_code: check.exit_code.unwrap().nullable(),
          output_snippet: check.output_snippet.unwrap().nullable(),
        })
        .strict()
    ),
    cost: z
      .object({
        input_tokens: cost.input_tokens.unwrap().nullable(),
        output_tokens: cost.output_tokens.unwrap().nullable(),
        tool_calls: cost.tool_calls.unwrap().nullable(),
        elapsed_ms: cost.elapsed_ms.unwrap().nullable(),
      })
      .strict(),
  })
  .strict();

export function decodeCodexReceipt(value: unknown): AgentTaskReceipt_v2 {
  const wire = CodexReceiptWire.parse(value);
  const omitNull = (object: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(object).filter(([, v]) => v !== null));
  return AgentTaskReceipt_v2.parse({
    ...omitNull(wire),
    cost: omitNull(wire.cost),
    claimed_checks: wire.claimed_checks.map(omitNull),
  });
}

/** Semantic refinements run on the canonical claim after explicit wire decoding. */
export const CodexReceiptOutputSchema = z.toJSONSchema(CodexReceiptWire, {
  target: "draft-7",
  io: "input",
});

export function codexReceiptRequest(
  packet: AgentTaskPacket_v1,
  envelope: ExecutionEnvelope_v1,
  threadId: string,
  sessionId: string
) {
  return {
    method: "turn/start" as const,
    params: {
      threadId,
      input: [
        {
          type: "text" as const,
          text: canonicalJSONStringify({
            task_packet: packet,
            execution_envelope: envelope,
            receipt_contract: {
              schema_version: "2.0.0",
              wire_profile: "codex-task-receipt-v1",
              worker_session_id: sessionId,
              workspace_lease_revision: envelope.workspace_lease_revision,
              instruction:
                "Return one final AgentTaskReceipt_v2 JSON object using codex-task-receipt-v1 outputSchema: every property is required; use null for omitted optional result, check and cost fields, never invented zero values. Report only your observations and claims; do not invent completed checks or verification. Use the packet and envelope attachment bindings, including the workspace revision above. A blocked or failed task still requires a receipt with its observed result identity.",
            },
          }),
        },
      ],
      outputSchema: structuredClone(CodexReceiptOutputSchema),
    },
  };
}
