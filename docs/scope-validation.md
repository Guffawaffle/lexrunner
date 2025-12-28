# Scope Validation for Agent Edits

## Overview

The scope validator provides **static analysis** to ensure agents only modify what they declare they're modifying. This is critical for agent-driven development safety, preventing unintended global writes, cross-module side effects, and accidental code modifications.

## Problem Statement

Agents can currently modify global variables, touch unrelated code, or introduce cross-module side effects without detection. This violates the hermetic edit contract and can cause subtle runtime bugs, especially in legacy codebases with AMD/UMD modules.

**Example vulnerability:**

```javascript
// File: src/legacy/paymentProcessor.js (AMD module)
define(["dep"], function (dep) {
  window.DEBUG_MODE = true; // ❌ GLOBAL SIDE EFFECT - not detected

  function processPayment(amount) {
    // Agent intended to edit this
    return amount * 1.1;
  }

  function auditLog(msg) {
    // Agent accidentally modified this too
    console.log("AUDIT:", msg);
  }

  return { processPayment, auditLog };
});
```

**Agent declares:** "I'm editing `processPayment` function"  
**Agent actually does:** Modifies `processPayment`, `auditLog`, AND sets global `window.DEBUG_MODE`  
**Current behavior:** No validation, changes are applied  
**Needed behavior:** Validation fails, agent is blocked

## Solution: Edit Plan + Validator

### Architecture Flow

1. **Agent declares intended edits** in Edit Plan (JSON manifest)
2. **Scope Validator** parses file via AST (Babel)
3. **Validator detects:** globals written, functions/classes modified, side effects
4. **If actual scope ≠ declared scope** → fail fast with actionable error
5. **If validation passes** → proceed with edit

## Usage

### Basic Analysis

Analyze a file to extract its scope information:

```typescript
import { analyzeFileScope } from "./planner/scopeValidator.js";

const scope = await analyzeFileScope("/path/to/file.ts");

console.log(scope);
// {
//   file: '/path/to/file.ts',
//   module_system: 'esm',
//   functions_modified: ['myFunction', 'anotherFunction'],
//   classes_modified: ['MyClass'],
//   globals_written: [],
//   side_effects: 'none',
//   validation_method: 'babel-ast'
// }
```

### Validation

Validate that actual modifications match declared intent:

```typescript
import { validateEditScope, ScopeValidationError } from "./planner/scopeValidator.js";

const declaredPlan = {
  functions_modified: ["processPayment"],
  classes_modified: [],
  side_effects: "none",
  globals_written: [],
};

try {
  const result = await validateEditScope("/path/to/file.js", declaredPlan);
  console.log("✅ Validation passed");
} catch (error) {
  if (error instanceof ScopeValidationError) {
    console.error("❌ Scope violations detected:");
    error.violations?.forEach((v) => {
      console.error(`  - ${v.type}: ${v.message} (line ${v.location.line})`);
    });
  }
}
```

## Edit Plan Schema

The edit plan is defined by `schemas/edit-plan.schema.json`:

```json
{
  "file": "src/legacy/payment.js",
  "module_system": "amd",
  "functions_modified": ["processPayment"],
  "classes_modified": [],
  "variables_modified": [],
  "side_effects": "none",
  "globals_written": [],
  "scope_validated": true,
  "validation_method": "babel-ast",
  "violations": []
}
```

### Fields

| Field                | Type     | Description                                                       |
| -------------------- | -------- | ----------------------------------------------------------------- |
| `file`               | string   | Path to file being edited                                         |
| `module_system`      | enum     | Module system: `esm`, `commonjs`, `amd`, `umd`, `iife`, `unknown` |
| `functions_modified` | string[] | List of function names being modified                             |
| `classes_modified`   | string[] | List of class names being modified                                |
| `variables_modified` | string[] | List of module-level variables being modified                     |
| `side_effects`       | enum     | `none`, `module`, or `global`                                     |
| `globals_written`    | string[] | Global variables written (`window.*`, `global.*`)                 |
| `scope_validated`    | boolean  | Whether validation passed                                         |
| `validation_method`  | enum     | AST parser used: `babel-ast`, `typescript-ast`, etc.              |
| `violations`         | object[] | List of violations detected (if any)                              |

