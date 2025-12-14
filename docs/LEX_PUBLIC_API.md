# Lex Public API Documentation

This document defines the **public API surface** for Lex when consumed by LexRunner. It specifies which modules are exported, their import paths, and the versioning policy.

## Design Principles

1. **Minimal Surface**: Only export what LexRunner needs to integrate with Lex
2. **Stable Contracts**: Public exports follow semantic versioning
3. **Internal Protection**: Mark internal-only code with `@internal` JSDoc tags
4. **Type Safety**: All public exports include TypeScript definitions
5. **Zero Duplication**: LexRunner uses Lex's implementations, not duplicates

## Exported Modules

| Module | Export Path | Purpose | Status |
|--------|-------------|---------|--------|
| **Memory/Frames** | `@smartergpt/lex/types` | Frame types and schemas for execution tracking | ✅ Available |
| **Errors** | `@smartergpt/lex/errors` | AXError types and error handling utilities | ✅ Available |
| **Policy** | `@smartergpt/lex/policy` | Policy validation and checking | ✅ Available |
| **Atlas** | `@smartergpt/lex/atlas` | Code atlas and dependency analysis | ✅ Available |
| **Store** | `@smartergpt/lex/store` | Memory store for frames and receipts | ✅ Available |
| **Logger** | `@smartergpt/lex/logger` | Structured logging utilities | ✅ Available |
| **Aliases** | `@smartergpt/lex/aliases` | Module ID resolution | ✅ Available |

## Import Path Examples

### Frame Types (Memory)

```typescript
// Import Frame types from Lex
import type {
  ExecutionFrame,
  ExecutionFrameMetadata,
  FrameOutcome,
  FrameType,
} from "@smartergpt/lex/types";

import {
  ExecutionFrameSchema,
  validateExecutionFrame,
  safeValidateExecutionFrame,
} from "@smartergpt/lex/types";

// Use in LexRunner code
const frame: ExecutionFrame = {
  type: "merge-weave",
  reference_point: "merge-weave-2025-12-14-abc123",
  summary_caption: "Merged 4 PRs into integration branch",
  module_scope: ["#123", "#124", "#125", "#126"],
  keywords: ["merge-weave", "integration"],
  outcome: "success",
  next_actions: ["Merge integration to main"],
  metadata: {
    duration_ms: 45000,
    conflicts_resolved: 2,
    gates_passed: ["lint", "typecheck", "test"],
  },
};

// Validate frame
const validated = validateExecutionFrame(frame);
```

### Error Handling

```typescript
// Import error types from Lex
import {
  createAXError,
  AXErrorException,
  type AXError,
} from "@smartergpt/lex/errors";

// Create and throw errors
const error = createAXError({
  code: "MERGE_CONFLICT",
  message: "Failed to merge PRs",
  severity: "error",
  context: { prs: ["#123", "#124"] },
});

throw new AXErrorException(error);
```

### Policy Operations

```typescript
// Import policy types and functions
import type { Policy } from "@smartergpt/lex/policy";
import { validatePolicy, loadPolicy } from "@smartergpt/lex/policy";

// Load and validate policy
const policy = await loadPolicy("/path/to/policy.json");
const isValid = validatePolicy(policy);
```

### Atlas Operations

```typescript
// Import atlas types and functions
import type { CodeAtlas } from "@smartergpt/lex/atlas";
import { buildAtlas, queryAtlas } from "@smartergpt/lex/atlas";

// Build and query code atlas
const atlas = await buildAtlas({ rootDir: "/path/to/project" });
const dependencies = queryAtlas(atlas, { module: "src/cli.ts" });
```

### Memory Store

```typescript
// Import store functions
import {
  storeFrame,
  readFrame,
  listFrames,
} from "@smartergpt/lex/store";

// Store and retrieve frames
await storeFrame(frame);
const retrieved = await readFrame(frameId);
const allFrames = await listFrames();
```

### Logger

