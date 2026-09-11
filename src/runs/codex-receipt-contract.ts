import { z } from "zod";
import {
  AgentTaskReceipt_v2,
  type AgentTaskPacket_v1,
  type ExecutionEnvelope_v1,
} from "../schemas/agent-work.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";

/** Input schema only: semantic refinements still run locally on the received claim. */
export const CodexReceiptOutputSchema = z.toJSONSchema(AgentTaskReceipt_v2, {
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
              worker_session_id: sessionId,
              instruction:
                "Return one final AgentTaskReceipt_v2 JSON object matching outputSchema. Report only your observations and claims; do not invent completed checks or verification. Use the packet and envelope bindings. A blocked or failed task still requires a receipt with its observed result identity.",
            },
          }),
        },
      ],
      outputSchema: structuredClone(CodexReceiptOutputSchema),
    },
  };
}
