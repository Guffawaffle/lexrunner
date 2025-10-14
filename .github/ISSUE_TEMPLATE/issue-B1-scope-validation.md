---
name: Static Scope Validation for Agent Edits
about: Add static analysis to validate agent edit scope before execution
title: '[planner] Add static analysis to validate agent edit scope before execution'
labels: ['agent-safety', 'planner', 'security', 'P0']
assignees: ''
---

## Problem Statement

**CRITICAL SAFETY ISSUE:** Agents can currently modify global variables, touch unrelated code, or introduce cross-module side effects without detection. This violates the hermetic edit contract and can cause subtle runtime bugs, especially in legacy codebases with AMD/UMD modules.

For agent-driven development to be safe, we need **pre-edit scope validation** that ensures agents only modify what they declare they're modifying.

## Current State

- `src/planner/fileAnalysis.ts` does heuristic import/export parsing (regex-based)
- No enforcement that agent edits stay within declared scope
- No detection of global variable writes
- No validation that function/class modifications are intentional
- Agents can accidentally introduce side effects

**Example vulnerability:**
```javascript
// File: src/legacy/paymentProcessor.js (AMD module)
define(['dep'], function(dep) {
  window.DEBUG_MODE = true;  // ❌ GLOBAL SIDE EFFECT - not detected

  function processPayment(amount) {  // Agent intended to edit this
    return amount * 1.1;
  }

  function auditLog(msg) {  // Agent accidentally modified this too
    console.log('AUDIT:', msg);
  }

  return { processPayment, auditLog };
});
```

**Agent declares:** "I'm editing `processPayment` function"
**Agent actually does:** Modifies `processPayment`, `auditLog`, AND sets global `window.DEBUG_MODE`
**Current behavior:** No validation, changes are applied
**Needed behavior:** Validation fails, agent is blocked

## Proposed Solution

### Architecture: Edit Plan + Validator

**Flow:**
1. Agent declares intended edits in **Edit Plan** (JSON manifest)
2. **Scope Validator** parses file via AST (Babel/TypeScript)
3. Validator detects: globals written, functions/classes modified, side effects
4. If actual scope ≠ declared scope → **fail fast** with actionable error
5. If validation passes → proceed with edit

### 1. Create Edit Plan Schema
**Location:** `schemas/edit-plan.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://github.com/Guffawaffle/lex-pr-runner/schemas/edit-plan.schema.json",
  "title": "Edit Plan Schema",
  "description": "Declares intended scope of code edits for validation",
  "type": "object",
  "required": ["file", "module_system", "scope_validated"],
  "properties": {
    "file": {
      "type": "string",
      "description": "Absolute or relative path to file being edited"
    },
    "module_system": {
      "type": "string",
      "enum": ["esm", "commonjs", "amd", "umd", "iife", "unknown"],
      "description": "Module system detected in file"
    },
    "functions_modified": {
      "type": "array",
      "items": {"type": "string"},
      "default": [],
      "description": "List of function names being modified"
    },
    "classes_modified": {
      "type": "array",
      "items": {"type": "string"},
      "default": [],
      "description": "List of class names being modified"
    },
    "variables_modified": {
      "type": "array",
      "items": {"type": "string"},
      "default": [],
      "description": "List of module-level variables being modified"
    },
    "side_effects": {
      "type": "string",
      "enum": ["none", "module", "global"],
      "default": "none",
      "description": "Level of side effects: none (pure), module (module-scoped), global (window/global)"
    },
    "globals_written": {
      "type": "array",
      "items": {"type": "string"},
      "default": [],
      "description": "List of global variables being written (window.*, global.*)"
    },
    "scope_validated": {
      "type": "boolean",
      "description": "Whether scope validation passed"
    },
    "validation_method": {
      "type": "string",
      "enum": ["babel-ast", "typescript-ast", "python-ast", "regex-fallback"],
      "description": "AST parser used for validation"
    },
    "violations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["type", "message", "location"],
        "properties": {
          "type": {"type": "string", "enum": ["undeclared_function", "undeclared_class", "global_write", "side_effect"]},
          "message": {"type": "string"},
          "location": {"type": "object", "properties": {"line": {"type": "number"}, "column": {"type": "number"}}}
        }
      },
      "description": "List of scope violations detected"
    }
  }
}
```

