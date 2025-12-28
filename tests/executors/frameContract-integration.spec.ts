/**
 * Integration Example: Using Frame Contract with Executors
 *
 * This example demonstrates how to integrate the Frame contract enforcement
 * with a real executor implementation.
 */

import { describe, it, expect } from "vitest";
import {
  withFrameContract,
  buildFrameFromTemplate,
  createFrameMetadata,
  type ExecutorInvocationContext,
  type ExecutorOutput,
  type ToolCall,
} from "../../src/executors/frameContract.js";
import type { ExecutionFrame } from "../../src/frames/types.js";
import { createHash } from "node:crypto";

/**
 * Example: Simple Issue Triage Executor
 *
 * This executor demonstrates the pattern of:
 * 1. Accepting inputs
 * 2. Recording tool calls
 * 3. Building a Frame using the template
 * 4. Returning output with Frame
 */
async function triageIssueExecutor(
  inputs: { issueNumber: string; priority?: string },
  context: ExecutorInvocationContext
): Promise<ExecutorOutput> {
  const startTime = new Date();

  // Simulate tool call: read issue details
  const readToolStart = Date.now();
  const issueData = { title: "Sample Issue", body: "Description here" };
  context.toolCalls.push({
    tool: "read_issue",
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - readToolStart,
    success: true,
  });

  // Simulate tool call: check labels
  const labelToolStart = Date.now();
  const labels = ["bug", "high-priority"];
  context.toolCalls.push({
    tool: "get_labels",
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - labelToolStart,
    success: true,
  });

  // Determine outcome
  const priority = inputs.priority || "medium";
  const outcome: "success" | "failure" | "partial" = priority === "high" ? "success" : "partial";

  // Build output
  const outputs = {
    triageResult: {
      issueNumber: inputs.issueNumber,
      priority,
      labels,
      recommendation: "Assign to senior engineer",
    },
  };

  // Hash inputs and outputs
  const inputsHash = createHash("sha256")
    .update(JSON.stringify(inputs, Object.keys(inputs).sort()))
    .digest("hex");
  const outputsHash = createHash("sha256")
    .update(JSON.stringify(outputs, Object.keys(outputs).sort()))
    .digest("hex");

  // Build Frame using template
  const frame: ExecutionFrame = buildFrameFromTemplate({
    role: context.executorRole,
    runId: context.runId,
    summary: `Triaged issue #${inputs.issueNumber} as ${priority} priority`,
    moduleScope: [`issue-${inputs.issueNumber}`],
    outcome,
    nextActions:
      outcome === "success"
        ? ["Assign to engineer", "Schedule for sprint"]
        : ["Re-evaluate priority", "Gather more context"],
    inputsHash,
    outputsHash,
    toolCalls: context.toolCalls,
    durationMs: new Date().getTime() - startTime.getTime(),
    metadata: {
      issue_labels: labels,
      priority,
    },
  });

  return {
    outputs,
    endTime: new Date().toISOString(),
    frame, // REQUIRED: Frame emission
  };
}

