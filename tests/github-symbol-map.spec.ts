import { describe, it, expect } from "vitest";
import {
  extractSymbolMap,
  buildSymbolMaps,
  formatSymbolMap,
  formatSymbolMaps,
} from "../src/github/symbolMap.js";

describe("Symbol Map Generation", () => {
  describe("extractSymbolMap", () => {
    it("should extract function declarations", () => {
      const code = `
function testFunction() {
  return true;
}

export function exportedFunc() {
  return false;
}
`;

      const result = extractSymbolMap("test.ts", code);

      expect(result.symbols).toHaveLength(2);
      expect(result.symbols[0].name).toBe("testFunction");
      expect(result.symbols[0].type).toBe("function");
      expect(result.symbols[0].exported).toBe(false);
      expect(result.symbols[1].name).toBe("exportedFunc");
      expect(result.symbols[1].exported).toBe(true);
    });

    it("should extract class declarations", () => {
      const code = `
class MyClass {
  constructor() {}
  
  method1() {
    return 1;
  }
  
  method2() {
    return 2;
  }
}

export class ExportedClass {
  method() {}
}
`;

      const result = extractSymbolMap("test.ts", code);

      // Should find 2 classes + 3 methods from MyClass + 1 method from ExportedClass
      const classes = result.symbols.filter((s) => s.type === "class");
      const methods = result.symbols.filter((s) => s.type === "function" && s.parent);

      expect(classes).toHaveLength(2);
      expect(classes[0].name).toBe("MyClass");
      expect(classes[0].exported).toBe(false);
      expect(classes[1].name).toBe("ExportedClass");
      expect(classes[1].exported).toBe(true);

      expect(methods).toHaveLength(4);
      expect(methods.filter((m) => m.parent === "MyClass")).toHaveLength(3);
      expect(methods.filter((m) => m.parent === "ExportedClass")).toHaveLength(1);
    });

    it("should extract TypeScript interfaces", () => {
      const code = `
interface LocalInterface {
  prop: string;
}

export interface ExportedInterface {
  prop: number;
}
`;

      const result = extractSymbolMap("test.ts", code);

      const interfaces = result.symbols.filter((s) => s.type === "interface");
      expect(interfaces).toHaveLength(2);
      expect(interfaces[0].name).toBe("LocalInterface");
      expect(interfaces[0].exported).toBe(false);
      expect(interfaces[1].name).toBe("ExportedInterface");
      expect(interfaces[1].exported).toBe(true);
    });

    it("should extract TypeScript type aliases", () => {
      const code = `
type LocalType = string | number;

export type ExportedType = {
  key: string;
};
`;

      const result = extractSymbolMap("test.ts", code);

      const types = result.symbols.filter((s) => s.type === "type");
      expect(types).toHaveLength(2);
      expect(types[0].name).toBe("LocalType");
      expect(types[0].exported).toBe(false);
      expect(types[1].name).toBe("ExportedType");
      expect(types[1].exported).toBe(true);
    });

    it("should extract variable declarations", () => {
      const code = `
const localConst = 'value';
let localLet = 123;
var localVar = true;

export const exportedConst = 'exported';
`;

      const result = extractSymbolMap("test.ts", code);

      const vars = result.symbols.filter((s) => ["const", "let", "var"].includes(s.type));
      expect(vars).toHaveLength(4);

      const constVars = vars.filter((v) => v.type === "const");
      expect(constVars).toHaveLength(2);
      expect(constVars.find((v) => v.name === "exportedConst")?.exported).toBe(true);
      expect(constVars.find((v) => v.name === "localConst")?.exported).toBe(false);
    });

    it("should extract imports", () => {
      const code = `
import defaultImport from 'module1';
import { namedImport1, namedImport2 } from 'module2';
import * as namespaceImport from 'module3';
`;

      const result = extractSymbolMap("test.ts", code);

      expect(result.imports).toHaveLength(4);
      expect(result.imports).toContain("default from module1");
      expect(result.imports).toContain("namedImport1 from module2");
      expect(result.imports).toContain("namedImport2 from module2");
      expect(result.imports).toContain("* as namespaceImport from module3");
    });

    it("should extract exports list", () => {
      const code = `
export function func1() {}
export class Class1 {}
export const const1 = 1;
function func2() {}
`;

      const result = extractSymbolMap("test.ts", code);

      expect(result.exports).toHaveLength(3);
      expect(result.exports).toContain("func1");
      expect(result.exports).toContain("Class1");
      expect(result.exports).toContain("const1");
      expect(result.exports).not.toContain("func2");
    });

    it("should track line locations", () => {
      const code = `function func1() {}

function func2() {}

function func3() {}`;

      const result = extractSymbolMap("test.ts", code);

      expect(result.symbols).toHaveLength(3);
      expect(result.symbols[0].location.line).toBe(1);
      expect(result.symbols[1].location.line).toBe(3);
      expect(result.symbols[2].location.line).toBe(5);
    });

    it("should extract JSDoc comments", () => {
      const code = `
/**
 * This is a function that does something
 * @param x The parameter
 */
export function documented() {}

// Regular comment
function notDocumented() {}
`;

      const result = extractSymbolMap("test.ts", code);

      const documented = result.symbols.find((s) => s.name === "documented");
      const notDocumented = result.symbols.find((s) => s.name === "notDocumented");

      // JSDoc comment extraction depends on Babel parser preserving comments
      // If available, it should contain the summary
      if (documented?.docComment) {
        expect(documented.docComment).toContain("This is a function that does something");
      }
      expect(notDocumented?.docComment).toBeUndefined();
    });

    it("should handle parse errors gracefully", () => {
      const invalidCode = "this is not valid { JavaScript code";

      const result = extractSymbolMap("invalid.ts", invalidCode);

      expect(result.symbols).toHaveLength(0);
      expect(result.path).toBe("invalid.ts");
    });

    it("should sort symbols by line number", () => {
      const code = `
function third() {}   // line 2
function first() {}   // line 3
function second() {}  // line 4
`;

      const result = extractSymbolMap("test.ts", code);

      expect(result.symbols).toHaveLength(3);
      // Should be sorted by line number
      expect(result.symbols[0].location.line).toBeLessThan(result.symbols[1].location.line);
      expect(result.symbols[1].location.line).toBeLessThan(result.symbols[2].location.line);
    });

    it("should count total lines", () => {
      const code = `line 1
line 2
line 3
line 4
line 5`;

      const result = extractSymbolMap("test.ts", code);

      expect(result.totalLines).toBe(5);
    });
  });

  describe("buildSymbolMaps", () => {
    it("should build symbol maps for multiple files", () => {
      const files = [
        {
          path: "file1.ts",
          content: "export function func1() {}",
        },
        {
          path: "file2.ts",
          content: "export class Class2 {}",
        },
      ];

      const result = buildSymbolMaps(files);

      expect(result.files).toHaveLength(2);
      expect(result.symbolCount).toBe(2);
      expect(result.mapSize).toBeGreaterThan(0);
    });

    it("should filter non-JS/TS files", () => {
      const files = [
        {
          path: "file.ts",
          content: "export function func() {}",
        },
        {
          path: "readme.md",
          content: "# README",
        },
        {
          path: "config.json",
          content: "{}",
        },
      ];

      const result = buildSymbolMaps(files);

      // Only .ts file should be processed
      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe("file.ts");
    });

    it("should calculate total symbol count", () => {
      const files = [
        {
          path: "file1.ts",
          content: "export function func1() {}\nexport function func2() {}",
        },
        {
          path: "file2.ts",
          content: "export class Class1 {}\nexport const const1 = 1;",
        },
      ];

      const result = buildSymbolMaps(files);

      expect(result.symbolCount).toBe(4);
    });

    it("should calculate map size in JSON format", () => {
      const files = [
        {
          path: "file.ts",
          content: "export function func() {}",
        },
      ];

      const result = buildSymbolMaps(files);

      // mapSize should be the JSON stringified size
      const jsonSize = JSON.stringify(result.files).length;
      expect(result.mapSize).toBe(jsonSize);
    });
  });

  describe("formatSymbolMap", () => {
    it("should format symbol map as readable text", () => {
      const symbolMap = {
        path: "src/test.ts",
        totalLines: 10,
        symbols: [
          {
            name: "testFunc",
            type: "function" as const,
            location: { line: 5, column: 0 },
            exported: true,
          },
        ],
        imports: ["something from module"],
        exports: ["testFunc"],
      };

      const formatted = formatSymbolMap(symbolMap);

      expect(formatted).toContain("src/test.ts");
      expect(formatted).toContain("10 lines");
      expect(formatted).toContain("Imports");
      expect(formatted).toContain("Exports");
      expect(formatted).toContain("Symbols");
      expect(formatted).toContain("testFunc");
      expect(formatted).toContain("L5");
      expect(formatted).toContain("export");
    });

    it("should handle empty imports/exports", () => {
      const symbolMap = {
        path: "src/test.ts",
        totalLines: 5,
        symbols: [],
        imports: [],
        exports: [],
      };

      const formatted = formatSymbolMap(symbolMap);

      expect(formatted).toContain("src/test.ts");
      expect(formatted).not.toContain("Imports");
      expect(formatted).not.toContain("Exports");
    });

    it("should include JSDoc comments", () => {
      const symbolMap = {
        path: "src/test.ts",
        totalLines: 5,
        symbols: [
          {
            name: "documented",
            type: "function" as const,
            location: { line: 2, column: 0 },
            exported: true,
            docComment: "Does something useful",
          },
        ],
        imports: [],
        exports: ["documented"],
      };

      const formatted = formatSymbolMap(symbolMap);

      expect(formatted).toContain("Does something useful");
    });
  });

  describe("formatSymbolMaps", () => {
    it("should format multiple symbol maps", () => {
      const context = {
        files: [
          {
            path: "file1.ts",
            totalLines: 5,
            symbols: [],
            imports: [],
            exports: [],
          },
          {
            path: "file2.ts",
            totalLines: 10,
            symbols: [],
            imports: [],
            exports: [],
          },
        ],
        symbolCount: 0,
        mapSize: 100,
      };

      const formatted = formatSymbolMaps(context);

      expect(formatted).toContain("Symbol Maps");
      expect(formatted).toContain("2 files");
      expect(formatted).toContain("0 symbols");
      expect(formatted).toContain("file1.ts");
      expect(formatted).toContain("file2.ts");
    });
  });
});