### 2. Implement Scope Validator (JavaScript/TypeScript)
**Location:** `src/planner/scopeValidator.ts` (new file)

```typescript
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as fs from 'fs';
import * as path from 'path';

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
  } else if (ext === '.js' || ext === '.jsx' || ext === '.mjs') {
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
    // Detect module system
    ImportDeclaration() {
      moduleSystem = 'esm';
    },
    CallExpression(path) {
      if (path.node.callee.type === 'Identifier' && path.node.callee.name === 'require') {
        moduleSystem = 'commonjs';
      }
      if (path.node.callee.type === 'Identifier' && path.node.callee.name === 'define') {
        moduleSystem = 'amd';
      }
    },

    // Detect function declarations/modifications
    FunctionDeclaration(path) {
      if (path.node.id?.name) {
        functionsModified.push(path.node.id.name);
      }
    },

    // Detect class declarations
    ClassDeclaration(path) {
      if (path.node.id?.name) {
        classesModified.push(path.node.id.name);
      }
    },

    // Detect global writes (window.*, global.*)
    MemberExpression(path) {
      if (path.node.object.type === 'Identifier' &&
          (path.node.object.name === 'window' || path.node.object.name === 'global')) {
        if (path.parent.type === 'AssignmentExpression' && path.parent.left === path.node) {
          const propName = path.node.property.type === 'Identifier'
            ? path.node.property.name
            : '<computed>';
          globalsWritten.push(`${path.node.object.name}.${propName}`);
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
  // Similar to validateJavaScriptFile but with TypeScript parser
  // Use @typescript-eslint/parser or babel with typescript plugin
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx']
  });

  // Same traversal logic as JavaScript
  return validateJavaScriptFile(filePath, code, declaredPlan);
}
```

### 3. Create Scope Policy Files
**Location:** `.smartergpt/scope-policies/default.json`

```json
{
  "allow_global_writes": false,
  "allow_undeclared_edits": false,
  "strict_mode": true,
  "exceptions": {
    "test_files": {
      "pattern": "**/*.spec.ts",
      "allow_global_writes": true,
      "reason": "Test files can mock globals"
    },
    "config_files": {
      "pattern": "**/*.config.{js,ts}",
      "allow_side_effects": true,
      "reason": "Config files execute at load time"
    }
  }
}
```

### 4. Integration with Planner
**Location:** `src/planner/fileAnalysis.ts` (modify existing)

```typescript
import { validateEditScope, type EditPlan } from './scopeValidator';

export async function analyzeFileEdit(filePath: string, declaredPlan: Partial<EditPlan>): Promise<EditPlan> {
  // Existing heuristic analysis...

  // NEW: Scope validation
  const validatedPlan = await validateEditScope(filePath, declaredPlan);
  return validatedPlan;
}
```

## Acceptance Criteria

- [ ] Scope validators implemented for JavaScript (Babel AST) and TypeScript (TS AST)
- [ ] Edit plan schema defined with all required fields
- [ ] Pre-edit validation detects:
  - [ ] Undeclared function modifications
  - [ ] Undeclared class modifications
  - [ ] Global variable writes (`window.*`, `global.*`)
  - [ ] Module-level side effects
- [ ] Validation fails fast with actionable error messages (line numbers, violation types)
- [ ] Policy files allow per-repo customization (e.g., allow globals in test files)
- [ ] AMD/UMD/CommonJS/ESM module systems detected correctly
- [ ] Tests achieve 100% coverage for critical paths (security requirement)
- [ ] Integration test: agent declares edit plan, validation passes/fails correctly
- [ ] Documentation with real-world examples of validation failures

## Success Metrics

- **Safety improvement:** 0 unintended global writes in agent-driven edits
- **False positive rate:** <5% (legitimate edits blocked incorrectly)
- **Performance:** Validation completes in <500ms for typical file (500 LOC)
- **Developer clarity:** 100% of validation errors include fix suggestions

## Priority

