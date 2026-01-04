/**
 * Tests for TestAdapter Registry
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerAdapter,
  getAdapter,
  detectAdapter,
  listAdapters,
  requireAdapter,
  requireDetectedAdapter,
  clearAdapters,
  getAdapterCount,
  AdapterNotFoundError,
  type TestAdapter,
} from "../../../../src/gates/test/adapters/index.js";
import { createAXTestResult } from "../../../../src/gates/test/schema.js";

describe("TestAdapter Registry", () => {
  // Create mock adapters for testing
  const createMockAdapter = (
    name: string,
    extensions: string[] = [".json"],
    detectPattern?: string
  ): TestAdapter => ({
    name,
    version: "1.0.0",
    extensions,
    detect: (content: string) => {
      if (detectPattern) {
        return content.includes(detectPattern);
      }
      return false;
    },
    parse: (input: string | Buffer) => {
      const content = typeof input === "string" ? input : input.toString("utf-8");
      return createAXTestResult({
        summary: {
          total: 1,
          passed: 1,
          failed: 0,
          skipped: 0,
          durationMs: 100,
        },
        failures: [],
        adapter: {
          name,
          version: "1.0.0",
          source: "test-input",
        },
      });
    },
  });

  beforeEach(() => {
    clearAdapters();
  });

  describe("registerAdapter", () => {
    it("should register an adapter", () => {
      const adapter = createMockAdapter("vitest-json");
      registerAdapter(adapter);

      expect(getAdapterCount()).toBe(1);
      expect(getAdapter("vitest-json")).toBe(adapter);
    });

    it("should throw if adapter with same name already registered", () => {
      const adapter1 = createMockAdapter("vitest-json");
      const adapter2 = createMockAdapter("vitest-json");

      registerAdapter(adapter1);

      expect(() => registerAdapter(adapter2)).toThrow(
        'Adapter "vitest-json" is already registered'
      );
    });

    it("should register multiple adapters", () => {
      const adapter1 = createMockAdapter("vitest-json");
      const adapter2 = createMockAdapter("jest-json");
      const adapter3 = createMockAdapter("junit-xml", [".xml"]);

      registerAdapter(adapter1);
      registerAdapter(adapter2);
      registerAdapter(adapter3);

      expect(getAdapterCount()).toBe(3);
    });
  });

  describe("getAdapter", () => {
    it("should return undefined for unregistered adapter", () => {
      expect(getAdapter("unknown-adapter")).toBeUndefined();
    });

    it("should return registered adapter by name", () => {
      const adapter = createMockAdapter("vitest-json");
      registerAdapter(adapter);

      expect(getAdapter("vitest-json")).toBe(adapter);
    });

    it("should handle multiple adapters", () => {
      const adapter1 = createMockAdapter("vitest-json");
      const adapter2 = createMockAdapter("jest-json");

      registerAdapter(adapter1);
      registerAdapter(adapter2);

      expect(getAdapter("vitest-json")).toBe(adapter1);
      expect(getAdapter("jest-json")).toBe(adapter2);
      expect(getAdapter("unknown")).toBeUndefined();
    });
  });

  describe("detectAdapter", () => {
    it("should return undefined when no adapters registered", () => {
      const content = '{"type": "vitest"}';
      expect(detectAdapter(content)).toBeUndefined();
    });

    it("should return undefined when no adapter matches", () => {
      const adapter = createMockAdapter("vitest-json", [".json"], "vitest-marker");
      registerAdapter(adapter);

      const content = '{"type": "jest"}';
      expect(detectAdapter(content)).toBeUndefined();
    });

    it("should return matching adapter", () => {
      const adapter = createMockAdapter("vitest-json", [".json"], "vitest");
      registerAdapter(adapter);

      const content = '{"type": "vitest", "results": []}';
      expect(detectAdapter(content)).toBe(adapter);
    });

    it("should return first matching adapter (priority by registration order)", () => {
      const adapter1 = createMockAdapter("adapter-1", [".json"], "common");
      const adapter2 = createMockAdapter("adapter-2", [".json"], "common");

      registerAdapter(adapter1);
      registerAdapter(adapter2);

      const content = '{"common": true}';
      expect(detectAdapter(content)).toBe(adapter1);
    });

    it("should handle adapter.detect() throwing", () => {
      const faultyAdapter: TestAdapter = {
        name: "faulty-adapter",
        version: "1.0.0",
        extensions: [".json"],
        detect: () => {
          throw new Error("detect failed");
        },
        parse: () => {
          throw new Error("not implemented");
        },
      };

      const workingAdapter = createMockAdapter("working-adapter", [".json"], "marker");

      registerAdapter(faultyAdapter);
      registerAdapter(workingAdapter);

      const content = '{"marker": true}';
      expect(detectAdapter(content)).toBe(workingAdapter);
    });
  });

  describe("listAdapters", () => {
    it("should return empty array when no adapters registered", () => {
      expect(listAdapters()).toEqual([]);
    });

    it("should return adapter info for all registered adapters", () => {
      const adapter1 = createMockAdapter("vitest-json", [".json"]);
      const adapter2 = createMockAdapter("junit-xml", [".xml"]);

      registerAdapter(adapter1);
      registerAdapter(adapter2);

      const list = listAdapters();
      expect(list).toHaveLength(2);
      expect(list).toContainEqual({
        name: "vitest-json",
        version: "1.0.0",
        extensions: [".json"],
      });
      expect(list).toContainEqual({
        name: "junit-xml",
        version: "1.0.0",
        extensions: [".xml"],
      });
    });

    it("should preserve registration order", () => {
      const adapter1 = createMockAdapter("adapter-1");
      const adapter2 = createMockAdapter("adapter-2");
      const adapter3 = createMockAdapter("adapter-3");

      registerAdapter(adapter1);
      registerAdapter(adapter2);
      registerAdapter(adapter3);

      const list = listAdapters();
      expect(list.map((a) => a.name)).toEqual(["adapter-1", "adapter-2", "adapter-3"]);
    });
  });

  describe("requireAdapter", () => {
    it("should throw AdapterNotFoundError when adapter not found", () => {
      expect(() => requireAdapter("unknown")).toThrow(AdapterNotFoundError);
      expect(() => requireAdapter("unknown")).toThrow('Adapter "unknown" not found');
    });

    it("should include suggestions when no adapters registered", () => {
      try {
        requireAdapter("unknown");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AdapterNotFoundError);
        const error = err as AdapterNotFoundError;
        expect(error.suggestions).toContain("No adapters registered");
      }
    });

    it("should include available adapters in suggestions", () => {
      registerAdapter(createMockAdapter("vitest-json"));
      registerAdapter(createMockAdapter("jest-json"));

      try {
        requireAdapter("unknown");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AdapterNotFoundError);
        const error = err as AdapterNotFoundError;
        expect(error.suggestions).toHaveLength(1);
        expect(error.suggestions[0]).toContain("vitest-json");
        expect(error.suggestions[0]).toContain("jest-json");
      }
    });

    it("should return adapter when found", () => {
      const adapter = createMockAdapter("vitest-json");
      registerAdapter(adapter);

      expect(requireAdapter("vitest-json")).toBe(adapter);
    });
  });

  describe("requireDetectedAdapter", () => {
    it("should throw AdapterNotFoundError when no adapter matches", () => {
      registerAdapter(createMockAdapter("vitest-json", [".json"], "vitest"));

      const content = '{"type": "jest"}';

      expect(() => requireDetectedAdapter(content)).toThrow(AdapterNotFoundError);
      expect(() => requireDetectedAdapter(content)).toThrow("No adapter detected");
    });

    it("should include helpful suggestions", () => {
      registerAdapter(createMockAdapter("vitest-json"));
      registerAdapter(createMockAdapter("jest-json"));

      const content = "unknown content";

      try {
        requireDetectedAdapter(content);
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AdapterNotFoundError);
        const error = err as AdapterNotFoundError;
        expect(error.suggestions.length).toBeGreaterThanOrEqual(1);
        expect(error.suggestions.some((s) => s.includes("vitest-json"))).toBe(true);
        expect(error.suggestions.some((s) => s.includes("--adapter"))).toBe(true);
      }
    });

    it("should return detected adapter", () => {
      const adapter = createMockAdapter("vitest-json", [".json"], "vitest");
      registerAdapter(adapter);

      const content = '{"type": "vitest"}';
      expect(requireDetectedAdapter(content)).toBe(adapter);
    });
  });

  describe("clearAdapters", () => {
    it("should remove all registered adapters", () => {
      registerAdapter(createMockAdapter("adapter-1"));
      registerAdapter(createMockAdapter("adapter-2"));
      expect(getAdapterCount()).toBe(2);

      clearAdapters();
      expect(getAdapterCount()).toBe(0);
      expect(listAdapters()).toEqual([]);
    });
  });

  describe("getAdapterCount", () => {
    it("should return 0 when no adapters registered", () => {
      expect(getAdapterCount()).toBe(0);
    });

    it("should return correct count", () => {
      expect(getAdapterCount()).toBe(0);

      registerAdapter(createMockAdapter("adapter-1"));
      expect(getAdapterCount()).toBe(1);

      registerAdapter(createMockAdapter("adapter-2"));
      expect(getAdapterCount()).toBe(2);

      registerAdapter(createMockAdapter("adapter-3"));
      expect(getAdapterCount()).toBe(3);
    });
  });

  describe("Adapter naming convention", () => {
    it("should follow {runner}-{format} convention", () => {
      const validNames = ["vitest-json", "jest-json", "junit-xml", "node-tap", "pytest-json"];

      validNames.forEach((name) => {
        const adapter = createMockAdapter(name);
        registerAdapter(adapter);
        expect(getAdapter(name)).toBe(adapter);
      });
    });
  });

  describe("Integration scenarios", () => {
    it("should support registration → detection workflow", () => {
      const vitestAdapter = createMockAdapter("vitest-json", [".json"], '"vitest"');
      const jestAdapter = createMockAdapter("jest-json", [".json"], '"jest"');

      registerAdapter(vitestAdapter);
      registerAdapter(jestAdapter);

      const vitestContent = '{"vitest": {"version": "1.0.0"}}';
      const jestContent = '{"jest": {"version": "29.0.0"}}';

      expect(detectAdapter(vitestContent)).toBe(vitestAdapter);
      expect(detectAdapter(jestContent)).toBe(jestAdapter);
    });

    it("should support name lookup → parse workflow", () => {
      const adapter = createMockAdapter("vitest-json");
      registerAdapter(adapter);

      const retrieved = requireAdapter("vitest-json");
      expect(retrieved).toBe(adapter);

      const result = retrieved.parse('{"test": "data"}');
      expect(result.adapter.name).toBe("vitest-json");
    });

    it("should support auto-detect → parse workflow", () => {
      const adapter = createMockAdapter("vitest-json", [".json"], "vitest");
      registerAdapter(adapter);

      const content = '{"vitest": true, "results": []}';
      const detected = requireDetectedAdapter(content);

      const result = detected.parse(content);
      expect(result.adapter.name).toBe("vitest-json");
    });
  });
});
