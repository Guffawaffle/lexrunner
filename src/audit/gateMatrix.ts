/**
 * Gate Matrix Generation
 *
 * Generates per-PR gate execution matrix from audit events
 */

import * as fs from "fs";
import * as path from "path";

/**
 * Gate execution status
 */
export type GateStatus = "pass" | "fail" | "skip" | "blocked";

/**
 * Gate result in matrix
 */
export interface GateResult {
  status: GateStatus;
  duration_ms?: number;
  error?: string;
  reason?: string;
}

/**
 * Gate matrix structure
 */
export interface GateMatrix {
  generated_at: string;
  session_id?: string;
  matrix: Record<string, Record<string, GateResult>>;
  summary: {
    total_prs: number;
    total_gates: number;
    passed: number;
    failed: number;
    skipped: number;
    blocked: number;
  };
}

/**
 * Event envelope (minimal structure needed for gate matrix)
 */
export interface EventEnvelope {
  event: string;
  ts: string;
  session_id?: string;
  payload: any;
}

/**
 * Generate gate matrix from audit events
 */
export function generateGateMatrix(events: EventEnvelope[]): GateMatrix {
  const matrix: Record<string, Record<string, GateResult>> = {};
  const gateStartTimes: Record<string, number> = {};

  // Track gate execution
  for (const event of events) {
    if (event.event === "gate_started") {
      const { item, gate } = event.payload;
      const key = `${item}:${gate}`;
      gateStartTimes[key] = new Date(event.ts).getTime();
    } else if (event.event === "gate_finished") {
      const { item, gate, status, error, reason, duration_ms } = event.payload;
      const key = `${item}:${gate}`;
      const startTime = gateStartTimes[key];
      const endTime = new Date(event.ts).getTime();

      // Initialize item matrix if needed
      if (!matrix[item]) {
        matrix[item] = {};
      }

      // Use duration from payload if available, otherwise calculate
      const finalDuration =
        duration_ms !== undefined ? duration_ms : startTime ? endTime - startTime : undefined;

      // Map status to GateStatus type
      const gateStatus: GateStatus = ["pass", "fail", "skip", "blocked"].includes(status)
        ? (status as GateStatus)
        : "fail";

      matrix[item][gate] = {
        status: gateStatus,
        duration_ms: finalDuration,
        error,
        reason,
      };
    }
  }

  // Calculate summary
  const summary = {
    total_prs: Object.keys(matrix).length,
    total_gates: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    blocked: 0,
  };

  for (const item of Object.keys(matrix)) {
    for (const gate of Object.keys(matrix[item])) {
      summary.total_gates++;
      const result = matrix[item][gate];
      switch (result.status) {
        case "pass":
          summary.passed++;
          break;
        case "fail":
          summary.failed++;
          break;
        case "skip":
          summary.skipped++;
          break;
        case "blocked":
          summary.blocked++;
          break;
      }
    }
  }

  // Extract session_id from first event if available
  const sessionId = events.length > 0 ? events[0].session_id : undefined;

  return {
    generated_at: new Date().toISOString(),
    session_id: sessionId,
    matrix,
    summary,
  };
}

/**
 * Generate gate matrix JSON file from audit.ndjson
 */
export async function generateGateMatrixFile(
  auditNdjsonPath: string,
  outputPath: string
): Promise<void> {
  // Read audit.ndjson file
  const content = await fs.promises.readFile(auditNdjsonPath, "utf-8");

  // Parse NDJSON (one JSON object per line)
  const events: EventEnvelope[] = content
    .trim()
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));

  // Generate matrix
  const gateMatrix = generateGateMatrix(events);

  // Write to output file
  await fs.promises.writeFile(outputPath, JSON.stringify(gateMatrix, null, 2), "utf-8");
}
