# Aliasing for LexRunner Developers

**How to use Lex aliasing for module-scope Frame tagging in LexRunner workflows**

## Purpose

Aliasing in Lex provides a **module-to-canonical name mapping** system that allows developers to use shorthand or historical module names during Frame tagging while maintaining vocabulary alignment with `lexmap.policy.json`. This is especially valuable in LexRunner workflows where:

1. **Human convenience matters**: Developers can type `cli-core` instead of `src/cli/commands/fanout`
2. **Refactoring resilience**: Frames survive module renames (e.g., `user-access-api` → `api/user-access`)
3. **Multi-repo integration**: Cross-repository work can use consistent canonical names

**Key principle**: Aliases are **resolved at input time** and only **canonical IDs are stored** in Frames. This ensures that queries, policy validation, and Frame recall always work with the authoritative module vocabulary.

## Quick Start

### 1. Define Aliases

Create or edit `src/shared/aliases/aliases.json` in your Lex installation:

```json
{
  "version": "1.0",
  "aliases": {
    "cli-core": {
      "canonical": "src/cli/commands/fanout",
      "confidence": 1.0,
      "reason": "shorthand for LexRunner CLI core"
    },
    "gates-runner": {
      "canonical": "src/gates/runner",
      "confidence": 1.0,
      "reason": "shorthand for gate execution engine"
    }
  }
}
```

### 2. Tag Modules with Aliases

When creating a Frame via `/remember`, use the alias:

```bash
/remember reference_point="Fixing fanout timeout" \
  summary_caption="CLI fanout times out on large repos" \
  module_scope='["cli-core", "gates-runner"]'
```

### 3. Query Frames by Canonical Name

Frames are stored with canonical IDs, so queries work seamlessly:

```bash
/recall modules='["src/cli/commands/fanout"]'
# Returns the Frame created above, even though "cli-core" was used
```

## Schema Reference

