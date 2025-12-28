/**
 * Tests for Executor Frame Contract Enforcement
 *
 * Validates that:
 * - Every executor invocation emits at least one Frame
 * - Frames include required metadata (role, hashes, tool calls)
 * - Contract violations throw appropriate errors
 */

import { describe, it, expect } from "vitest";
import {
  FrameContractViolationError,
  createFrameMetadata,
  enforceFrameEmission,
  withFrameContract,
  validateFrameMetadata,
  buildFrameFromTemplate,
  type ExecutorInvocationContext,
  type ExecutorOutput,
  type ToolCall,
  type ExecutorFrameTemplate,
} from "../../src/executors/frameContract.js";
import type { ExecutionFrame } from "../../src/frames/types.js";

describe("createFrameMetadata", () => {
  it("should create metadata with hashed inputs and outputs", () => {
    const context: ExecutorInvocationContext = {
      executorRole: "senior-dev",
      runId: "01JFZG7X2T3K4M5N6P7Q8R9S0W",
      inputs: { prNumber: "123", module: "src/cli.ts" },
      toolCalls: [],
      startTime: "2025-12-16T10:00:00.000Z",
    };

    const output: ExecutorOutput = {
      outputs: { result: "success", findings: ["issue1", "issue2"] },
      endTime: "2025-12-16T10:05:00.000Z",
    };

    const metadata = createFrameMetadata(context, output);

    expect(metadata.executorRole).toBe("senior-dev");
    expect(metadata.inputsHash).toBeDefined();
    expect(metadata.inputsHash).toHaveLength(64); // SHA-256 hash length
    expect(metadata.outputsHash).toBeDefined();
    expect(metadata.outputsHash).toHaveLength(64);
    expect(metadata.durationMs).toBe(300000); // 5 minutes
    expect(metadata.toolCalls).toEqual([]);
  });

  it("should include tool calls in metadata", () => {
    const toolCalls: ToolCall[] = [
      {
        tool: "grep_search",
        timestamp: "2025-12-16T10:01:00.000Z",
        durationMs: 150,
        success: true,
      },
      {
        tool: "read_file",
        timestamp: "2025-12-16T10:02:00.000Z",
        durationMs: 80,
        success: true,
      },
    ];

    const context: ExecutorInvocationContext = {
      executorRole: "eager-pm",
      runId: "01JFZG7X2T3K4M5N6P7Q8R9S0X",
      inputs: { task: "select-issues" },
      toolCalls,
      startTime: "2025-12-16T10:00:00.000Z",
    };

    const output: ExecutorOutput = {
      outputs: { selectedIssues: ["#101", "#102"] },
      endTime: "2025-12-16T10:03:00.000Z",
    };

    const metadata = createFrameMetadata(context, output);

    expect(metadata.toolCalls).toHaveLength(2);
    expect(metadata.toolCalls[0].tool).toBe("grep_search");
    expect(metadata.toolCalls[1].tool).toBe("read_file");
  });

  it("should produce deterministic hashes for same inputs", () => {
    const inputs = { key1: "value1", key2: "value2" };
    const context1: ExecutorInvocationContext = {
      executorRole: "test",
      runId: "run1",
      inputs,
      toolCalls: [],
      startTime: "2025-12-16T10:00:00.000Z",
    };
    const context2: ExecutorInvocationContext = {
      executorRole: "test",
      runId: "run2",
      inputs,
      toolCalls: [],
      startTime: "2025-12-16T11:00:00.000Z",
    };

    const output1: ExecutorOutput = {
      outputs: { result: "ok" },
      endTime: "2025-12-16T10:01:00.000Z",
    };
    const output2: ExecutorOutput = {
      outputs: { result: "ok" },
      endTime: "2025-12-16T11:01:00.000Z",
    };

    const metadata1 = createFrameMetadata(context1, output1);
    const metadata2 = createFrameMetadata(context2, output2);

    expect(metadata1.inputsHash).toBe(metadata2.inputsHash);
    expect(metadata1.outputsHash).toBe(metadata2.outputsHash);
  });

  it("should produce different hashes for different inputs", () => {
    const context1: ExecutorInvocationContext = {
      executorRole: "test",
      runId: "run1",
      inputs: { key: "value1" },
      toolCalls: [],
      startTime: "2025-12-16T10:00:00.000Z",
    };
    const context2: ExecutorInvocationContext = {
      executorRole: "test",
      runId: "run1",
      inputs: { key: "value2" },
      toolCalls: [],
      startTime: "2025-12-16T10:00:00.000Z",
    };

    const output: ExecutorOutput = {
      outputs: { result: "ok" },
      endTime: "2025-12-16T10:01:00.000Z",
    };

    const metadata1 = createFrameMetadata(context1, output);
    const metadata2 = createFrameMetadata(context2, output);

    expect(metadata1.inputsHash).not.toBe(metadata2.inputsHash);
  });
});