describe("Frame Contract Integration Example", () => {
  it("should execute triage executor with frame contract enforcement", async () => {
    // Wrap the executor with frame contract
    const wrappedTriage = withFrameContract(triageIssueExecutor, {
      executorRole: "issue-triage",
      runId: "integration-test-001",
    });

    // Execute
    const result = await wrappedTriage({
      issueNumber: "123",
      priority: "high",
    });

    // Verify output
    expect(result.outputs.triageResult.issueNumber).toBe("123");
    expect(result.outputs.triageResult.priority).toBe("high");

    // Verify frame was emitted and validated
    expect(result.validatedFrame).toBeDefined();
    expect(result.validatedFrame.type).toBe("execution");
    expect(result.validatedFrame.outcome).toBe("success");
    expect(result.validatedFrame.summary_caption).toContain("Triaged issue #123");

    // Verify executor metadata
    expect(result.validatedFrame.metadata?.executor_role).toBe("issue-triage");
    expect(result.validatedFrame.metadata?.inputs_hash).toBeDefined();
    expect(result.validatedFrame.metadata?.outputs_hash).toBeDefined();
    expect(result.validatedFrame.metadata?.tool_calls_count).toBe(2);

    // Verify tool calls
    const toolCalls = result.validatedFrame.metadata?.tool_calls as ToolCall[];
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0].tool).toBe("read_issue");
    expect(toolCalls[0].success).toBe(true);
    expect(toolCalls[1].tool).toBe("get_labels");
    expect(toolCalls[1].success).toBe(true);
  });

  it("should handle executor that fails but still emits frame", async () => {
    // Executor that fails but emits a failure frame
    const failingExecutor = async (
      inputs: { issueNumber: string },
      context: ExecutorInvocationContext
    ): Promise<ExecutorOutput> => {
      const startTime = new Date();

      // Simulate failed tool call
      context.toolCalls.push({
        tool: "read_issue",
        timestamp: new Date().toISOString(),
        durationMs: 50,
        success: false,
        error: "Issue not found",
      });

      const outputs = { error: "Issue not found" };
      const inputsHash = createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
      const outputsHash = createHash("sha256").update(JSON.stringify(outputs)).digest("hex");

      const frame = buildFrameFromTemplate({
        role: context.executorRole,
        runId: context.runId,
        summary: `Failed to triage issue #${inputs.issueNumber}`,
        moduleScope: [`issue-${inputs.issueNumber}`],
        outcome: "failure",
        nextActions: ["Verify issue exists", "Check permissions", "Retry"],
        inputsHash,
        outputsHash,
        toolCalls: context.toolCalls,
        durationMs: new Date().getTime() - startTime.getTime(),
        error: "Issue not found",
      });

      return {
        outputs,
        endTime: new Date().toISOString(),
        frame,
      };
    };

    const wrappedExecutor = withFrameContract(failingExecutor, {
      executorRole: "issue-triage",
      runId: "integration-test-002",
    });

    const result = await wrappedExecutor({ issueNumber: "999" });

    // Verify failure is documented in frame
    expect(result.validatedFrame.outcome).toBe("failure");
    expect(result.validatedFrame.metadata?.error).toBe("Issue not found");
    expect(result.validatedFrame.next_actions).toContain("Verify issue exists");

    // Verify tool calls include failure
    const toolCalls = result.validatedFrame.metadata?.tool_calls as ToolCall[];
    expect(toolCalls[0].success).toBe(false);
    expect(toolCalls[0].error).toBe("Issue not found");
  });

  it("should demonstrate manual frame metadata creation", async () => {
    const context: ExecutorInvocationContext = {
      executorRole: "test-executor",
      runId: "metadata-test-001",
      inputs: { key: "value" },
      toolCalls: [
        {
          tool: "test_tool",
          timestamp: "2025-12-16T10:00:00Z",
          durationMs: 100,
          success: true,
        },
      ],
      startTime: "2025-12-16T10:00:00.000Z",
    };

    const output: ExecutorOutput = {
      outputs: { result: "success" },
      endTime: "2025-12-16T10:00:05.000Z",
    };

    const metadata = createFrameMetadata(context, output);

    expect(metadata.executorRole).toBe("test-executor");
    expect(metadata.inputsHash).toBeDefined();
    expect(metadata.outputsHash).toBeDefined();
    expect(metadata.toolCalls).toHaveLength(1);
    expect(metadata.durationMs).toBe(5000); // 5 seconds
  });
});

/**
 * Example: Integration with Senior Dev Executor Pattern
 *
 * This demonstrates how to adapt existing executors to use the frame contract.
 */
describe("Senior Dev Executor Pattern with Frame Contract", () => {
  it("should show how to integrate with existing executor", async () => {
    // Mock existing senior-dev executor function
    const mockPrepareReviewContext = async (inputs: {
      prNumber: string;
    }): Promise<{
      artifacts: { diff: string; lint: string };
      modulesDetected: string[];
    }> => {
      return {
        artifacts: {
          diff: "changes.diff",
          lint: "lint-output.txt",
        },
        modulesDetected: ["src/cli.ts", "src/schema.ts"],
      };
    };

    // Create wrapped executor that uses frame contract
    const reviewExecutor = async (
      inputs: { prNumber: string },
      context: ExecutorInvocationContext
    ): Promise<ExecutorOutput> => {
      const startTime = new Date();

      // Phase 1: Prep
      const toolStart = Date.now();
      const prepResult = await mockPrepareReviewContext(inputs);
      context.toolCalls.push({
        tool: "prepare_review_context",
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - toolStart,
        success: true,
      });

      // Phase 4: Build Frame
      const outputs = {
        reviewComplete: true,
        artifacts: prepResult.artifacts,
        findings: ["issue1", "issue2"],
      };

      const inputsHash = createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
      const outputsHash = createHash("sha256").update(JSON.stringify(outputs)).digest("hex");

      const frame = buildFrameFromTemplate({
        role: context.executorRole,
        runId: context.runId,
        summary: `Code review completed for PR-${inputs.prNumber}`,
        moduleScope: prepResult.modulesDetected,
        outcome: "success",
        nextActions: ["Address findings", "Re-run linter", "Request re-review"],
        inputsHash,
        outputsHash,
        toolCalls: context.toolCalls,
        durationMs: new Date().getTime() - startTime.getTime(),
        metadata: {
          pr_number: inputs.prNumber,
          findings_count: 2,
          modules_reviewed: prepResult.modulesDetected.length,
        },
      });

      return {
        outputs,
        endTime: new Date().toISOString(),
        frame,
      };
    };

    // Wrap and execute
    const wrappedReview = withFrameContract(reviewExecutor, {
      executorRole: "senior-dev",
      runId: "review-test-001",
    });

    const result = await wrappedReview({ prNumber: "123" });

    // Verify
    expect(result.validatedFrame).toBeDefined();
    expect(result.validatedFrame.metadata?.pr_number).toBe("123");
    expect(result.validatedFrame.metadata?.findings_count).toBe(2);
    expect(result.validatedFrame.module_scope).toEqual(["src/cli.ts", "src/schema.ts"]);
  });
});
