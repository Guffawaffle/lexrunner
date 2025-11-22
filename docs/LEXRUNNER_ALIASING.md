# LexRunner Aliasing Guide

**For LexRunner users:** This guide explains how to use Lex's aliasing system with LexRunner workflows.

## Overview

LexRunner orchestrates merge-weave workflows using Lex as its core memory and policy engine. When LexRunner captures frames during PR validation and merge sequences, it needs to reference module IDs that align with your `lexmap.policy.json`.

Lex provides an **aliasing system** that allows you to use convenient shorthand names instead of full module IDs. This is especially useful in LexRunner contexts where:

- CI scripts need consistent module references across PRs
- Teams want to use shorthand conventions (`auth` → `services/auth-core`)
- Modules get renamed but historical frames need continuity
- Different teams have different naming conventions

## Quick Start for LexRunner

### 1. LexRunner Uses Canonical Module IDs

When LexRunner integrates with Lex, it captures frames with `module_scope` fields. These MUST contain canonical module IDs from your policy:

```typescript
// LexRunner captures a frame during PR validation
const frame = await lexMemory.saveFrame({
  referencePoint: "PR-123 validation",
  summaryCaption: "Auth service tests passing",
  moduleScope: ["services/auth-core"], // Must match policy exactly
  // ... other fields
});
```

### 2. Enable Aliases for Your Team

Create an alias table at `.smartergpt.local/lex/aliases.json`:

```json
{
  "aliases": {
    "auth": {
      "canonical": "services/auth-core",
      "confidence": 1.0,
      "reason": "team shorthand"
    },
    "user-api": {
      "canonical": "api/user-access",
      "confidence": 1.0,
      "reason": "team shorthand"
    }
  }
}
```

### 3. LexRunner Resolves Aliases Automatically

When you configure LexRunner with module scopes, aliases are resolved:

```typescript
// In LexRunner configuration or workflow
import { resolveModuleId } from 'lex/shared/aliases';

// Your team uses "auth" shorthand
const resolution = await resolveModuleId('auth', policy);
// → { canonical: 'services/auth-core', confidence: 1.0, source: 'alias' }

// Store the canonical ID in the frame
await lexMemory.saveFrame({
  moduleScope: [resolution.canonical], // Always store canonical
  // ...
});
```

## LexRunner Integration Patterns

### Pattern 1: PR-Specific Module Scope

LexRunner determines which modules a PR touches and validates them:

```typescript
// LexRunner PR validation workflow
import { resolveModuleId } from 'lex/shared/aliases';
import { validateModuleIds } from 'lex/shared/module_ids';

async function validatePRModules(prModules: string[], policy: Policy) {
  // Resolve any aliases first
  const resolutions = await Promise.all(
    prModules.map(id => resolveModuleId(id, policy))
  );
  
  // Validate all resolved IDs
  const validation = await validateModuleIds(
    resolutions.map(r => r.canonical),
    policy
  );
  
  if (!validation.valid) {
    throw new Error(`Invalid module IDs: ${validation.errors.join(', ')}`);
  }
  
  return validation.canonical; // Store these in frames
}
```

### Pattern 2: Team Convention Mapping

Teams can configure LexRunner with their own conventions:

```json
// lexrunner.config.json
{
  "aliasTable": ".smartergpt.local/lex/aliases.json",
  "moduleConventions": {
    "services": ["auth", "user-api", "payment"],
    "ui": ["admin-panel", "dashboard"],
    "infrastructure": ["db", "cache"]
  }
}
```

Then generate an alias table:

```bash
# LexRunner CLI helper (future)
lexrunner alias generate --config lexrunner.config.json
```

### Pattern 3: Historical Rename Continuity

When modules get renamed, LexRunner needs old frames to remain valid:

```json
{
  "aliases": {
    "services/user-access-api": {
      "canonical": "api/user-access",
      "confidence": 1.0,
      "reason": "refactored 2025-10-15"
    }
  }
}
```

This ensures:
- Old frames from pre-rename PRs still work
- Atlas frames can be generated for historical work
- Policy-aware queries work across the rename boundary

## Module ID Resolution Priority

LexRunner follows this resolution order:

