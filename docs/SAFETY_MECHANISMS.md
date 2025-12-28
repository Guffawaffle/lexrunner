# Safety Mechanisms for Issues-Only Commands

This document describes the safety infrastructure implemented to prevent accidental PR creation in Issues-only commands.

## Overview

The safety mechanisms provide three layers of protection:

1. **PR Prevention Guards** - Detect and block PR creation attempts
2. **Path Validation** - Enforce artifact path restrictions
3. **Schema Validation** - Validate data before Issue creation

## Components

### 1. PR Prevention Guards (`src/commands/guards.ts`)

#### `assertNoCreatePR(operation: string): void`

Checks the call stack for PR creation methods and throws if found.

**Usage:**

```typescript
import { assertNoCreatePR } from "./commands/guards.js";

async function runIdeaCommand(options: IdeaOptions): Promise<void> {
  // Guard against PR creation
  assertNoCreatePR("lex-pr idea");

  // ... rest of command logic
}
```

**Detected Patterns:**

- `createPullRequest`
- `pulls.create`
- `mergePullRequest`

**Error Message:**

```
SAFETY VIOLATION: lex-pr idea attempted PR creation via createPullRequest
This command is Issues-only. Remove PR creation logic.
```

#### `validateNoCreatePRFlags(options: Record<string, unknown>): void`

Validates that command options don't include PR-related flags.

**Usage:**

```typescript
import { validateNoCreatePRFlags } from "./commands/guards.js";

async function runIdeaCommand(options: IdeaOptions): Promise<void> {
  // Validate command options
  validateNoCreatePRFlags(options);

  // ... rest of command logic
}
```

**Forbidden Flags:**

- `create-pr`
- `pr`
- `pull-request`
- `merge`

**Error Message:**

```
SAFETY VIOLATION: Flag --create-pr not allowed in Issues-only commands
Use GitHub Projects or Issue tracking instead.
```

### 2. Path Validation (`src/utils/paths.ts`)

#### `isSafeArtifactPath(inputPath: string): boolean`

Checks if a path is safe for artifact writes.

**Allowed Patterns:**

- `.smartergpt.local/deliverables/_session/`
- `.smartergpt.local/runner/logs/`
- `.smartergpt/deliverables/_session/`

**Blocked Patterns:**

- `/PR-<number>/` (e.g., `/PR-123/`, `/pr-456/`)
- `/artifacts/PR-*/` (e.g., `/artifacts/PR-789/`)

**Usage:**

```typescript
import { isSafeArtifactPath } from "../utils/paths.js";

const outputPath = ".smartergpt.local/deliverables/_session/idea.json";
isSafeArtifactPath(outputPath); // Returns true

const unsafePath = "artifacts/PR-123/spec.json";
isSafeArtifactPath(unsafePath); // Throws error
```

**Error Message:**

```
SAFETY VIOLATION: Cannot write to PR artifact directory
Blocked path: artifacts/PR-123/spec.json
Use .smartergpt.local/deliverables/_session/ instead
```

#### `validateOutputPath(outputPath: string): Promise<void>`

Validates output path and creates parent directories if needed.

**Usage:**

```typescript
import { validateOutputPath } from "../utils/paths.js";

const outputPath = ".smartergpt.local/deliverables/_session/idea.json";
await validateOutputPath(outputPath);

// Parent directories are now created
await fs.writeFile(outputPath, data);
```

**Checks:**

1. Path is safe for artifact writes (not in PR directory)
2. Parent directory exists or can be created

#### `normalizePath(inputPath: string): string`

Normalizes paths for cross-platform comparison.

**Usage:**

```typescript
import { normalizePath } from "../utils/paths.js";

const windowsPath = "C:\\path\\to\\file.txt";
const normalized = normalizePath(windowsPath);
// Returns: 'C:/path/to/file.txt'
```

### 3. Schema Validation (`src/commands/validation.ts`)

#### `validateOrThrow<T>(data: unknown, schema: ZodSchema<T>, context: string): T`

Validates data against a Zod schema with detailed error reporting.

**Usage:**

```typescript
import { validateOrThrow } from "./commands/validation.js";
import { z } from "zod";

const FeatureSpecSchema = z.object({
  title: z.string(),
  description: z.string(),
  features: z.array(z.string()),
});

const specData = {
  title: "New Feature",
  description: "Add new feature",
  features: ["feature1", "feature2"],
};

const validatedSpec = validateOrThrow(specData, FeatureSpecSchema, "Feature Spec v0");
```