## Detection Capabilities

### Module System Detection

- **ESM**: `import`/`export` statements
- **CommonJS**: `require()` calls
- **AMD**: `define()` calls
- **UMD**: Mixed patterns (ESM takes precedence)
- **IIFE**: Self-executing functions
- **Unknown**: None detected

### Code Analysis

✅ **Detects:**

- Function declarations
- Class declarations
- Global writes (`window.*`, `global.*`)
- Side effects (module-level vs global)
- Module system type

❌ **Currently NOT detected:**

- Arrow functions assigned to variables
- Method declarations within classes (tracked via class)
- Computed property assignments to globals
- Variable declarations (planned for future)

## Violation Types

### `undeclared_function`

Function modified but not declared in edit plan.

```typescript
// Declared: functions_modified: ['foo']
// Actual file contains:
function foo() {}
function bar() {} // ❌ VIOLATION: undeclared_function
```

### `undeclared_class`

Class modified but not declared in edit plan.

```typescript
// Declared: classes_modified: ['MyClass']
// Actual file contains:
class MyClass {}
class SecretClass {} // ❌ VIOLATION: undeclared_class
```

### `global_write`

Global variable written but not declared.

```typescript
// Declared: globals_written: []
// Actual file contains:
window.DEBUG = true; // ❌ VIOLATION: global_write
```

### `side_effect`

Side effects detected but plan declared 'none'.

```typescript
// Declared: side_effects: 'none'
// Actual file contains:
window.config = {}; // ❌ VIOLATION: side_effect (global detected)
```

## Error Handling

### ScopeValidationError

Thrown when validation fails. Contains structured violation information.

```typescript
class ScopeValidationError extends Error {
  public readonly violations: Array<{
    type: "undeclared_function" | "undeclared_class" | "global_write" | "side_effect";
    message: string;
    location: { line: number; column: number };
  }>;
}
```

**Example error message:**

```
Scope validation failed for src/legacy/payment.js:
  - undeclared_function: Function 'auditLog' modified but not declared in edit plan (line 0)
  - global_write: Global variable 'window.DEBUG_MODE' written but not declared in edit plan (line 0)
  - side_effect: Side effects detected (global) but plan declared 'none' (line 0)
```

## Supported File Types

| Extension | Parser                       | Status               |
| --------- | ---------------------------- | -------------------- |
| `.ts`     | Babel with TypeScript plugin | ✅ Supported         |
| `.tsx`    | Babel with TypeScript + JSX  | ✅ Supported         |
| `.js`     | Babel (unambiguous mode)     | ✅ Supported         |
| `.jsx`    | Babel with JSX               | ✅ Supported         |
| `.mjs`    | Babel (ESM mode)             | ✅ Supported         |
| `.cjs`    | Babel (CommonJS mode)        | ✅ Supported         |
| `.py`     | Python AST                   | ❌ Not yet supported |
| Other     | -                            | ❌ Throws error      |

## Examples

### Example 1: Valid Edit (Passes)

```typescript
// File: src/calculator.ts
export function add(a: number, b: number): number {
  return a + b;
}

// Declared plan:
const plan = {
  functions_modified: ["add"],
  side_effects: "none",
  globals_written: [],
};

// ✅ Validation passes
await validateEditScope("src/calculator.ts", plan);
```

### Example 2: Undeclared Function (Fails)

```typescript
// File: src/utils.ts
export function formatDate(date: Date): string { ... }
export function parseDate(str: string): Date { ... }

// Declared plan (claims to only modify formatDate):
const plan = {
  functions_modified: ['formatDate'],
  side_effects: 'none'
};

// ❌ Throws ScopeValidationError
// Violation: undeclared_function for 'parseDate'
```

