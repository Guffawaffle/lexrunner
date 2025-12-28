# Deliverables Generator

Auto-generates merge-weave deliverables with plan hashing and toolchain manifests for full auditability.

## Overview

The deliverables generator creates structured documentation for merge-weave operations, including:

- **Plan Hash**: SHA256 hash of canonical plan.json for reproducibility verification
- **Toolchain Manifest**: Captured tool versions and environment for deterministic execution
- **Gate Deliverables**: Markdown templates for each orchestration gate (GATE0-GATE5)
- **Summary**: Comprehensive batch summary with metrics and metadata

## Usage

### Basic Command

```bash
lex-pr orchestrate:generate-deliverables --batch <batchId> --plan <path-to-plan.json>
```

### Options

- `--batch <batchId>` (required): Batch identifier (e.g., `batch3`, `sprint-2025-Q1`)
- `--plan <path>`: Path to plan.json file (default: `plan.json`)
- `--output-dir <path>`: Output directory for deliverables (default: `.smartergpt.local/deliverables/<batch-id>`)

### Examples

#### Generate deliverables for batch3

```bash
lex-pr orchestrate:generate-deliverables \
  --batch batch3 \
  --plan batch3-plan.json \
  --output-dir .smartergpt.local/deliverables/batch3
```

#### Use default output directory

```bash
lex-pr orchestrate:generate-deliverables \
  --batch batch3 \
  --plan batch3-plan.json
# Output: .smartergpt.local/deliverables/batch3/
```

## Generated Files

### Directory Structure

```
.smartergpt.local/deliverables/batch3/
├── plan.json              # Copy of input plan
├── plan-hash.txt          # SHA256 hash + timestamp
├── toolchain-manifest.json # Tool versions and environment
├── GATE0_preflight.md     # Batch overview, issue list, dependencies
├── GATE1_assignment.md    # Agent assignments, timing
├── GATE2_conflicts.md     # Conflict analysis
├── GATE3_merge.md         # Merge execution log
├── GATE4_gates.md         # Gate results (lint/type/test)
├── GATE5_cleanup.md       # Branch cleanup, PR closure
└── SUMMARY.md             # Full batch summary with metrics
```

### Plan Hash File Format

**plan-hash.txt**:

```
SHA256: a3f2b9c8d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0
Algorithm: SHA256
Canonical JSON: true
Generated: 2025-10-13T02:00:00Z
Plan Version: 1.0.0
```

### Toolchain Manifest

**toolchain-manifest.json**:

```json
{
  "schemaVersion": "1.0.0",
  "generated": "2025-10-13T02:00:00Z",
  "tools": [
    { "name": "git", "version": "2.45.2", "path": "/usr/bin/git" },
    { "name": "Node.js", "version": "20.18.0", "path": "/usr/bin/node" },
    { "name": "npm", "version": "10.8.2", "path": "/usr/bin/npm" },
    { "name": "TypeScript", "version": "5.6.3" },
    { "name": "ESLint", "version": "9.14.0" }
  ],
  "environment": {
    "timezone": "UTC",
    "locale": "en_US.UTF-8",
    "platform": "linux",
    "arch": "x64",
    "nodeVersion": "20.18.0"
  }
}
```

### Summary with Plan Hash and Toolchain

**SUMMARY.md** includes:

```markdown
## Plan Hash

**SHA256:** `a3f2b9c8...`

This hash uniquely identifies the plan.json used for this merge-weave.
To verify reproducibility, compare this hash with a re-execution.

## Toolchain

| Tool       | Version |
| ---------- | ------- |
| git        | 2.45.2  |
| Node.js    | 20.18.0 |
| npm        | 10.8.2  |
| TypeScript | 5.6.3   |
| ESLint     | 9.14.0  |

**Environment:** TZ=UTC, LANG=en_US.UTF-8

Full manifest: `toolchain-manifest.json`
```

## Plan Hash Verification

The plan hash is deterministic and can be used to verify reproducibility:

1. **Generate deliverables twice** with the same plan
2. **Compare hashes** in `plan-hash.txt`
3. **Identical hashes** prove deterministic plan processing

### Programmatic Hash Computation