describe("enforceFrameEmission", () => {
  it("should return frame when present", () => {
    const context: ExecutorInvocationContext = {
      executorRole: "senior-dev",
      runId: "01JFZG7X2T3K4M5N6P7Q8R9S0W",
      inputs: { prNumber: "123" },
      toolCalls: [],
      startTime: "2025-12-16T10:00:00.000Z",
    };

    const frame: ExecutionFrame = {
      type: "execution",
      reference_point: "test-frame-001",
      summary_caption: "Test execution",
      module_scope: ["src/test"],
      keywords: ["test"],
      outcome: "success",
      next_actions: ["verify"],
    };

    const output: ExecutorOutput = {
      outputs: { result: "success" },
      endTime: "2025-12-16T10:01:00.000Z",
      frame,
    };

    const result = enforceFrameEmission(context, output);

    expect(result).toBe(frame);
  });

  it("should throw FrameContractViolationError when frame missing", () => {
    const context: ExecutorInvocationContext = {
      executorRole: "senior-dev",
      runId: "01JFZG7X2T3K4M5N6P7Q8R9S0W",
      inputs: { prNumber: "123" },
      toolCalls: [],
      startTime: "2025-12-16T10:00:00.000Z",
    };

    const output: ExecutorOutput = {
      outputs: { result: "success" },
      endTime: "2025-12-16T10:01:00.000Z",
      // No frame!
    };

    expect(() => enforceFrameEmission(context, output)).toThrow(FrameContractViolationError);

    expect(() => enforceFrameEmission(context, output)).toThrow(
      "Executor 'senior-dev' did not emit a Frame"
    );
  });

  it("should include executor role and runId in error", () => {
    const context: ExecutorInvocationContext = {
      executorRole: "eager-pm",
      runId: "01JFZG7X2T3K4M5N6P7Q8R9S0X",
      inputs: { task: "select" },
      toolCalls: [],
      startTime: "2025-12-16T10:00:00.000Z",
    };

    const output: ExecutorOutput = {
      outputs: { result: "fail" },
      endTime: "2025-12-16T10:01:00.000Z",
    };

    expect(() => enforceFrameEmission(context, output)).toThrow(FrameContractViolationError);

    // Verify error properties
    try {
      enforceFrameEmission(context, output);
    } catch (error) {
      expect(error).toBeInstanceOf(FrameContractViolationError);
      const err = error as FrameContractViolationError;
      expect(err.executorRole).toBe("eager-pm");
      expect(err.runId).toBe("01JFZG7X2T3K4M5N6P7Q8R9S0X");
    }
  });
});

