/**
 * Symbol map generation for minimal context packaging
 * Extracts function/class/interface names and locations from TypeScript/JavaScript files
 */

import * as parser from "@babel/parser";
import _traverse, { NodePath } from "@babel/traverse";
import type {
  Node,
  FunctionDeclaration,
  ClassDeclaration,
  TSInterfaceDeclaration,
  TSTypeAliasDeclaration,
  VariableDeclaration,
  ImportDeclaration,
} from "@babel/types";

// Handle ESM/CJS interop for babel traverse
const traverse = (_traverse as any).default || _traverse;

export interface SymbolLocation {
  /** Line number where symbol is defined */
  line: number;
  /** Column number */
  column: number;
  /** End line number */
  endLine?: number;
  /** End column */
  endColumn?: number;
}

export interface Symbol {
  /** Symbol name */
  name: string;
  /** Symbol type: function, class, interface, type, const, let, var, import, export */
  type: "function" | "class" | "interface" | "type" | "const" | "let" | "var" | "import" | "export";
  /** Location in file */
  location: SymbolLocation;
  /** Is exported? */
  exported: boolean;
  /** Parent symbol (for class methods, nested functions) */
  parent?: string;
  /** JSDoc summary if available */
  docComment?: string;
}

export interface FileSymbolMap {
  /** File path */
  path: string;
  /** Symbols in this file */
  symbols: Symbol[];
  /** Total lines in file */
  totalLines: number;
  /** Imports from this file */
  imports: string[];
  /** Exports from this file */
  exports: string[];
}

export interface SymbolMapContext {
  /** Symbol maps by file */
  files: FileSymbolMap[];
  /** Total number of symbols */
  symbolCount: number;
  /** Total size of symbol map in JSON */
  mapSize: number;
}

/**
 * Extract symbols from TypeScript/JavaScript source code
 */
export function extractSymbolMap(filePath: string, sourceCode: string): FileSymbolMap {
  const symbols: Symbol[] = [];
  const imports: string[] = [];
  const exports: string[] = [];

  try {
    // Parse with TypeScript support
    const ast = parser.parse(sourceCode, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
    });

    const totalLines = sourceCode.split("\n").length;

    // Traverse AST and extract symbols
    traverse(ast, {
      // Function declarations
      FunctionDeclaration(path: NodePath<FunctionDeclaration>) {
        const node = path.node;
        if (node.id && node.loc) {
          const isExported =
            path.parent.type === "ExportNamedDeclaration" ||
            path.parent.type === "ExportDefaultDeclaration";

          symbols.push({
            name: node.id.name,
            type: "function",
            location: {
              line: node.loc.start.line,
              column: node.loc.start.column,
              endLine: node.loc.end.line,
              endColumn: node.loc.end.column,
            },
            exported: isExported,
            docComment: extractLeadingComment(path.node, sourceCode),
          });

          if (isExported) {
            exports.push(node.id.name);
          }
        }
      },

      // Class declarations
      ClassDeclaration(path: NodePath<ClassDeclaration>) {
        const node = path.node;
        if (node.id && node.loc) {
          const isExported =
            path.parent.type === "ExportNamedDeclaration" ||
            path.parent.type === "ExportDefaultDeclaration";

          symbols.push({
            name: node.id.name,
            type: "class",
            location: {
              line: node.loc.start.line,
              column: node.loc.start.column,
              endLine: node.loc.end.line,
              endColumn: node.loc.end.column,
            },
            exported: isExported,
            docComment: extractLeadingComment(path.node, sourceCode),
          });

          if (isExported) {
            exports.push(node.id.name);
          }

          // Extract class methods
          for (const method of node.body.body) {
            if (method.type === "ClassMethod" && method.key.type === "Identifier" && method.loc) {
              symbols.push({
                name: method.key.name,
                type: "function",
                location: {
                  line: method.loc.start.line,
                  column: method.loc.start.column,
                  endLine: method.loc.end.line,
                  endColumn: method.loc.end.column,
                },
                exported: false,
                parent: node.id!.name,
              });
            }
          }
        }
      },

      // TypeScript interfaces
      TSInterfaceDeclaration(path: NodePath<TSInterfaceDeclaration>) {
        const node = path.node;
        if (node.id && node.loc) {
          const isExported = path.parent.type === "ExportNamedDeclaration";

          symbols.push({
            name: node.id.name,
            type: "interface",
            location: {
              line: node.loc.start.line,
              column: node.loc.start.column,
              endLine: node.loc.end.line,
              endColumn: node.loc.end.column,
            },
            exported: isExported,
            docComment: extractLeadingComment(path.node, sourceCode),
          });

          if (isExported) {
            exports.push(node.id.name);
          }
        }
      },

      // TypeScript type aliases
      TSTypeAliasDeclaration(path: NodePath<TSTypeAliasDeclaration>) {
        const node = path.node;
        if (node.id && node.loc) {
          const isExported = path.parent.type === "ExportNamedDeclaration";

          symbols.push({
            name: node.id.name,
            type: "type",
            location: {
              line: node.loc.start.line,
              column: node.loc.start.column,
              endLine: node.loc.end.line,
              endColumn: node.loc.end.column,
            },
            exported: isExported,
            docComment: extractLeadingComment(path.node, sourceCode),
          });

          if (isExported) {
            exports.push(node.id.name);
          }
        }
      },

      // Variable declarations (const, let, var)
      VariableDeclaration(path: NodePath<VariableDeclaration>) {
        const node = path.node;
        const isExported = path.parent.type === "ExportNamedDeclaration";

        for (const declarator of node.declarations) {
          if (declarator.id.type === "Identifier" && declarator.loc) {
            symbols.push({
              name: declarator.id.name,
              type: node.kind as "const" | "let" | "var",
              location: {
                line: declarator.loc.start.line,
                column: declarator.loc.start.column,
                endLine: declarator.loc.end.line,
                endColumn: declarator.loc.end.column,
              },
              exported: isExported,
            });

            if (isExported) {
              exports.push(declarator.id.name);
            }
          }
        }
      },

      // Import declarations
      ImportDeclaration(path: NodePath<ImportDeclaration>) {
        const node = path.node;
        const source = node.source.value;

        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportDefaultSpecifier") {
            imports.push(`default from ${source}`);
          } else if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.type === "Identifier"
          ) {
            imports.push(`${specifier.imported.name} from ${source}`);
          } else if (specifier.type === "ImportNamespaceSpecifier") {
            imports.push(`* as ${specifier.local.name} from ${source}`);
          }
        }
      },
    });

    // Sort symbols by line number for deterministic output
    symbols.sort((a, b) => a.location.line - b.location.line);

    return {
      path: filePath,
      symbols,
      totalLines,
      imports: [...new Set(imports)].sort(),
      exports: [...new Set(exports)].sort(),
    };
  } catch (error) {
    // Return empty symbol map if parsing fails
    return {
      path: filePath,
      symbols: [],
      totalLines: sourceCode.split("\n").length,
      imports: [],
      exports: [],
    };
  }
}

