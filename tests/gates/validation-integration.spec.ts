import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeGate } from "../../src/gates.js";
import { Gate, Policy } from "../../src/schema.js";
import { makeGate } from "../helpers/makeGate.js";
import { getStd } from "../helpers/getStd.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Gate Input Validation Integration", () => {
  const defaultPolicy: Policy = {
    requiredGates: [],
    optionalGates: [],
    maxWorkers: 1,
    retries: {},
    overrides: {},
    blockOn: [],
    mergeRule: { type: "strict-required" },
  };

  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-validation-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it("validates gate input before execution", async () => {
    const gate = makeGate({
      name: "lint",
      run: 'echo "should not run"',
      runtime: "local" as any,
      input: {
        files: [], // Invalid: empty array
        linter: "eslint",
      } as any,
    });

    const result = await executeGate(gate, defaultPolicy, tempDir, 5000);

    expect(result.status).toBe("fail");
    expect(getStd(result.stderr)).toContain('Invalid input for gate "lint"');
    expect(getStd(result.stderr)).toContain("should NOT have fewer than 1 items");
    expect(result.attempts).toBe(0); // Validation failure, no execution attempts
  });

  it("executes gate when input is valid", async () => {
    const gate = makeGate({
      name: "lint",
      run: 'echo "linting complete"',
      runtime: "local" as any,
      input: {
        files: ["src/index.ts"],
        linter: "eslint",
      } as any,
    });

    const result = await executeGate(gate, defaultPolicy, tempDir, 5000);

    expect(result.status).toBe("pass");
    expect(getStd(result.stdout)).toContain("linting complete");
    expect(result.attempts).toBe(1);
  });

  it("skips validation when skipValidation is true", async () => {
    const gate = makeGate({
      name: "lint",
      run: 'echo "executed without validation"',
      runtime: "local" as any,
      input: {
        files: [], // Invalid but will be skipped
        linter: "eslint",
      } as any,
    });

    const result = await executeGate(gate, defaultPolicy, tempDir, 5000, undefined, true);

    expect(result.status).toBe("pass");
    expect(getStd(result.stdout)).toContain("executed without validation");
  });

  it("executes gate without input field normally", async () => {
    const gate = makeGate({
      name: "test-no-input",
      run: 'echo "no input validation"',
      runtime: "local" as any,
    });

    const result = await executeGate(gate, defaultPolicy, tempDir, 5000);

    expect(result.status).toBe("pass");
    expect(getStd(result.stdout)).toContain("no input validation");
  });

  it("validates multiple gate types correctly", async () => {
    const testGate = makeGate({
      name: "test",
      run: 'echo "test"',
      runtime: "local" as any,
      input: {
        framework: "vitest",
        files: ["tests/*.spec.ts"],
      } as any,
    });

    const buildGate = makeGate({
      name: "build",
      run: 'echo "build"',
      runtime: "local" as any,
      input: {
        command: "npm run build",
        outputDir: "dist",
      } as any,
    });

    const testResult = await executeGate(testGate, defaultPolicy, tempDir, 5000);
    const buildResult = await executeGate(buildGate, defaultPolicy, tempDir, 5000);

    expect(testResult.status).toBe("pass");
    expect(buildResult.status).toBe("pass");
  });

  it("provides detailed error for multiple validation failures", async () => {
    const gate = makeGate({
      name: "lint",
      run: 'echo "should not run"',
      runtime: "local" as any,
      input: {
        files: [], // Invalid: empty
        linter: "invalid-linter", // Invalid: not in enum
        unknownField: "value", // Invalid: additional property
      } as any,
    });

    const result = await executeGate(gate, defaultPolicy, tempDir, 5000);

    expect(result.status).toBe("fail");
    expect(getStd(result.stderr)).toContain('Invalid input for gate "lint"');
    // Should contain multiple error messages
    expect(getStd(result.stderr).length).toBeGreaterThan(50);
  });
});