describe("withFrameContract", () => {
  it("should enforce frame emission on wrapped executor", async () => {
    const mockExecutor = async (
      inputs: { task: string },
      _context: ExecutorInvocationContext
    ): Promise<ExecutorOutput> => {
      return {
        outputs: { result: "done" },
        endTime: new Date().toISOString(),
        frame: {
          type: "execution",
          reference_point: "test-001",
          summary_caption: "Test task completed",
          module_scope: ["test"],
          keywords: ["test"],
          outcome: "success",
          next_actions: ["verify"],
        },
      };
    };

    const wrappedExecutor = withFrameContract(mockExecutor, {
      executorRole: "test-executor",
      runId: "test-run-001",
    });

    const result = await wrappedExecutor({ task: "test" });

    expect(result.validatedFrame).toBeDefined();
    expect(result.validatedFrame.type).toBe("execution");
    expect(result.outputs.result).toBe("done");
  });

  it("should throw when wrapped executor does not emit frame", async () => {
    const badExecutor = async (
      inputs: { task: string },
      _context: ExecutorInvocationContext
    ): Promise<ExecutorOutput> => {
      return {
        outputs: { result: "done" },
        endTime: new Date().toISOString(),
        // Missing frame!
      };
    };

    const wrappedExecutor = withFrameContract(badExecutor, {
      executorRole: "bad-executor",
      runId: "test-run-002",
    });

    await expect(wrappedExecutor({ task: "test" })).rejects.toThrow(FrameContractViolationError);
  });

  it("should pass context to executor with tool calls tracking", async () => {
    let capturedContext: ExecutorInvocationContext | null = null;

    const mockExecutor = async (
      inputs: { task: string },
      context: ExecutorInvocationContext
    ): Promise<ExecutorOutput> => {
      capturedContext = context;
      return {
        outputs: { result: "done" },
        endTime: new Date().toISOString(),
        frame: {
          type: "execution",
          reference_point: "test-001",
          summary_caption: "Test",
          module_scope: [],
          keywords: [],
          outcome: "success",
          next_actions: [],
        },
      };
    };

    const wrappedExecutor = withFrameContract(mockExecutor, {
      executorRole: "test-executor",
      runId: "test-run-003",
    });

    await wrappedExecutor({ task: "test" });

    expect(capturedContext).not.toBeNull();
    expect(capturedContext?.executorRole).toBe("test-executor");
    expect(capturedContext?.runId).toBe("test-run-003");
    expect(capturedContext?.inputs).toEqual({ task: "test" });
    expect(capturedContext?.toolCalls).toEqual([]);
    expect(capturedContext?.startTime).toBeDefined();
  });
});

describe("validateFrameMetadata", () => {
  it("should validate frame with metadata", () => {
    const frame: ExecutionFrame = {
      type: "execution",
      reference_point: "test-001",
      summary_caption: "Test",
      module_scope: [],
      keywords: [],
      outcome: "success",
      next_actions: [],
      metadata: {
        duration_ms: 1000,
        run_id: "test-run",
      },
    };

    const isValid = validateFrameMetadata(frame, {
      executorRole: "test",
      inputsHash: "abc123",
      outputsHash: "def456",
      toolCalls: [],
    });

    expect(isValid).toBe(true);
  });

  it("should reject frame without metadata", () => {
    const frame: ExecutionFrame = {
      type: "execution",
      reference_point: "test-001",
      summary_caption: "Test",
      module_scope: [],
      keywords: [],
      outcome: "success",
      next_actions: [],
      // No metadata
    };

    const isValid = validateFrameMetadata(frame, {
      executorRole: "test",
      inputsHash: "abc123",
      outputsHash: "def456",
      toolCalls: [],
    });

    expect(isValid).toBe(false);
  });
});