```typescript
import { computePlanHash } from "./src/orchestration/deliverablesGenerator";
import { Plan } from "./src/schema";

const plan: Plan = {
  /* your plan */
};
const hash = computePlanHash(plan);
// Returns: SHA256 hex string (64 characters)
```

### Canonical JSON

The hash uses canonical JSON serialization:

- **Keys sorted alphabetically** (recursively)
- **Deterministic serialization** (no whitespace variance)
- **UTF-8 encoding** for consistent byte representation

## Integration with Merge-Weave Workflow

```bash
# 1. Execute merge-weave
lex-pr execute --plan batch3-plan.json

# 2. Generate deliverables
lex-pr orchestrate:generate-deliverables --batch batch3 --plan batch3-plan.json

# 3. Commit to repository
git add .smartergpt.local/deliverables/batch3/
git commit -m "docs: Add batch3 merge-weave deliverables (plan hash: a3f2b9c8...)"
```

## API Reference

### `generateDeliverables(options: DeliverablesOptions): Promise<void>`

Generates full deliverables for a merge-weave batch.

**Parameters:**

- `options.batchId` (string): Batch identifier
- `options.planPath` (string): Path to plan.json
- `options.outputDir` (string): Output directory
- `options.templateDir?` (string, optional): Custom template directory

**Example:**

```typescript
import { generateDeliverables } from "./src/orchestration/deliverablesGenerator";

await generateDeliverables({
  batchId: "batch3",
  planPath: "batch3-plan.json",
  outputDir: ".smartergpt.local/deliverables/batch3",
});
```

### `computePlanHash(plan: Plan): string`

Computes SHA256 hash of canonical plan.json.

**Returns:** 64-character hex string

**Example:**

```typescript
import { computePlanHash } from "./src/orchestration/deliverablesGenerator";

const hash = computePlanHash(plan);
// "a3f2b9c8d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0"
```

### `generateToolchainManifest(): ToolchainManifest`

Generates toolchain manifest with current environment and tool versions.

**Returns:** `ToolchainManifest` object

**Example:**

```typescript
import { generateToolchainManifest } from "./src/orchestration/toolchainManifest";

const manifest = generateToolchainManifest();
// { schemaVersion: "1.0.0", tools: [...], environment: {...} }
```

## Testing

### Run Tests

```bash
# All deliverables tests
npm test -- deliverables-generator.spec.ts

# Toolchain manifest tests
npm test -- toolchain-manifest.spec.ts

# CLI integration tests
npm test -- cli-deliverables-generator.spec.ts
```

### Test Fixtures

Located in `tests/fixtures/deliverables/`:

- `batch-example-plan.json`: Sample plan with 3 items and dependencies

### Test Coverage

- ✅ Plan hash determinism
- ✅ Canonical JSON key ordering
- ✅ All deliverable files generation
- ✅ Toolchain manifest accuracy
- ✅ CLI integration
- ✅ Error handling
- ✅ Custom batch IDs
- ✅ Default output directory

## Implementation Details

### Canonical JSON Serialization

Uses `canonicalJSONStringify()` from `src/util/canonicalJson.ts`:

1. Recursively sorts object keys alphabetically
2. Preserves array order (authored order)
3. Deterministic output across executions

### Toolchain Detection

Detects tool versions via:

- **Command execution**: `git --version`, `npm --version`
- **package.json parsing**: TypeScript, ESLint, Prettier versions
- **Process environment**: Node.js version, platform, arch

### Template Generation

Uses inline template strings (no external dependencies):

- Simple string interpolation
- Markdown formatting
- Stable ordering for determinism

## Related

- **Epic #171**: Pyramid Orchestration Tools (Phase 2)
- **Feature 7**: Determinism Framework (toolchain manifest)
- **Feature 2**: Batch Planner (plan.json format)
- **Feature 5**: Conflict Predictor (conflict data for GATE2)

## Future Enhancements

- [ ] Custom template support (Handlebars/Mustache)
- [ ] Additional gate types (GATE6+)
- [ ] Conflict data integration from Feature 5
- [ ] Performance metrics tracking
- [ ] Diff comparison between batch runs