1. **Exact match** (confidence 1.0) — ID exists in policy as-is
2. **Explicit alias** (confidence 1.0) — ID defined in alias table
3. **Unique substring** (confidence 0.9) — Partial match with only one candidate
4. **Ambiguous/Unknown** (confidence 0.0) — Multiple matches or not found

### Example: Resolution Flow

```typescript
// Policy modules: ["services/auth-core", "services/user-api", "ui/admin-panel"]
// Alias table: { "auth": "services/auth-core" }

await resolveModuleId('services/auth-core', policy);
// → { canonical: 'services/auth-core', confidence: 1.0, source: 'exact' }

await resolveModuleId('auth', policy);
// → { canonical: 'services/auth-core', confidence: 1.0, source: 'alias' }

await resolveModuleId('auth-core', policy);
// → { canonical: 'services/auth-core', confidence: 0.9, source: 'substring' }

await resolveModuleId('user', policy);
// → { canonical: 'user', confidence: 0.0, source: 'fuzzy' }
// (Ambiguous: matches both 'services/user-api' and could be substring)
```

## LexRunner CI Mode

In CI pipelines, you may want strict validation (no fuzzy matching):

```bash
# Set strict mode to disable substring matching
LEX_STRICT_MODE=1 lexrunner merge-weave plan.json
```

Or programmatically:

```typescript
const resolution = await resolveModuleId('auth', policy, aliasTable, {
  noSubstring: true, // Disable substring matching
});
```

This ensures CI only accepts:
- Exact matches (confidence 1.0)
- Explicit aliases (confidence 1.0)

## Testing Alias Resolution

LexRunner should validate aliases during setup:

```typescript
import { loadAliasTable, resolveModuleId } from 'lex/shared/aliases';

async function validateLexRunnerAliases(aliasPath: string, policy: Policy) {
  const aliasTable = loadAliasTable(aliasPath);
  
  for (const [alias, entry] of Object.entries(aliasTable.aliases)) {
    // Verify canonical ID exists in policy
    if (!policy.modules[entry.canonical]) {
      throw new Error(
        `Alias '${alias}' points to unknown module '${entry.canonical}'`
      );
    }
  }
  
  console.log('✓ All aliases valid');
}
```

## Common LexRunner Scenarios

### Scenario 1: Multi-PR Merge Sequence

LexRunner orchestrates dependent PRs:

```typescript
// PR-123 touches ["services/auth-core"]
// PR-124 touches ["api/user-access"] 
// PR-125 touches ["ui/admin-panel"]

// All captured with canonical IDs via aliasing
const pr123Frame = { moduleScope: ["services/auth-core"] };
const pr124Frame = { moduleScope: ["api/user-access"] };
const pr125Frame = { moduleScope: ["ui/admin-panel"] };

// Later: Query frames for entire sequence
const sequenceFrames = await searchFrames(db, {
  moduleScope: ["services/auth-core", "api/user-access", "ui/admin-panel"],
});
```

### Scenario 2: Cross-Team PR Dependencies

Team A uses `auth`, Team B uses `services/auth-core`:

```json
{
  "aliases": {
    "auth": {
      "canonical": "services/auth-core",
      "confidence": 1.0,
      "reason": "Team A shorthand"
    }
  }
}
```

Both teams' PRs resolve to the same canonical ID, enabling cross-team continuity.

### Scenario 3: Refactoring During Merge Sequence

Module renamed mid-sequence:

1. PR-100 (before rename): `module_scope: ["services/user-access-api"]`
2. PR-101 (rename): Updates policy to `api/user-access`
3. PR-102 (after rename): `module_scope: ["api/user-access"]`

Add alias to maintain continuity:

```json
{
  "aliases": {
    "services/user-access-api": {
      "canonical": "api/user-access",
      "confidence": 1.0,
      "reason": "refactored in PR-101"
    }
  }
}
```

Now all three PRs' frames remain queryable.

## Performance Considerations

Aliasing adds minimal overhead to LexRunner:

- **Alias table load**: ~5ms (cached after first load)
- **Resolution per module ID**: <1ms (exact match bypasses lookup)
- **Validation overhead**: <5% total PR validation time

For large merge sequences (100+ PRs), caching is automatic.

## Troubleshooting

### Error: "Alias points to unknown module"

```
Error: Alias 'auth' points to unknown module 'services/auth-core'
```

**Cause:** Alias table references a module that doesn't exist in policy.