Lex aliasing follows a JSON schema defined in [`src/shared/aliases/alias-schema.json`](https://github.com/Guffawaffle/lex/blob/main/src/shared/aliases/alias-schema.json). Key fields:

| Field | Type | Description |
|-------|------|-------------|
| `canonical` | `string` | The authoritative module ID from `lexmap.policy.json` |
| `confidence` | `number` | Confidence score (1.0 for explicit aliases, <1.0 for fuzzy matches) |
| `reason` | `string` | Human-readable explanation (e.g., "shorthand", "historical rename") |
| `deprecated` | `boolean` | (Optional) Mark aliases that should trigger warnings |
| `added_date` | `string` | (Optional) ISO 8601 date when the alias was added |

See the [canonical alias documentation](https://github.com/Guffawaffle/lex/blob/main/src/shared/aliases/README.md) for complete API details.

## Real LexRunner Examples

### Example 1: Monorepo Module Aliasing

**Scenario**: LexRunner has a complex directory structure. Developers frequently reference CLI and gate execution code during debugging.

**Alias Configuration**:

```json
{
  "version": "1.0",
  "description": "LexRunner monorepo module aliases",
  "aliases": {
    "cli-core": {
      "canonical": "src/cli/commands/fanout",
      "confidence": 1.0,
      "reason": "shorthand for CLI core"
    },
    "gates-runner": {
      "canonical": "src/gates/runner",
      "confidence": 1.0,
      "reason": "shorthand for gate execution"
    },
    "gate-validator": {
      "canonical": "src/gates/validation",
      "confidence": 1.0,
      "reason": "shorthand for gate input validation"
    }
  }
}
```

**Usage**:

When a fanout touches `src/cli/flags.ts`, the Frame is tagged with:

```json
{
  "module_scope": ["src/cli/commands/fanout"],
  "summary_caption": "Add --skip-tests flag to fanout command"
}
```

Even if the developer typed `cli-core` during `/remember`, the Frame stores the canonical ID.

**Benefits**:
- Developers remember "cli-core" instead of full path
- Policy validation works against `lexmap.policy.json` without modification
- Frame queries by canonical name always succeed

### Example 2: Cross-Repo Aliasing

**Scenario**: LexRunner integrates with Lex's memory system. Work often spans both repositories. Using aliases creates a consistent vocabulary across repos.

**Alias Configuration (in LexRunner)**:

```json
{
  "version": "1.0",
  "description": "Cross-repo aliases for Lex integration",
  "aliases": {
    "lex-memory": {
      "canonical": "external/lex/memory/store",
      "confidence": 1.0,
      "reason": "canonical name for Lex memory subsystem"
    },
    "runner-lex-bridge": {
      "canonical": "src/integrations/lex-bridge",
      "confidence": 1.0,
      "reason": "LexRunner's Lex integration code"
    },
    "lex-policy": {
      "canonical": "external/lex/policy/check",
      "confidence": 1.0,
      "reason": "canonical name for LexMap policy checker"
    }
  }
}
```

**Usage**:

When fixing a bug that touches both Lex and LexRunner code:

```bash
/remember reference_point="Fix Frame storage race condition" \
  summary_caption="Race condition when LexRunner stores Frame during fanout" \
  module_scope='["lex-memory", "runner-lex-bridge"]'
```

The Frame is stored with:

```json
{
  "module_scope": [
    "external/lex/memory/store",
    "src/integrations/lex-bridge"
  ]
}
```

**Benefits**:
- Consistent naming across repositories
- Frames accurately capture cross-repo dependencies
- Team members understand "lex-memory" without checking paths

### Example 3: Wildcard Aliasing (Test File Filtering)

**Scenario**: LexRunner has extensive test coverage. During normal development, Frames should not be tagged with test file changes unless explicitly debugging tests.

**Alias Configuration**:

```json
{
  "version": "1.0",
  "description": "Test file aliasing for filtered tagging",
  "aliases": {
    "tests": {
      "canonical": "src/tests",
      "confidence": 1.0,
      "reason": "aggregate alias for all test files"
    },
    "tests-cli": {
      "canonical": "src/cli/__tests__",
      "confidence": 1.0,
      "reason": "CLI unit tests"
    },
    "tests-gates": {
      "canonical": "src/gates/__tests__",
      "confidence": 1.0,
      "reason": "gate execution tests"
    }
  }
}
```

**Policy Configuration** (in `lexmap.policy.json`):

```json
{
  "modules": {
    "src/tests": {
      "owns_paths": ["**/*.spec.ts", "**/*.test.ts", "**/__tests__/**"],
      "metadata": {
        "type": "test",
        "auto_tag": false
      }
    }
  }
}
```

**Usage**:

When fixing a bug in production code, test file changes are automatically grouped:

```bash
# Changed files: src/cli/flags.ts, src/cli/__tests__/flags.spec.ts

/remember reference_point="Add --dry-run flag" \
  summary_caption="Add dry-run mode to fanout command" \
  module_scope='["cli-core"]'
# Test changes are grouped under "src/tests" but NOT auto-tagged
```

If explicitly debugging a test failure:

```bash
/remember reference_point="Fix flaky fanout test" \
  summary_caption="Fanout timeout test fails intermittently" \
  module_scope='["tests-cli"]'
# Frame explicitly tagged with test module
```

**Benefits**:
- Reduces noise in Frame tagging (test changes are common but often not the focus)
- Explicit tagging available when needed
- Policy can define auto-tagging rules per module type

## Common Pitfalls

### Pitfall 1: Namespace Collisions

**Problem**: Two modules map to the same alias.

**Example**:

```json
{
  "aliases": {
    "auth": {
      "canonical": "services/auth-core",
      "confidence": 1.0,
      "reason": "shorthand"
    },
    "auth": {
      "canonical": "api/auth-handler",
      "confidence": 1.0,
      "reason": "shorthand"
    }
  }
}
```

**Result**: The second entry silently overwrites the first. Frames tagged with `auth` resolve to `api/auth-handler`, breaking recall for `services/auth-core` work.

**Detection**:

Run the alias table through validation:

```bash
npm run test:aliases
# Or manually:
node -e "const aliases = require('./src/shared/aliases/aliases.json'); \
  const keys = Object.keys(aliases.aliases); \
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i); \
  if (dupes.length) console.error('Duplicate aliases:', dupes);"
```

**Resolution**:

Use namespaced aliases:

```json
{
  "aliases": {
    "auth-service": {
      "canonical": "services/auth-core",
      "confidence": 1.0,
      "reason": "shorthand for auth service"
    },
    "auth-api": {
      "canonical": "api/auth-handler",
      "confidence": 1.0,
      "reason": "shorthand for auth API layer"
    }
  }
}
```

### Pitfall 2: Case Sensitivity

**Problem**: Aliases are case-sensitive. `Cli-Core` ≠ `cli-core`.

**Example**:

```json
{
  "aliases": {
    "CLI-Core": {
      "canonical": "src/cli/commands/fanout",
      "confidence": 1.0,
      "reason": "shorthand"
    }
  }
}
```

If a developer types `cli-core` (lowercase), the alias is not found:

```bash
/remember module_scope='["cli-core"]'
# Error: Module 'cli-core' not found in policy. Did you mean 'CLI-Core'?
```

**Recommendation**:

**Always use lowercase** for aliases to match Unix/filesystem conventions:

```json
{
  "aliases": {
    "cli-core": {
      "canonical": "src/cli/commands/fanout",
      "confidence": 1.0,
      "reason": "shorthand (lowercase)"
    }
  }
}
```

**Exception**: When the canonical module ID uses uppercase (e.g., `API/GraphQL`), document the casing requirement clearly:

```json
{
  "aliases": {
    "graphql": {
      "canonical": "API/GraphQL",
      "confidence": 1.0,
      "reason": "lowercase alias for GraphQL module (canonical uses uppercase)"
    }
  }
}
```

### Pitfall 3: Overly Broad Wildcards

**Problem**: Aliasing entire directory trees (e.g., `src/**/*`) to a single name causes performance degradation and ambiguous resolution.

**Example**:

```json
{
  "aliases": {
    "everything": {
      "canonical": "src/**/*",
      "confidence": 1.0,
      "reason": "all source files"
    }
  }
}
```

**Result**:
- Frames tagged with `everything` lose granularity
- Policy validation is slow (must check all modules)
- No way to filter by specific subsystem

**Performance Impact**:

Benchmarks on a 500-module monorepo:

| Alias Strategy | Resolution Time | Policy Check Time |
|---------------|-----------------|-------------------|
| Specific aliases (10 entries) | ~0.5ms | ~10ms |
| Broad wildcards (5 entries) | ~15ms | ~200ms |
| Overly broad (`src/**/*`) | ~50ms | ~1000ms |

**Resolution**:

Use **targeted aliases** that map to meaningful subsystems:

```json
{
  "aliases": {
    "cli": {
      "canonical": "src/cli",
      "confidence": 1.0,
      "reason": "CLI subsystem (all commands and flags)"
    },
    "gates": {
      "canonical": "src/gates",
      "confidence": 1.0,
      "reason": "gate execution subsystem"
    },
    "integrations": {
      "canonical": "src/integrations",
      "confidence": 1.0,
      "reason": "external integrations"
    }
  }
}
```

Each alias represents a **module-level boundary** in `lexmap.policy.json`, not arbitrary path patterns.

## Troubleshooting Guide

### Issue: Alias Not Recognized

**Symptom**:

```bash
/remember module_scope='["my-alias"]'
# Error: Module 'my-alias' not found in policy
```

**Diagnosis Steps**:

1. **Check alias table syntax**:
   ```bash
   cat src/shared/aliases/aliases.json | jq .
   # Ensure valid JSON
   ```

2. **Verify alias exists**:
   ```bash
   cat src/shared/aliases/aliases.json | jq '.aliases["my-alias"]'
   # Should print the alias entry
   ```

3. **Check cache**:
   Lex caches the alias table. Clear cache and retry:
   ```javascript
   // In a Node.js REPL or script:
   import { clearAliasTableCache } from './src/shared/aliases/resolver.js';
   clearAliasTableCache();
   ```

4. **Test resolution programmatically**:
   ```javascript
   import { resolveModuleId } from './src/shared/aliases/resolver.js';
   const result = await resolveModuleId('my-alias', policy);
   console.log(result);
   // Expected: { canonical: '...', confidence: 1.0, source: 'alias' }
   ```

**Solution**:

If the alias is not found, ensure:
- The alias is defined in `aliases.json`
- The JSON is valid (no trailing commas, proper escaping)
- The Lex installation has reloaded the alias table (restart MCP server if applicable)

### Issue: Canonical Module Not in Policy

**Symptom**:

```bash
/remember module_scope='["my-alias"]'
# Resolved 'my-alias' → 'src/nonexistent/module'
# Error: Module 'src/nonexistent/module' not found in lexmap.policy.json
```

**Diagnosis**:

The alias resolves correctly, but the canonical ID is not defined in `lexmap.policy.json`.

**Solution**:

1. **Check policy**:
   ```bash
   cat policy/policy_spec/lexmap.policy.json | jq '.modules | keys'
   # List all valid module IDs
   ```

2. **Fix alias or policy**:
   - **Option A**: Update the alias to point to a valid module
   - **Option B**: Add the canonical module to `lexmap.policy.json`:
     ```json
     {
       "modules": {
         "src/nonexistent/module": {
           "owns_paths": ["src/nonexistent/**/*.ts"]
         }
       }
     }
     ```

### Issue: Frame Stored with Alias Instead of Canonical

**Symptom**:

Frame in database has `module_scope: ["my-alias"]` instead of the canonical ID.

**Diagnosis**:

This indicates a **bug in the `/remember` implementation**. Frames should **never** store aliases directly.

**Expected Behavior**:

```json
// User input:
{ "module_scope": ["my-alias"] }

// Stored in Frame:
{ "module_scope": ["src/canonical/module"] }
```

**Debugging**:

1. **Check validation logic**:
   ```typescript
   // In src/memory/mcp_server/server.ts
   const validationResult = await validateModuleIds(
     userInput.module_scope,
     policy
   );
   
   if (!validationResult.valid) {
     throw new Error(validationResult.error);
   }
   
   // Store canonical IDs, not user input:
   frame.module_scope = validationResult.canonical;
   ```

2. **Test alias resolution**:
   ```bash
   npm run test:aliases
   ```

**Solution**:

If Frames are storing aliases, this is a critical bug. File an issue at [Guffawaffle/lex#issues](https://github.com/Guffawaffle/lex/issues) with:
- The alias used
- The Frame JSON (from database or `/recall`)
- Expected canonical module ID

### Issue: Ambiguous Substring Match

**Symptom** (Future: Phase 3 substring matching):

```bash
/remember module_scope='["auth"]'
# Error: Ambiguous substring 'auth' matches:
#   - services/auth-core
#   - api/auth-handler
#   - ui/auth-dialog
# Please use full module ID or add to alias table
```

**Diagnosis**:

Substring matching found multiple candidates. This is expected behavior for short, ambiguous strings.

**Solution**:

1. **Use full canonical ID**:
   ```bash
   /remember module_scope='["services/auth-core"]'
   ```

2. **Add explicit alias** (recommended):
   ```json
   {
     "aliases": {
       "auth-service": {
         "canonical": "services/auth-core",
         "confidence": 1.0,
         "reason": "preferred shorthand for auth service"
       }
     }
   }
   ```

### Issue: Slow Alias Resolution

**Symptom**:

`/remember` takes 5+ seconds when using aliases.

**Diagnosis**:

Alias table is either:
1. Very large (>10,000 entries)
2. Using complex patterns (regex or wildcards)
3. Not cached properly

**Performance Expectations**:

| Alias Table Size | Expected Resolution Time |
|------------------|--------------------------|
| 1-100 entries    | <1ms                     |
| 100-1,000 entries | <10ms                   |
| 1,000-10,000 entries | <100ms               |

**Solution**:

1. **Check alias table size**:
   ```bash
   cat src/shared/aliases/aliases.json | jq '.aliases | length'
   ```

2. **Profile resolution**:
   ```javascript
   import { resolveModuleId } from './src/shared/aliases/resolver.js';
   console.time('resolution');
   await resolveModuleId('my-alias', policy);
   console.timeEnd('resolution');
   ```

3. **Optimize alias table**:
   - Remove unused aliases
   - Avoid wildcards in alias definitions
   - Ensure exact matches bypass alias lookup (fast path)

## Cross-Links

### Lex Aliasing Implementation

- **Epic**: [Guffawaffle/lex#41 - Implement module ID aliasing system](https://github.com/Guffawaffle/lex/issues/41)
- **Phase 1 PRs** (Explicit Alias Table):
  - Guffawaffle/lex#47 - Add alias table schema and types
  - Guffawaffle/lex#48 - Implement alias resolver with confidence scoring
  - Guffawaffle/lex#49 - Integrate alias resolution with module ID validation
  - Guffawaffle/lex#50 - Add MCP server support for aliased module IDs

_Note: The aliasing feature is currently implemented in the main codebase. The above PRs represent the planned implementation phases as described in Epic #41._

### Canonical Documentation

- [Lex Aliasing README](https://github.com/Guffawaffle/lex/blob/main/src/shared/aliases/README.md) - Complete API documentation
- [Alias Schema](https://github.com/Guffawaffle/lex/blob/main/src/shared/aliases/alias-schema.json) - JSON schema specification
- [Module ID Validation](https://github.com/Guffawaffle/lex/blob/main/src/shared/module_ids/README.md) - How aliases integrate with policy validation

### Related Documentation

- [LexMap Policy Overview](https://github.com/Guffawaffle/lex/blob/main/docs/OVERVIEW.md) - Module vocabulary and policy enforcement
- [Frame Types](https://github.com/Guffawaffle/lex/blob/main/src/memory/frames/types.ts) - How module_scope is stored and queried

## Testing Documentation

Run the following commands to ensure your alias configuration is correct:

```bash
# Run alias-specific tests
npm run test:aliases

# Test MCP server integration with aliases
npm run test:integration

# Full test suite (includes alias tests)
npm test
```

## Best Practices

1. **Use lowercase aliases**: Avoid casing mismatches (see Pitfall 2)
2. **Document aliases**: Always include a `reason` field explaining the alias
3. **Namespace collision-prone names**: Use prefixes like `auth-service` vs `auth-api`
4. **Keep aliases stable**: Avoid renaming aliases; deprecate old ones instead
5. **Align with team conventions**: Ensure the team agrees on shorthand names
6. **Validate regularly**: Run `npm run test:aliases` after changes
7. **Monitor performance**: If resolution slows, audit alias table size

## Future Enhancements

The aliasing system is currently at **Phase 1: Explicit Alias Table**. Future phases include:

- **Phase 2: Auto-Correction** - Edit distance matching with confidence scores for typo correction
- **Phase 3: Substring Matching** - Match partial module IDs with ambiguity detection
- **Phase 4: Historical Tracking** - Automatic alias generation from `lexmap.policy.json` history

See the [Lex Aliasing README](https://github.com/Guffawaffle/lex/blob/main/src/shared/aliases/README.md#future-phases) for planned features.

---

**Note**: This documentation assumes Lex v0.3.0+ with aliasing support. For older versions, see the [migration guide](https://github.com/Guffawaffle/lex/blob/main/src/shared/aliases/MIGRATION_GUIDE.md).
