/**
 * Tests for scopeValidator.ts - Static analysis for agent edit scope validation
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  validateEditScope,
  analyzeFileScope,
  ScopeValidationError,
  type EditPlan,
} from "../src/planner/scopeValidator.js";

describe("scopeValidator", () => {
  const testDir = path.join(process.cwd(), ".test-scope-validator");

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("analyzeFileScope", () => {
    it("should detect ESM module system", async () => {
      const filePath = path.join(testDir, "esm.ts");
      fs.writeFileSync(
        filePath,
        `
        import { foo } from './bar';
        export function myFunction() {
          return 42;
        }
      `
      );

      const result = await analyzeFileScope(filePath);
      expect(result.module_system).toBe("esm");
      expect(result.functions_modified).toContain("myFunction");
      expect(result.validation_method).toBe("babel-ast");
    });

    it("should detect CommonJS module system", async () => {
      const filePath = path.join(testDir, "commonjs.js");
      fs.writeFileSync(
        filePath,
        `
        const bar = require('./bar');
        function myFunction() {
          return 42;
        }
        module.exports = { myFunction };
      `
      );

      const result = await analyzeFileScope(filePath);
      expect(result.module_system).toBe("commonjs");
      expect(result.functions_modified).toContain("myFunction");
    });

    it("should detect AMD module system", async () => {
      const filePath = path.join(testDir, "amd.js");
      fs.writeFileSync(
        filePath,
        `
        define(['dep'], function(dep) {
          function processPayment(amount) {
            return amount * 1.1;
          }
          return { processPayment };
        });
      `
      );

      const result = await analyzeFileScope(filePath);
      expect(result.module_system).toBe("amd");
      expect(result.functions_modified).toContain("processPayment");
    });

    it("should detect function declarations", async () => {
      const filePath = path.join(testDir, "functions.ts");
      fs.writeFileSync(
        filePath,
        `
        function foo() {}
        function bar() {}
        const baz = () => {};
      `
      );

      const result = await analyzeFileScope(filePath);
      expect(result.functions_modified).toContain("foo");
      expect(result.functions_modified).toContain("bar");
      // Arrow functions assigned to variables are not detected as function declarations
      expect(result.functions_modified).not.toContain("baz");
    });

    it("should detect class declarations", async () => {
      const filePath = path.join(testDir, "classes.ts");
      fs.writeFileSync(
        filePath,
        `
        class MyClass {
          method() {}
        }
        class AnotherClass {
          constructor() {}
        }
      `
      );

      const result = await analyzeFileScope(filePath);
      expect(result.classes_modified).toContain("MyClass");
      expect(result.classes_modified).toContain("AnotherClass");
    });

    it("should detect global writes to window", async () => {
      const filePath = path.join(testDir, "globals.js");
      fs.writeFileSync(
        filePath,
        `
        window.DEBUG_MODE = true;
        window.globalConfig = { foo: 'bar' };
        function test() {
          window.testVar = 123;
        }
      `
      );

      const result = await analyzeFileScope(filePath);
      expect(result.globals_written).toContain("window.DEBUG_MODE");
      expect(result.globals_written).toContain("window.globalConfig");
      expect(result.globals_written).toContain("window.testVar");
      expect(result.side_effects).toBe("global");
    });

    it("should detect global writes to global object", async () => {
      const filePath = path.join(testDir, "node-globals.js");
      fs.writeFileSync(
        filePath,
        `
        global.myVar = 'test';
      `
      );

      const result = await analyzeFileScope(filePath);
      expect(result.globals_written).toContain("global.myVar");
      expect(result.side_effects).toBe("global");
    });

    it("should handle files with no side effects", async () => {
      const filePath = path.join(testDir, "pure.ts");
      fs.writeFileSync(
        filePath,
        `
        export function pureFunction(x: number): number {
          return x * 2;
        }
      `
      );

      const result = await analyzeFileScope(filePath);
      expect(result.side_effects).toBe("none");
      expect(result.globals_written).toHaveLength(0);
    });
  });

  describe("validateEditScope", () => {
    it("should pass validation when declared scope matches actual", async () => {
      const filePath = path.join(testDir, "valid.ts");
      fs.writeFileSync(
        filePath,
        `
        export function myFunction() {
          return 42;
        }
        export class MyClass {}
      `
      );

      const declaredPlan: Partial<EditPlan> = {
        functions_modified: ["myFunction"],
        classes_modified: ["MyClass"],
        side_effects: "none",
        globals_written: [],
      };

      const result = await validateEditScope(filePath, declaredPlan);
      expect(result.scope_validated).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should fail validation for undeclared function modifications", async () => {
      const filePath = path.join(testDir, "undeclared-func.ts");
      fs.writeFileSync(
        filePath,
        `
        export function myFunction() {
          return 42;
        }
        export function anotherFunction() {
          return 100;
        }
      `
      );

      const declaredPlan: Partial<EditPlan> = {
        functions_modified: ["myFunction"],
        side_effects: "none",
      };

      await expect(validateEditScope(filePath, declaredPlan)).rejects.toThrow(ScopeValidationError);

      try {
        await validateEditScope(filePath, declaredPlan);
      } catch (error) {
        expect(error).toBeInstanceOf(ScopeValidationError);
        const scopeError = error as ScopeValidationError;
        expect(scopeError.violations).toBeDefined();
        expect(scopeError.violations?.some((v) => v.type === "undeclared_function")).toBe(true);
        expect(scopeError.violations?.some((v) => v.message.includes("anotherFunction"))).toBe(
          true
        );
      }
    });

    it("should fail validation for undeclared class modifications", async () => {
      const filePath = path.join(testDir, "undeclared-class.ts");
      fs.writeFileSync(
        filePath,
        `
        export class MyClass {}
        export class SecretClass {}
      `
      );

      const declaredPlan: Partial<EditPlan> = {
        classes_modified: ["MyClass"],
        side_effects: "none",
      };

      await expect(validateEditScope(filePath, declaredPlan)).rejects.toThrow(ScopeValidationError);

      try {
        await validateEditScope(filePath, declaredPlan);
      } catch (error) {
        expect(error).toBeInstanceOf(ScopeValidationError);
        const scopeError = error as ScopeValidationError;
        expect(scopeError.violations?.some((v) => v.type === "undeclared_class")).toBe(true);
        expect(scopeError.violations?.some((v) => v.message.includes("SecretClass"))).toBe(true);
      }
    });

    it("should fail validation for undeclared global writes", async () => {
      const filePath = path.join(testDir, "undeclared-global.js");
      fs.writeFileSync(
        filePath,
        `
        function processPayment(amount) {
          window.DEBUG_MODE = true;  // ❌ UNDECLARED GLOBAL
          return amount * 1.1;
        }
      `
      );

      const declaredPlan: Partial<EditPlan> = {
        functions_modified: ["processPayment"],
        side_effects: "none",
        globals_written: [],
      };

      await expect(validateEditScope(filePath, declaredPlan)).rejects.toThrow(ScopeValidationError);

      try {
        await validateEditScope(filePath, declaredPlan);
      } catch (error) {
        expect(error).toBeInstanceOf(ScopeValidationError);
        const scopeError = error as ScopeValidationError;
        expect(scopeError.violations?.some((v) => v.type === "global_write")).toBe(true);
        expect(scopeError.violations?.some((v) => v.message.includes("window.DEBUG_MODE"))).toBe(
          true
        );
      }
    });

    it("should fail validation when side effects mismatch", async () => {
      const filePath = path.join(testDir, "side-effects.js");
      fs.writeFileSync(
        filePath,
        `
        window.config = {};
        function setup() {}
      `
      );

      const declaredPlan: Partial<EditPlan> = {
        functions_modified: ["setup"],
        side_effects: "none", // Claims no side effects but has global writes
      };

      await expect(validateEditScope(filePath, declaredPlan)).rejects.toThrow(ScopeValidationError);

      try {
        await validateEditScope(filePath, declaredPlan);
      } catch (error) {
        expect(error).toBeInstanceOf(ScopeValidationError);
        const scopeError = error as ScopeValidationError;
        expect(scopeError.violations?.some((v) => v.type === "side_effect")).toBe(true);
      }
    });

    it("should pass validation when global writes are declared", async () => {
      const filePath = path.join(testDir, "declared-global.js");
      fs.writeFileSync(
        filePath,
        `
        window.DEBUG_MODE = true;
        function processPayment(amount) {
          return amount * 1.1;
        }
      `
      );

      const declaredPlan: Partial<EditPlan> = {
        functions_modified: ["processPayment"],
        side_effects: "global",
        globals_written: ["window.DEBUG_MODE"],
      };

      const result = await validateEditScope(filePath, declaredPlan);
      expect(result.scope_validated).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should handle complex AMD module case from issue", async () => {
      const filePath = path.join(testDir, "amd-complex.js");
      fs.writeFileSync(
        filePath,
        `
        define(['dep'], function(dep) {
          window.DEBUG_MODE = true;  // ❌ GLOBAL SIDE EFFECT

          function processPayment(amount) {
            return amount * 1.1;
          }

          function auditLog(msg) {
            console.log('AUDIT:', msg);
          }

          return { processPayment, auditLog };
        });
      `
      );

      const declaredPlan: Partial<EditPlan> = {
        functions_modified: ["processPayment"], // Agent claims to only edit processPayment
        side_effects: "none",
        globals_written: [],
      };

      await expect(validateEditScope(filePath, declaredPlan)).rejects.toThrow(ScopeValidationError);

      try {
        await validateEditScope(filePath, declaredPlan);
      } catch (error) {
        expect(error).toBeInstanceOf(ScopeValidationError);
        const scopeError = error as ScopeValidationError;

        // Should detect undeclared auditLog modification
        expect(
          scopeError.violations?.some(
            (v) => v.type === "undeclared_function" && v.message.includes("auditLog")
          )
        ).toBe(true);

        // Should detect undeclared global write
        expect(
          scopeError.violations?.some(
            (v) => v.type === "global_write" && v.message.includes("window.DEBUG_MODE")
          )
        ).toBe(true);

        // Should detect side effect mismatch
        expect(scopeError.violations?.some((v) => v.type === "side_effect")).toBe(true);
      }
    });

    it("should throw error for unsupported file types", async () => {
      const filePath = path.join(testDir, "test.py");
      fs.writeFileSync(filePath, "print('hello')");

      await expect(validateEditScope(filePath, {})).rejects.toThrow("Unsupported file type");
    });

    it("should handle TypeScript-specific syntax", async () => {
      const filePath = path.join(testDir, "typescript.ts");
      fs.writeFileSync(
        filePath,
        `
        interface MyInterface {
          foo: string;
        }
        
        export function myFunction(arg: MyInterface): void {
          console.log(arg.foo);
        }
        
        export class MyClass implements MyInterface {
          foo: string = "bar";
        }
      `
      );

      const result = await analyzeFileScope(filePath);
      expect(result.module_system).toBe("esm");
      expect(result.functions_modified).toContain("myFunction");
      expect(result.classes_modified).toContain("MyClass");
    });
  });

  describe("ScopeValidationError", () => {
    it("should format error message correctly", () => {
      const violations = [
        {
          type: "undeclared_function" as const,
          message: "Function 'foo' modified but not declared",
          location: { line: 10, column: 5 },
        },
        {
          type: "global_write" as const,
          message: "Global 'window.DEBUG' written but not declared",
          location: { line: 15, column: 3 },
        },
      ];

      const error = new ScopeValidationError("/path/to/file.js", violations);

      expect(error.name).toBe("ScopeValidationError");
      expect(error.message).toContain("/path/to/file.js");
      expect(error.message).toContain("undeclared_function");
      expect(error.message).toContain("line 10");
      expect(error.message).toContain("global_write");
      expect(error.message).toContain("line 15");
      expect(error.violations).toEqual(violations);
    });
  });

  describe("edge cases", () => {
    it("should handle empty files", async () => {
      const filePath = path.join(testDir, "empty.js");
      fs.writeFileSync(filePath, "");

      const result = await analyzeFileScope(filePath);
      expect(result.functions_modified).toHaveLength(0);
      expect(result.classes_modified).toHaveLength(0);
      expect(result.globals_written).toHaveLength(0);
      expect(result.side_effects).toBe("none");
    });

    it("should handle files with only comments", async () => {
      const filePath = path.join(testDir, "comments.js");
      fs.writeFileSync(
        filePath,
        `
        // This is a comment
        /* Multi-line
           comment */
      `
      );

      const result = await analyzeFileScope(filePath);
      expect(result.functions_modified).toHaveLength(0);
    });

    it("should handle mixed module systems", async () => {
      const filePath = path.join(testDir, "mixed.js");
      fs.writeFileSync(
        filePath,
        `
        import { foo } from './foo';
        const bar = require('./bar');
      `
      );

      const result = await analyzeFileScope(filePath);
      // ESM takes precedence when both are present
      expect(result.module_system).toBe("esm");
    });
  });
});
