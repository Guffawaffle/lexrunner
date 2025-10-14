/**
 * Scope Validator - Static analysis for agent edit scope validation
 * Ensures agents only modify what they declare they're modifying
 */

import { parse } from '@babel/parser';
import babelTraverse, { type NodePath } from '@babel/traverse';
import type * as t from '@babel/types';
import * as fs from 'fs';
import * as path from 'path';

// Handle both ESM and CommonJS imports of babel/traverse
const traverse = (babelTraverse as any).default || babelTraverse;

export interface EditPlan {
  file: string;
  module_system: 'esm' | 'commonjs' | 'amd' | 'umd' | 'iife' | 'unknown';
  functions_modified?: string[];
  classes_modified?: string[];
  variables_modified?: string[];
  side_effects?: 'none' | 'module' | 'global';
  globals_written?: string[];
  scope_validated: boolean;
  validation_method: 'babel-ast' | 'typescript-ast' | 'python-ast' | 'regex-fallback';
  violations?: Array<{
    type: 'undeclared_function' | 'undeclared_class' | 'global_write' | 'side_effect';
    message: string;
    location: { line: number; column: number };
  }>;
}

export class ScopeValidationError extends Error {
  public readonly violations: EditPlan['violations'];

  constructor(file: string, violations: EditPlan['violations']) {
    const summary = violations?.map(v => `  - ${v.type}: ${v.message} (line ${v.location.line})`).join('\n');
    super(`Scope validation failed for ${file}:\n${summary}`);
    this.name = 'ScopeValidationError';
    this.violations = violations;
  }
}

/**
 * Validates that code edits match declared scope
 */
export async function validateEditScope(
  filePath: string,
  declaredPlan: Partial<EditPlan>
): Promise<EditPlan> {
  const code = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath);

  let actualPlan: EditPlan;

  if (ext === '.ts' || ext === '.tsx') {
    actualPlan = await validateTypeScriptFile(filePath, code, declaredPlan);
  } else if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') {
    actualPlan = await validateJavaScriptFile(filePath, code, declaredPlan);
  } else {
    throw new Error(`Unsupported file type for scope validation: ${ext}`);
  }

  // Compare declared vs. actual
  const violations: EditPlan['violations'] = [];

  // Check for undeclared function modifications
  const actualFunctions = new Set(actualPlan.functions_modified ?? []);
  const declaredFunctions = new Set(declaredPlan.functions_modified ?? []);
  for (const fn of actualFunctions) {
    if (!declaredFunctions.has(fn)) {
      violations.push({
        type: 'undeclared_function',
        message: `Function '${fn}' modified but not declared in edit plan`,
        location: { line: 0, column: 0 } // TODO: Extract from AST
      });
    }
  }

  // Check for undeclared class modifications
  const actualClasses = new Set(actualPlan.classes_modified ?? []);
  const declaredClasses = new Set(declaredPlan.classes_modified ?? []);
  for (const cls of actualClasses) {
    if (!declaredClasses.has(cls)) {
      violations.push({
        type: 'undeclared_class',
        message: `Class '${cls}' modified but not declared in edit plan`,
        location: { line: 0, column: 0 }
      });
    }
  }

  // Check for undeclared global writes
  const actualGlobals = new Set(actualPlan.globals_written ?? []);
  const declaredGlobals = new Set(declaredPlan.globals_written ?? []);
  for (const global of actualGlobals) {
    if (!declaredGlobals.has(global)) {
      violations.push({
        type: 'global_write',
        message: `Global variable '${global}' written but not declared in edit plan`,
        location: { line: 0, column: 0 }
      });
    }
  }

  // Check for undeclared side effects
  if (actualPlan.side_effects !== 'none' && declaredPlan.side_effects === 'none') {
    violations.push({
      type: 'side_effect',
      message: `Side effects detected (${actualPlan.side_effects}) but plan declared 'none'`,
      location: { line: 0, column: 0 }
    });
  }

  actualPlan.violations = violations;
  actualPlan.scope_validated = violations.length === 0;

  if (!actualPlan.scope_validated) {
    throw new ScopeValidationError(filePath, violations);
  }

  return actualPlan;
}