**Fix:** Update alias table or add module to policy:

```bash
# Option 1: Fix alias
# Edit aliases.json to point to correct module

# Option 2: Add module to policy
# Edit lexmap.policy.json
```

### Warning: "Ambiguous substring match"

```
Warning: Substring 'user' matches multiple modules:
  - services/user-api
  - ui/user-admin-panel
Please use full module ID or add to alias table.
```

**Cause:** LexRunner configuration uses shorthand that matches multiple modules.

**Fix:** Add explicit alias:

```json
{
  "aliases": {
    "user": {
      "canonical": "services/user-api",
      "confidence": 1.0,
      "reason": "team convention: 'user' refers to backend API"
    }
  }
}
```

### Error: "Module not found in policy"

```
Error: Module 'auth' not found in policy.
Did you mean 'services/auth-core'?
```

**Cause:** Module ID doesn't exist in policy and no alias defined.

**Fix:** Add alias or use exact ID:

```json
{
  "aliases": {
    "auth": {
      "canonical": "services/auth-core",
      "confidence": 1.0,
      "reason": "shorthand"
    }
  }
}
```

## Best Practices for LexRunner

1. **Use aliases for team conventions** — Make LexRunner configs readable
2. **Store canonical IDs only** — Never store aliases in frames
3. **Test aliases in CI** — Validate alias table on policy changes
4. **Document renames** — Add `reason` field explaining historical aliases
5. **Use strict mode in production** — Disable fuzzy matching in CI pipelines

## Example: Complete LexRunner Integration

```typescript
// lexrunner-integration.ts
import { resolveModuleId, loadAliasTable } from 'lex/shared/aliases';
import { validateModuleIds } from 'lex/shared/module_ids';
import { loadPolicy } from 'lex/shared/policy';

async function lexRunnerValidatePR(
  prModules: string[],
  policyPath: string,
  aliasPath?: string
) {
  // Load policy and optional alias table
  const policy = await loadPolicy(policyPath);
  const aliasTable = aliasPath ? loadAliasTable(aliasPath) : undefined;
  
  // Resolve all module IDs
  const resolutions = await Promise.all(
    prModules.map(id => resolveModuleId(id, policy, aliasTable, {
      noSubstring: process.env.LEX_STRICT_MODE === '1',
    }))
  );
  
  // Check for low-confidence matches
  const lowConfidence = resolutions.filter(r => r.confidence < 1.0);
  if (lowConfidence.length > 0) {
    console.warn('⚠️  Low-confidence module IDs:');
    lowConfidence.forEach(r => {
      console.warn(`  '${r.original}' → '${r.canonical}' (${r.confidence})`);
    });
  }
  
  // Validate canonical IDs
  const validation = await validateModuleIds(
    resolutions.map(r => r.canonical),
    policy
  );
  
  if (!validation.valid) {
    throw new Error(`Invalid modules: ${validation.errors.join(', ')}`);
  }
  
  // Return canonical IDs for frame storage
  return {
    canonical: validation.canonical,
    resolutions,
    warnings: lowConfidence.length > 0,
  };
}

// Usage in LexRunner workflow
const result = await lexRunnerValidatePR(
  ['auth', 'user-api', 'ui-admin'], // Team shorthand
  './lexmap.policy.json',
  './.smartergpt.local/lex/aliases.json'
);

console.log('✓ Module IDs validated:', result.canonical);
// → ['services/auth-core', 'api/user-access', 'ui/admin-panel']
```

## Related Documentation

- [Alias System README](../src/shared/aliases/README.md) — Implementation details
- [Alias Migration Guide](../src/shared/aliases/MIGRATION_GUIDE.md) — Handling renames
- [Module ID Validation](../src/shared/module_ids/README.md) — THE CRITICAL RULE
- [LexRunner Repo](https://github.com/Guffawaffle/lex-pr-runner) — Orchestration layer

## Summary

LexRunner benefits from Lex's aliasing system by:

1. **Allowing team conventions** — Use shorthand in configs and scripts
2. **Maintaining historical continuity** — Old frames work after renames
3. **Reducing friction** — Fewer typos and validation errors
4. **Preserving strictness** — CI mode enforces exact matches when needed

The key principle: **Aliases are for humans during input; canonical IDs are for storage.**