**P0 (Critical - Safety Blocker)** - Prevents production use due to safety risks. Agents MUST NOT be able to make unconstrained edits to production code.

## Effort Estimate

**Large** (4-5 days)
- **Day 1:** Design edit plan schema, research AST parsers (Babel, TypeScript)
- **Day 2:** Implement JavaScript/TypeScript scope validator with AST traversal
- **Day 3:** Add policy system, exception handling, integration with `fileAnalysis.ts`
- **Day 4:** Comprehensive tests (unit + integration), edge cases (AMD, UMD, IIFE)
- **Day 5:** Documentation, security review, PR review

## Dependencies

**Required packages:**
```bash
npm install --save-dev @babel/parser @babel/traverse @typescript-eslint/parser
```

**Blocked by:** None
**Blocks:** Issue B2 (Module System Compatibility) - builds on this validator

## Related Issues

- Extends `src/planner/fileAnalysis.ts` (current heuristic dependency detection)
- Related to #194 (Node.js SDK) - SDK should use this validator
- Complements Issue C1 (Command Whitelist) - both are agent safety measures

## References

**Existing code:**
- `src/planner/fileAnalysis.ts` (lines 30-150) - Import/export parsing
- `src/security/` - Security patterns to follow

**External:**
- Babel Parser: https://babeljs.io/docs/babel-parser
- Babel Traverse: https://babeljs.io/docs/babel-traverse
- TypeScript AST Viewer: https://ts-ast-viewer.com/

## Implementation Checklist

- [ ] Install AST parser dependencies: `@babel/parser`, `@babel/traverse`, `@typescript-eslint/parser`
- [ ] Create `schemas/edit-plan.schema.json`
- [ ] Implement `src/planner/scopeValidator.ts`:
  - [ ] `validateEditScope()` main function
  - [ ] `validateJavaScriptFile()` with Babel AST
  - [ ] `validateTypeScriptFile()` with TS AST
  - [ ] `ScopeValidationError` custom error class
- [ ] Create `.smartergpt/scope-policies/default.json`
- [ ] Modify `src/planner/fileAnalysis.ts` to use validator
- [ ] Write comprehensive tests in `tests/planner/scopeValidator.spec.ts`:
  - [ ] Detects undeclared function mods
  - [ ] Detects global writes (`window.DEBUG = true`)
  - [ ] Handles AMD/UMD/CommonJS/ESM correctly
  - [ ] Policy exceptions work (test files allow globals)
- [ ] Add integration test in `tests/integration/scope-validation-e2e.spec.ts`
- [ ] Create test fixtures in `tests/fixtures/scope-validation/`:
  - [ ] Valid edits (pass validation)
  - [ ] Invalid edits (fail validation)
  - [ ] AMD module with globals
  - [ ] ESM module (clean)
- [ ] Update documentation:
  - [ ] `docs/planner.md` - Add scope validation section
  - [ ] `docs/agent-safety.md` (new) - Explain safety measures
  - [ ] `AGENTS.md` - Update edit contracts
- [ ] Security review with focus on bypass scenarios
- [ ] Performance benchmark (measure AST parse time)
- [ ] Update `CHANGELOG.md`

## Migration Notes

**Breaking Changes:** None (validation is additive)

**User Impact:**
- **Agents:** Must declare edit plans before modifying files
- **Humans:** Can bypass validation for manual edits (validation only enforced in agent workflows)

**Rollout Strategy:**
1. **Phase 1 (Week 1):** Deploy with validation in "warn" mode (log violations, don't block)
2. **Phase 2 (Week 2):** Analyze logs, tune policy exceptions
3. **Phase 3 (Week 3):** Enable "block" mode (fail on violations)

**Emergency Override:**
```bash
# Disable scope validation (emergency use only)
LEX_SKIP_SCOPE_VALIDATION=1 lex-pr execute plan.json
```

---

**Labels:** `agent-safety`, `planner`, `security`, `P0`, `breaking-change` (for agent workflows)
**Milestone:** Phase 3.1: Agent Safety
**Estimated Points:** 8 (large)
**Reviewers:** Security team, infrastructure team