```typescript
// Import logger
import { createLogger } from "@smartergpt/lex/logger";

// Create structured logger
const logger = createLogger({ name: "lex-pr-runner" });
logger.info("Starting merge-weave operation");
```

### Module ID Resolution

```typescript
// Import alias resolution
import { resolveModuleId, resolveAlias } from "@smartergpt/lex/aliases";

// Resolve module IDs
const canonical = await resolveModuleId("src/cli", policy);
```

## LexRunner Integration Points

LexRunner uses Lex in the following ways:

1. **Frame Emission** (`src/frames/`)
   - Uses Lex Frame types for execution tracking
   - Stores frames locally using LexRunner's storage layer
   - May integrate with Lex store in the future

2. **Error Handling** (`src/errors/`)
   - Re-exports `AXError` from Lex
   - Provides LexRunner-specific error adapters
   - Maintains compatibility with Lex error contracts

3. **Policy Validation** (`src/security/policy.ts`)
   - Uses Lex policy types for security policies
   - Validates policies using Lex schemas

4. **Module Resolution** (`src/config/promptsResolver.ts`)
   - Uses Lex alias resolution for module IDs
   - Resolves prompt paths from Lex canon

## Versioning Strategy

### Semantic Versioning

Lex follows **semantic versioning** (semver) for all public API changes:

- **MAJOR** (e.g., 2.0.0 → 3.0.0): Breaking changes to public API
- **MINOR** (e.g., 2.0.0 → 2.1.0): New features, backward compatible
- **PATCH** (e.g., 2.0.0 → 2.0.1): Bug fixes, backward compatible

### Breaking Change Process

When Lex introduces breaking changes:

1. **Deprecation Period**: Deprecated APIs remain available for at least one minor version
2. **Migration Guide**: Documentation provided for upgrading
3. **Version Pinning**: LexRunner pins to specific Lex versions in `package.json`
4. **Testing**: CI validates LexRunner against Lex updates

### Current Version Contract

- **Lex Version**: `^2.0.2` (specified in LexRunner's `package.json`)
- **Minimum Compatible**: `2.0.0`
- **Tested Against**: `2.0.2`

## Internal-Only Code

Code marked with `@internal` JSDoc tags is **not part of the public API** and may change without notice:

```typescript
/**
 * @internal
 * This function is for internal use only and may change.
 */
function internalHelper() {
  // ...
}
```

LexRunner should **never** import code marked as `@internal`.

## Type Definitions

All public exports include TypeScript `.d.ts` files generated during the Lex build process:

- Generated from source: `dist/**/*.d.ts`
- Validated during build: `npm run build`
- Tested in CI: Type checking ensures compatibility

## Validation Checklist

Before consuming a new Lex API in LexRunner:

- [ ] Is it exported in Lex's `package.json` `exports` field?
- [ ] Does it have TypeScript definitions (`.d.ts`)?
- [ ] Is it documented (JSDoc comments)?
- [ ] Is it **not** marked with `@internal`?
- [ ] Does it follow Lex's versioning policy?

## Migration Path

If LexRunner needs to migrate from internal Lex APIs to public ones:

1. **Identify Usage**: Find all imports from Lex in LexRunner
2. **Check Exports**: Verify the import path is in Lex's public exports
3. **Add Tests**: Ensure LexRunner tests validate the integration
4. **Document**: Update this file with any new usage patterns

## Related Documentation

- [Lex Integration Guide](./LEX_INTEGRATION.md) - How LexRunner integrates with Lex
- [Lex Repository](https://github.com/Guffawaffle/lex) - Lex source code
- [Lex Changelog](https://github.com/Guffawaffle/lex/blob/main/CHANGELOG.md) - Version history
- [Frame Types](../src/frames/types.ts) - LexRunner Frame type extensions

## Questions & Support

- **Lex Issues**: https://github.com/Guffawaffle/lex/issues
- **LexRunner Issues**: https://github.com/Guffawaffle/LexRunner/issues
- **Version Compatibility**: Check `package.json` for pinned versions