### Example 3: Global Write (Fails)

```typescript
// File: src/legacy/config.js
window.APP_CONFIG = { debug: true };

function initApp() {
  return window.APP_CONFIG;
}

// Declared plan:
const plan = {
  functions_modified: ["initApp"],
  side_effects: "none",
  globals_written: [],
};

// ❌ Throws ScopeValidationError
// Violations:
//   - global_write: 'window.APP_CONFIG'
//   - side_effect: global detected but plan declared 'none'
```

### Example 4: AMD Module (Issue Scenario)

```typescript
// File: src/legacy/paymentProcessor.js
define(["dep"], function (dep) {
  window.DEBUG_MODE = true; // Global side effect

  function processPayment(amount) {
    return amount * 1.1;
  }

  function auditLog(msg) {
    console.log("AUDIT:", msg);
  }

  return { processPayment, auditLog };
});

// Declared plan:
const plan = {
  functions_modified: ["processPayment"],
  side_effects: "none",
  globals_written: [],
};

// ❌ Throws ScopeValidationError with 3 violations:
// 1. undeclared_function: 'auditLog'
// 2. global_write: 'window.DEBUG_MODE'
// 3. side_effect: global detected but plan declared 'none'
```

## Integration

### With FileAnalyzer

```typescript
import { FileAnalyzer } from "./planner/fileAnalysis.js";
import { validateEditScope } from "./planner/scopeValidator.js";

// Create analyzer
const analyzer = new FileAnalyzer(octokit, "owner", "repo");

// Analyze file changes for a PR
const fileChanges = await analyzer.getPRFileChanges(123);

// Validate each change
for (const file of fileChanges) {
  if (file.status === "modified") {
    const plan = {
      /* declared edit plan */
    };
    await validateEditScope(file.filename, plan);
  }
}
```

### With CI/CD

```yaml
# .github/workflows/validate-scope.yml
name: Validate Agent Edit Scope

on: [pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        run: npm ci

      - name: Validate scope
        run: |
          # Extract edit plan from PR description
          # Run validation
          npm run validate-scope
```

## Testing

Comprehensive test coverage (21 tests):

```bash
npm test -- scopeValidator.spec.ts
```

**Test categories:**

- Module system detection (ESM, CommonJS, AMD)
- Function/class detection
- Global write detection
- Side effect detection
- Validation pass/fail scenarios
- Error message formatting
- Edge cases (empty files, comments, mixed modules)

## Limitations & Future Work

### Current Limitations

1. **Line/column precision**: Currently reports `line: 0, column: 0` for all violations. Need to extract actual locations from AST.
2. **Variable declarations**: Not yet tracked (only functions/classes).
3. **Computed properties**: `window[key] = value` not detected (shows as `<computed>`).
4. **Method modifications**: Class methods not tracked individually.
5. **Python support**: Not yet implemented.

### Planned Enhancements

- [ ] Extract precise line/column from AST for violations
- [ ] Add variable declaration tracking
- [ ] Detect computed property writes
- [ ] Add Python AST support
- [ ] Policy files for per-repo customization
- [ ] Integration with merge-weave workflow
- [ ] Automatic edit plan generation from diffs

## Security Considerations

This feature is marked **P0 (Critical)** for security:

- Prevents accidental global pollution
- Detects unintended side effects
- Enforces hermetic edit boundaries
- Protects legacy code from agent modifications

**Best practices:**

- Always validate before applying agent edits
- Treat validation failures as blocking errors
- Review violations manually for false positives
- Use strict mode in production environments

## References

- **Schema**: `schemas/edit-plan.schema.json`
- **Implementation**: `src/planner/scopeValidator.ts`
- **Tests**: `tests/scopeValidator.spec.ts`
- **Issue**: [GitHub Issue #XXX](link-to-issue)