describe("buildFrameFromTemplate", () => {
  it("should build valid ExecutionFrame from template", () => {
    const template: ExecutorFrameTemplate = {
      role: "senior-dev",
      runId: "01JFZG7X2T3K4M5N6P7Q8R9S0W",
      summary: "Code review completed",
      moduleScope: ["src/cli.ts", "src/schema.ts"],
      outcome: "success",
      nextActions: ["Address findings", "Merge PR"],
      inputsHash: "abc123def456",
      outputsHash: "789ghi012jkl",
      toolCalls: [
        {
          tool: "grep_search",
          timestamp: "2025-12-16T10:01:00.000Z",
          durationMs: 150,
          success: true,
        },
      ],
      durationMs: 120000,
    };

    const frame = buildFrameFromTemplate(template);

    expect(frame.type).toBe("execution");
    expect(frame.reference_point).toMatch(/^executor-senior-dev-\d{4}-\d{2}-\d{2}-/);
    expect(frame.summary_caption).toBe("Code review completed");
    expect(frame.module_scope).toEqual(["src/cli.ts", "src/schema.ts"]);
    expect(frame.keywords).toContain("executor");
    expect(frame.keywords).toContain("senior-dev");
    expect(frame.outcome).toBe("success");
    expect(frame.next_actions).toContain("Address findings");
    expect(frame.metadata?.duration_ms).toBe(120000);
    expect(frame.metadata?.run_id).toBe("01JFZG7X2T3K4M5N6P7Q8R9S0W");
    expect(frame.metadata?.executor_role).toBe("senior-dev");
    expect(frame.metadata?.inputs_hash).toBe("abc123def456");
    expect(frame.metadata?.outputs_hash).toBe("789ghi012jkl");
    expect(frame.metadata?.tool_calls_count).toBe(1);
    expect(frame.metadata?.tool_calls).toHaveLength(1);
    expect(frame.metadata?.tool_calls?.[0].tool).toBe("grep_search");
  });

  it("should include error in metadata when provided", () => {
    const template: ExecutorFrameTemplate = {
      role: "eager-pm",
      runId: "01JFZG7X2T3K4M5N6P7Q8R9S0X",
      summary: "Issue selection failed",
      moduleScope: [],
      outcome: "failure",
      nextActions: ["Retry with different criteria"],
      inputsHash: "hash1",
      outputsHash: "hash2",
      toolCalls: [],
      durationMs: 5000,
      error: "No issues found matching criteria",
    };

    const frame = buildFrameFromTemplate(template);

    expect(frame.outcome).toBe("failure");
    expect(frame.metadata?.error).toBe("No issues found matching criteria");
  });

  it("should include custom metadata when provided", () => {
    const template: ExecutorFrameTemplate = {
      role: "custom-executor",
      runId: "01JFZG7X2T3K4M5N6P7Q8R9S0Y",
      summary: "Custom task",
      moduleScope: ["module1"],
      outcome: "partial",
      nextActions: ["Continue processing"],
      inputsHash: "hashA",
      outputsHash: "hashB",
      toolCalls: [],
      durationMs: 10000,
      metadata: {
        customField1: "value1",
        customField2: 42,
        customField3: true,
      },
    };

    const frame = buildFrameFromTemplate(template);

    expect(frame.metadata?.customField1).toBe("value1");
    expect(frame.metadata?.customField2).toBe(42);
    expect(frame.metadata?.customField3).toBe(true);
    // Should still have contract metadata
    expect(frame.metadata?.executor_role).toBe("custom-executor");
    expect(frame.metadata?.inputs_hash).toBe("hashA");
  });

  it("should handle empty tool calls array", () => {
    const template: ExecutorFrameTemplate = {
      role: "minimal-executor",
      runId: "run-001",
      summary: "Minimal execution",
      moduleScope: [],
      outcome: "success",
      nextActions: [],
      inputsHash: "hash1",
      outputsHash: "hash2",
      toolCalls: [],
      durationMs: 1000,
    };

    const frame = buildFrameFromTemplate(template);

    expect(frame.metadata?.tool_calls_count).toBe(0);
    expect(frame.metadata?.tool_calls).toEqual([]);
  });

  it("should include tool call errors in metadata", () => {
    const template: ExecutorFrameTemplate = {
      role: "test-executor",
      runId: "run-002",
      summary: "Test with failed tool call",
      moduleScope: [],
      outcome: "partial",
      nextActions: ["Retry failed operations"],
      inputsHash: "hash1",
      outputsHash: "hash2",
      toolCalls: [
        {
          tool: "failing_tool",
          timestamp: "2025-12-16T10:00:00.000Z",
          durationMs: 100,
          success: false,
          error: "Tool execution failed",
        },
      ],
      durationMs: 2000,
    };

    const frame = buildFrameFromTemplate(template);

    expect(frame.metadata?.tool_calls).toHaveLength(1);
    expect(frame.metadata?.tool_calls?.[0].success).toBe(false);
    expect(frame.metadata?.tool_calls?.[0].error).toBe("Tool execution failed");
  });
});

describe("FrameContractViolationError", () => {
  it("should be an instance of Error", () => {
    const error = new FrameContractViolationError("test-executor", "run-001", "Test error");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("FrameContractViolationError");
  });

  it("should store executor role and runId", () => {
    const error = new FrameContractViolationError(
      "senior-dev",
      "01JFZG7X2T3K4M5N6P7Q8R9S0W",
      "Frame not emitted"
    );

    expect(error.executorRole).toBe("senior-dev");
    expect(error.runId).toBe("01JFZG7X2T3K4M5N6P7Q8R9S0W");
    expect(error.message).toBe("Frame not emitted");
  });
});
