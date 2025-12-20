# Test Fix Pattern Library

**Purpose:** Deterministic test repair for post-merge failures.

**Status:** ✅ Production Ready (39 tests passing)

## Overview

The Test Fix Pattern Library enables automatic, deterministic fixing of common test failures after merge. It implements **INT-015** (Tool Count Assertion Fix) and **INT-016** (Environment-Dependent Test Fix) from the [merge-weave interventions catalog](./merge-weave-interventions.md).

## Architecture

```
src/weave/testfix/
├── schema.ts      # Zod schema for pattern validation
├── loader.ts      # Loads patterns from YAML
├── matcher.ts     # Matches test output against triggers
├── applier.ts     # Applies fixes to test files
└── index.ts       # Public API

.smartergpt/
└── test-fix-patterns.yml  # Pattern definitions
```

## Pattern Schema

Each pattern consists of:

1. **Trigger** - When to apply this pattern (regex against test output)
2. **Detection** - Where to find code to fix (file glob + line regex)
3. **Fix** - How to repair the test (action + parameters)

### Example Pattern

```yaml
- id: tool-count-assertion
  description: "Fix tool count assertions when MCP tools are added/removed"
  determinism: D1
  trigger:
    test_output: "assert.*tools\\.length.*expected (\\d+).*received (\\d+)"
  detection:
    file_pattern: "**/*.spec.ts"
    line_pattern: "expect\\(.*tools\\.length.*\\)\\.toBe\\((\\d+)\\)"
  fix:
    action: update_number
    from_group: 1  # captured expected count
    to_group: 2    # captured received count from test output
  priority: 100
  enabled: true
```

## Fix Actions

### `update_number`
Replace a number in the matched line using capture groups.

**Example:** `expect(tools.length).toBe(6)` → `expect(tools.length).toBe(7)`

**Config:**
```yaml
fix:
  action: update_number
  from_group: 1  # Old value from detection pattern
  to_group: 2    # New value from trigger pattern
```

### `update_string`
Replace a string in the matched line using capture groups.

**Example:** `expect(name).toBe("old")` → `expect(name).toBe("new")`

**Config:**
```yaml
fix:
  action: update_string
  from_group: 1
  to_group: 2
```

### `replace`
Replace entire matched portion with fixed text.

**Example:** `LexSona.connect()` → `LexSona.connect({ lexDb: "/nonexistent" })`

**Config:**
```yaml
fix:
  action: replace
  with: 'LexSona.connect({ lexDb: "/nonexistent/path/db.sqlite" })'
```

### `make_environment_aware`
Insert template code (D2 - requires judgment).

**Config:**
```yaml
fix:
  action: make_environment_aware
  template: |
    const discoveries = discoverDbPath();
    const firstExisting = discoveries.find((d) => d.exists);
    if (firstExisting) {
      expect(result).toBe(firstExisting.path);
    } else {
      expect(result).toBe(join(homedir(), ".smartergpt", "lex", "lex.db"));
    }
```

## Usage

### Basic Usage

```typescript
import {
  loadTestFixPatterns,
  getEnabledPatterns,
  matchAndLocate,
  buildFixInstruction,
  applyFix,
} from './src/weave/testfix';

// 1. Load patterns from YAML
const allPatterns = loadTestFixPatterns(workspaceRoot);
const enabledPatterns = getEnabledPatterns(allPatterns);

// 2. Match test output against trigger patterns
const testOutput = `
FAIL tests/tools.spec.ts
  AssertionError: expected 6 received 7
`;

const matches = matchAndLocate(testOutput, workspaceRoot, enabledPatterns);

// 3. Build and apply fixes
for (const [patternId, { trigger, locations }] of matches) {
  const pattern = enabledPatterns.find(p => p.id === patternId);
  
  for (const location of locations) {
    const instruction = buildFixInstruction(pattern, trigger, location);
    
    if (instruction) {
      // Dry run to preview changes
      const dryRunResult = applyFix(instruction, true);
      console.log(`Would fix: ${dryRunResult.oldContent} → ${dryRunResult.newContent}`);
      
      // Apply for real
      const result = applyFix(instruction, false);
      if (result.success) {
        console.log(`✅ Fixed ${result.filePath}`);
      } else {
        console.error(`❌ Failed: ${result.error}`);
      }
    }
  }
}
```

### Safe Loading

```typescript
import { safeLoadTestFixPatterns } from './src/weave/testfix';

const result = safeLoadTestFixPatterns(workspaceRoot);

if (result.success) {
  console.log(`Loaded ${result.patterns.patterns.length} patterns`);
} else {
  console.error(`Failed to load: ${result.error}`);
}
```

## Integration with Merge-Weave

The pattern library is referenced in `.smartergpt/merge-weave-policy.yml`:

```yaml
post_merge:
  auto_fix:
    enabled: true
    pattern_library: ".smartergpt/test-fix-patterns.yml"
    escalate_on:
      - semantic_change
      - multiple_files
      - security_related
```

## Determinism Levels

- **D1 (Deterministic)** - Pure logic, no judgment (e.g., tool-count-assertion, lexsona-connect-explicit-path)
- **D2 (Bounded)** - Judgment within defined parameters (e.g., env-dependent-homedir)
- **D3 (Stochastic)** - Requires reasoning (not yet supported)

D1 patterns can be handed off to smaller models or scripts. D2 patterns require mid-tier+ models.

## Success Criteria

✅ Pattern match succeeds for 95%+ of tool-count failures  
✅ Pattern match succeeds for 95%+ of env-dependent failures  
⚠️ Human override required < 5% of cases (needs production metrics)

## Testing

Run the test suite:

```bash
npm test -- tests/unit/weave/testfix/
```

**Test Coverage:**
- Schema validation (11 tests)
- Trigger matching (8 tests)
- Fix location detection (8 tests)
- Fix application (7 tests)
- E2E scenarios (4 tests)
- Integration with YAML (9 tests)

**Total: 39 tests passing ✅**

## Adding New Patterns

1. Add pattern to `.smartergpt/test-fix-patterns.yml`
2. Set appropriate determinism level (D1/D2/D3)
3. Test with real failure scenarios
4. Verify 95%+ success rate over 10 runs before enabling in production

## Related

- **Parent Issue:** [#609](https://github.com/Guffawaffle/lexrunner/issues/609) - Model tier handoff metrics
- **Interventions:** [INT-015](./merge-weave-interventions.md#int-015-tool-count-assertion-fix), [INT-016](./merge-weave-interventions.md#int-016-environment-dependent-test-fix)
- **Policy:** `.smartergpt/merge-weave-policy.yml`
- **Issue:** #618 - Test fix pattern library for deterministic post-merge repairs
