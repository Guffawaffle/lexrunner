/**
 * Tests for stack frame parsing
 */

import { describe, it, expect } from "vitest";
import { parseStackFrames } from "../../../../src/gates/test/enrichment/stackParser.js";

describe("parseStackFrames", () => {
  it("should parse V8 stack trace with function names", () => {
    const stack = `Error: Test failed
    at testFunction (/path/to/file.ts:42:10)
    at runTest (/path/to/test.ts:100:5)`;

    const frames = parseStackFrames(stack);

    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual({
      function: "testFunction",
      file: "/path/to/file.ts",
      line: 42,
      column: 10,
    });
    expect(frames[1]).toEqual({
      function: "runTest",
      file: "/path/to/test.ts",
      line: 100,
      column: 5,
    });
  });

  it("should parse stack trace without function names", () => {
    const stack = `Error: Test failed
    at /path/to/file.ts:42:10
    at /path/to/test.ts:100:5`;

    const frames = parseStackFrames(stack);

    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual({
      file: "/path/to/file.ts",
      line: 42,
      column: 10,
    });
  });

  it("should handle async stack frames", () => {
    const stack = `Error: Async failed
    at async testAsync (/path/to/file.ts:42:10)
    at async runAsync (/path/to/test.ts:100:5)`;

    const frames = parseStackFrames(stack);

    expect(frames).toHaveLength(2);
    expect(frames[0].function).toBe("testAsync");
    expect(frames[0].file).toBe("/path/to/file.ts");
  });

  it("should filter out node_modules by default", () => {
    const stack = `Error: Test failed
    at testFunction (/path/to/file.ts:42:10)
    at nodeModule (/path/node_modules/lib/index.js:10:5)
    at anotherTest (/path/to/test.ts:100:5)`;

    const frames = parseStackFrames(stack);

    expect(frames).toHaveLength(2);
    expect(frames[0].file).toBe("/path/to/file.ts");
    expect(frames[1].file).toBe("/path/to/test.ts");
  });

  it("should include node_modules when configured", () => {
    const stack = `Error: Test failed
    at testFunction (/path/to/file.ts:42:10)
    at nodeModule (/path/node_modules/lib/index.js:10:5)`;

    const frames = parseStackFrames(stack, { filterNodeModules: false });

    expect(frames).toHaveLength(2);
    expect(frames[1].file).toContain("node_modules");
  });

  it("should filter internal Node.js frames", () => {
    const stack = `Error: Test failed
    at testFunction (/path/to/file.ts:42:10)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)
    at Function.runMain (node:internal/modules/run_main:81:12)`;

    const frames = parseStackFrames(stack);

    expect(frames).toHaveLength(1);
    expect(frames[0].file).toBe("/path/to/file.ts");
  });

  it("should respect maxFrames limit", () => {
    const stack = `Error: Test failed
    at frame1 (/path/to/file1.ts:1:1)
    at frame2 (/path/to/file2.ts:2:2)
    at frame3 (/path/to/file3.ts:3:3)
    at frame4 (/path/to/file4.ts:4:4)
    at frame5 (/path/to/file5.ts:5:5)
    at frame6 (/path/to/file6.ts:6:6)`;

    const frames = parseStackFrames(stack, { maxFrames: 3 });

    expect(frames).toHaveLength(3);
    expect(frames[0].file).toBe("/path/to/file1.ts");
    expect(frames[2].file).toBe("/path/to/file3.ts");
  });

  it("should handle custom filter patterns", () => {
    const stack = `Error: Test failed
    at testFunction (/path/to/file.ts:42:10)
    at vendorCode (/path/vendor/lib.js:10:5)
    at anotherTest (/path/to/test.ts:100:5)`;

    const frames = parseStackFrames(stack, {
      filterPatterns: [/\/vendor\//],
    });

    expect(frames).toHaveLength(2);
    expect(frames[0].file).toBe("/path/to/file.ts");
    expect(frames[1].file).toBe("/path/to/test.ts");
  });

  it("should handle empty stack trace", () => {
    const frames = parseStackFrames("");
    expect(frames).toEqual([]);
  });

  it("should handle stack trace with only error message", () => {
    const stack = "Error: Something went wrong";
    const frames = parseStackFrames(stack);
    expect(frames).toEqual([]);
  });

  it("should parse Windows-style paths", () => {
    const stack = `Error: Test failed
    at testFunction (C:\\Users\\test\\file.ts:42:10)`;

    const frames = parseStackFrames(stack);

    expect(frames).toHaveLength(1);
    expect(frames[0].file).toBe("C:\\Users\\test\\file.ts");
  });

  it("should handle anonymous functions", () => {
    const stack = `Error: Test failed
    at <anonymous> (/path/to/file.ts:42:10)
    at testFunction (/path/to/test.ts:100:5)`;

    const frames = parseStackFrames(stack, { filterPatterns: [] });

    // Anonymous frames with real file paths are kept for debugging value
    expect(frames).toHaveLength(2);
    expect(frames[0].function).toBe("<anonymous>");
    expect(frames[0].file).toBe("/path/to/file.ts");
    expect(frames[1].function).toBe("testFunction");
  });

  it("should handle real Node.js stack trace", () => {
    const stack = `TypeError: Cannot read property 'foo' of undefined
    at Object.<anonymous> (/home/user/project/test.ts:10:5)
    at Module._compile (node:internal/modules/cjs/loader:1126:14)
    at Object.Module._extensions..js (node:internal/modules/cjs/loader:1180:10)
    at Module.load (node:internal/modules/cjs/loader:1004:32)
    at Function.Module._load (node:internal/modules/cjs/loader:839:12)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:81:12)`;

    const frames = parseStackFrames(stack);

    // Should only include the first frame (user code)
    expect(frames).toHaveLength(1);
    expect(frames[0].file).toBe("/home/user/project/test.ts");
    expect(frames[0].line).toBe(10);
  });

  it("should handle Vitest stack traces", () => {
    const stack = `Error: expect(received).toBe(expected)
    at /path/to/test.spec.ts:15:20
    at /path/to/node_modules/vitest/dist/chunk.js:100:5`;

    const frames = parseStackFrames(stack);

    expect(frames).toHaveLength(1);
    expect(frames[0].file).toBe("/path/to/test.spec.ts");
  });

  it("should truncate to default 5 frames", () => {
    const stack = `Error: Test
    at f1 (/f1.ts:1:1)
    at f2 (/f2.ts:2:2)
    at f3 (/f3.ts:3:3)
    at f4 (/f4.ts:4:4)
    at f5 (/f5.ts:5:5)
    at f6 (/f6.ts:6:6)
    at f7 (/f7.ts:7:7)
    at f8 (/f8.ts:8:8)`;

    const frames = parseStackFrames(stack);

    expect(frames).toHaveLength(5);
  });
});