async function validateJavaScriptFile(
  filePath: string,
  code: string,
  declaredPlan: Partial<EditPlan>
): Promise<EditPlan> {
  const ast = parse(code, {
    sourceType: 'unambiguous',
    plugins: ['jsx', 'dynamicImport', 'exportDefaultFrom']
  });

  const functionsModified: string[] = [];
  const classesModified: string[] = [];
  const globalsWritten: string[] = [];
  let moduleSystem: EditPlan['module_system'] = 'unknown';
  let sideEffects: EditPlan['side_effects'] = 'none';

  traverse(ast, {
    // Detect module system - ESM takes precedence
    ImportDeclaration() {
      moduleSystem = 'esm';
    },
    ExportNamedDeclaration() {
      if (moduleSystem === 'unknown') moduleSystem = 'esm';
    },
    ExportDefaultDeclaration() {
      if (moduleSystem === 'unknown') moduleSystem = 'esm';
    },
    CallExpression(path: NodePath<t.CallExpression>) {
      const callee = path.node.callee;
      if (callee.type === 'Identifier') {
        if (callee.name === 'require' && moduleSystem === 'unknown') {
          moduleSystem = 'commonjs';
        }
        if (callee.name === 'define' && moduleSystem === 'unknown') {
          moduleSystem = 'amd';
        }
      }
    },

    // Detect function declarations/modifications
    FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
      if (path.node.id?.name) {
        functionsModified.push(path.node.id.name);
      }
    },

    // Detect class declarations
    ClassDeclaration(path: NodePath<t.ClassDeclaration>) {
      if (path.node.id?.name) {
        classesModified.push(path.node.id.name);
      }
    },

    // Detect global writes (window.*, global.*)
    MemberExpression(path: NodePath<t.MemberExpression>) {
      const obj = path.node.object;
      if (obj.type === 'Identifier' && (obj.name === 'window' || obj.name === 'global')) {
        const parent = path.parent;
        if (parent.type === 'AssignmentExpression' && parent.left === path.node) {
          const prop = path.node.property;
          const propName = prop.type === 'Identifier' ? prop.name : '<computed>';
          globalsWritten.push(`${obj.name}.${propName}`);
          sideEffects = 'global';
        }
      }
    }
  });

  return {
    file: filePath,
    module_system: moduleSystem,
    functions_modified: functionsModified,
    classes_modified: classesModified,
    globals_written: globalsWritten,
    side_effects: sideEffects,
    scope_validated: false, // Will be set by validateEditScope
    validation_method: 'babel-ast'
  };
}

async function validateTypeScriptFile(
  filePath: string,
  code: string,
  declaredPlan: Partial<EditPlan>
): Promise<EditPlan> {
  // Use Babel parser with TypeScript plugin
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx']
  });

  const functionsModified: string[] = [];
  const classesModified: string[] = [];
  const globalsWritten: string[] = [];
  let moduleSystem: EditPlan['module_system'] = 'unknown';
  let sideEffects: EditPlan['side_effects'] = 'none';

  traverse(ast, {
    // Detect module system - ESM takes precedence
    ImportDeclaration() {
      moduleSystem = 'esm';
    },
    ExportNamedDeclaration() {
      if (moduleSystem === 'unknown') moduleSystem = 'esm';
    },
    ExportDefaultDeclaration() {
      if (moduleSystem === 'unknown') moduleSystem = 'esm';
    },
    CallExpression(path: NodePath<t.CallExpression>) {
      const callee = path.node.callee;
      if (callee.type === 'Identifier') {
        if (callee.name === 'require' && moduleSystem === 'unknown') {
          moduleSystem = 'commonjs';
        }
        if (callee.name === 'define' && moduleSystem === 'unknown') {
          moduleSystem = 'amd';
        }
      }
    },

    // Detect function declarations/modifications
    FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
      if (path.node.id?.name) {
        functionsModified.push(path.node.id.name);
      }
    },

    // Detect class declarations
    ClassDeclaration(path: NodePath<t.ClassDeclaration>) {
      if (path.node.id?.name) {
        classesModified.push(path.node.id.name);
      }
    },

    // Detect global writes (window.*, global.*)
    MemberExpression(path: NodePath<t.MemberExpression>) {
      const obj = path.node.object;
      if (obj.type === 'Identifier' && (obj.name === 'window' || obj.name === 'global')) {
        const parent = path.parent;
        if (parent.type === 'AssignmentExpression' && parent.left === path.node) {
          const prop = path.node.property;
          const propName = prop.type === 'Identifier' ? prop.name : '<computed>';
          globalsWritten.push(`${obj.name}.${propName}`);
          sideEffects = 'global';
        }
      }
    }
  });

  return {
    file: filePath,
    module_system: moduleSystem,
    functions_modified: functionsModified,
    classes_modified: classesModified,
    globals_written: globalsWritten,
    side_effects: sideEffects,
    scope_validated: false, // Will be set by validateEditScope
    validation_method: 'babel-ast'
  };
}

/**
 * Analyze a file to extract its scope information without validation
 * Useful for generating edit plans
 */
export async function analyzeFileScope(filePath: string): Promise<Omit<EditPlan, 'scope_validated' | 'violations'>> {
  const code = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath);

  if (ext === '.ts' || ext === '.tsx') {
    const result = await validateTypeScriptFile(filePath, code, {});
    const { scope_validated, violations, ...rest } = result;
    return rest;
  } else if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') {
    const result = await validateJavaScriptFile(filePath, code, {});
    const { scope_validated, violations, ...rest } = result;
    return rest;
  } else {
    throw new Error(`Unsupported file type for scope analysis: ${ext}`);
  }
}