/**
 * Extract leading JSDoc comment from a node
 */
function extractLeadingComment(node: Node, sourceCode: string): string | undefined {
  if (!node.leadingComments || node.leadingComments.length === 0) {
    return undefined;
  }

  const lastComment = node.leadingComments[node.leadingComments.length - 1];
  if (lastComment.type === "CommentBlock" && lastComment.value.startsWith("*")) {
    // Extract first line of JSDoc (summary)
    const lines = lastComment.value.split("\n");
    const summary = lines
      .find((line) => line.trim() && !line.trim().startsWith("*") && !line.trim().startsWith("@"))
      ?.trim()
      .replace(/^\*\s*/, "");
    return summary;
  }

  return undefined;
}

/**
 * Build symbol maps for multiple files
 */
export function buildSymbolMaps(files: Array<{ path: string; content: string }>): SymbolMapContext {
  const symbolMaps = files
    .filter((file) => /\.(ts|tsx|js|jsx)$/.test(file.path))
    .map((file) => extractSymbolMap(file.path, file.content));

  const symbolCount = symbolMaps.reduce((sum, map) => sum + map.symbols.length, 0);
  const mapSize = JSON.stringify(symbolMaps).length;

  return {
    files: symbolMaps,
    symbolCount,
    mapSize,
  };
}

/**
 * Format symbol map as compact text for AI consumption
 */
export function formatSymbolMap(symbolMap: FileSymbolMap): string {
  const lines: string[] = [];

  lines.push(`# ${symbolMap.path} (${symbolMap.totalLines} lines)`);

  if (symbolMap.imports.length > 0) {
    lines.push("\n## Imports");
    for (const imp of symbolMap.imports) {
      lines.push(`- ${imp}`);
    }
  }

  if (symbolMap.exports.length > 0) {
    lines.push("\n## Exports");
    for (const exp of symbolMap.exports) {
      lines.push(`- ${exp}`);
    }
  }

  if (symbolMap.symbols.length > 0) {
    lines.push("\n## Symbols");
    for (const symbol of symbolMap.symbols) {
      const prefix = symbol.exported ? "export " : "";
      const parent = symbol.parent ? `${symbol.parent}.` : "";
      const doc = symbol.docComment ? ` // ${symbol.docComment}` : "";
      lines.push(
        `- L${symbol.location.line}: ${prefix}${symbol.type} ${parent}${symbol.name}${doc}`
      );
    }
  }

  return lines.join("\n");
}

/**
 * Format all symbol maps as compact text
 */
export function formatSymbolMaps(context: SymbolMapContext): string {
  const parts: string[] = [];

  parts.push(`# Symbol Maps (${context.files.length} files, ${context.symbolCount} symbols)`);
  parts.push("");

  for (const fileMap of context.files) {
    parts.push(formatSymbolMap(fileMap));
    parts.push("");
  }

  return parts.join("\n");
}