**Success Output:**

```
✓ Schema validation passed (Feature Spec v0)
```

**Error Output:**

```
Schema validation failed (Feature Spec v0):
  1. description: Expected string, received number
     Expected: string, received: number
  2. features: Expected array, received string
```

#### `preflightSchemaCheck(specPath: string, schema: ZodSchema, schemaName: string): Promise<void>`

Validates a JSON spec file against a schema before Issue creation.

**Usage:**

```typescript
import { preflightSchemaCheck } from "./commands/validation.js";

const specPath = ".smartergpt.local/deliverables/_session/feature-spec.json";
await preflightSchemaCheck(specPath, FeatureSpecV0Schema, "Feature Spec v0");
```

**Output:**

```
Pre-flight schema check: Feature Spec v0
✓ Schema validation passed (Feature Spec v0)
```

## Complete Command Integration

Here's how to integrate all safety mechanisms into a new Issues-only command:

```typescript
import { assertNoCreatePR, validateNoCreatePRFlags } from "./commands/guards.js";
import { validateOutputPath } from "../utils/paths.js";
import { validateOrThrow, preflightSchemaCheck } from "./commands/validation.js";
import { z } from "zod";

// Define schema
const FeatureSpecSchema = z.object({
  title: z.string(),
  description: z.string(),
  features: z.array(z.string()),
});

interface IdeaOptions {
  title: string;
  description: string;
  output?: string;
  [key: string]: unknown;
}

async function runIdeaCommand(options: IdeaOptions): Promise<void> {
  // Step 1: Guard against PR creation
  assertNoCreatePR("lex-pr idea");

  // Step 2: Validate no PR flags
  validateNoCreatePRFlags(options);

  // Step 3: Prepare spec data
  const specData = {
    title: options.title,
    description: options.description,
    features: [], // populated from user input
  };

  // Step 4: Validate spec against schema
  const validatedSpec = validateOrThrow(specData, FeatureSpecSchema, "Feature Spec v0");

  // Step 5: Determine output path
  const outputPath = options.output || ".smartergpt.local/deliverables/_session/feature-spec.json";

  // Step 6: Validate output path
  await validateOutputPath(outputPath);

  // Step 7: Write spec file
  await fs.writeFile(outputPath, JSON.stringify(validatedSpec, null, 2));

  console.log(`✓ Feature spec written to ${outputPath}`);

  // Step 8: Create GitHub Issue (not implemented in this PR)
  // await createIssue(validatedSpec);
}
```

## Testing

All safety mechanisms are thoroughly tested:

- **guards.spec.ts** - 14 tests for PR prevention
- **paths.spec.ts** - 22 tests for path validation
- **validation.spec.ts** - 12 tests for schema validation
- **safety-guards-integration.spec.ts** - 7 integration tests

Run tests:

```bash
npm test -- tests/commands/guards.spec.ts
npm test -- tests/utils/paths.spec.ts
npm test -- tests/commands/validation.spec.ts
npm test -- tests/safety-guards-integration.spec.ts
```

## Future Commands

These safety mechanisms are designed to be used by:

- **lex-pr idea** (Issue #355) - Issues-only command for capturing feature ideas
- **lex-pr create-project** (Issue #356) - Issues-only command for project creation
- Any future Issues-only commands

## Error Handling

All safety violations throw descriptive errors:

```typescript
try {
  assertNoCreatePR("lex-pr idea");
  validateNoCreatePRFlags(options);
  await validateOutputPath(outputPath);
  validateOrThrow(data, schema, "Feature Spec");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
```

## Design Principles

1. **Fail Fast** - Detect violations early in command execution
2. **Clear Messages** - Provide actionable error messages with guidance
3. **Standalone** - Each mechanism works independently
4. **Composable** - Mechanisms can be combined for comprehensive protection
5. **Testable** - All mechanisms have comprehensive unit and integration tests
6. **Cross-Platform** - Path validation works on Windows, macOS, and Linux

## Related Issues

- #357 - R3: Safety & logging (this PR)
- #355 - R1: `lex-pr idea` (will use these mechanisms)
- #356 - R2: `lex-pr create-project` (will use these mechanisms)
- #354 - Front-end capture pipeline (parent epic)
