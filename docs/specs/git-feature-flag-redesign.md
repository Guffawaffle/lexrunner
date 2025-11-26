# Git Feature Flag Redesign (LEX_GIT_MODE)

**Status:** Implemented  
**Last Updated:** 2025-11-26  
**Related Issue:** [GIT-001](../README.md)

## Overview

This document specifies the runtime gate for git operations in lex-pr-runner. The default runtime in CI and ephemeral environments is "off" to ensure safe, predictable behavior.

## Environment Variables

### `LEX_GIT_MODE`

Controls whether git operations are enabled.

- **Type:** String (`"off"` | `"live"`)
- **Default:** `"off"`
- **Case Sensitivity:** Case-insensitive (e.g., `LIVE`, `Live`, `live` are all valid)

**Behavior:**
| Value | Git Operations | Use Case |
|-------|---------------|----------|
| `off` (default) | Disabled, returns safe fallbacks | CI/CD, ephemeral environments, testing |
| `live` | Enabled, executes actual git commands | Local development, git-dependent workflows |

### `LEX_DEFAULT_BRANCH`

Fallback branch name when git is disabled.

- **Type:** String
- **Default:** `"main"`
- **Used When:** `LEX_GIT_MODE=off` or git commands fail

### `LEX_DEFAULT_COMMIT`

Fallback commit SHA when git is disabled.

- **Type:** String (40-character hex)
- **Default:** `"0000000000000000000000000000000000000000"`
- **Used When:** `LEX_GIT_MODE=off` or git commands fail

## API Reference

The runtime gate is exposed via `src/shared/git/runtime.ts`:

```typescript
import {
  getGitMode,
  isGitEnabled,
  getDefaultBranch,
  getDefaultCommit,
  type GitMode
} from "../shared/git/runtime.js";

// Get current git mode ("off" or "live")
const mode: GitMode = getGitMode();

// Check if git operations are enabled
if (isGitEnabled()) {
  // Perform git operations
}

// Get fallback values when git is disabled
const branch = getDefaultBranch();  // "main" or LEX_DEFAULT_BRANCH
const commit = getDefaultCommit();  // 40 zeros or LEX_DEFAULT_COMMIT
```

## Integration Points

### promptsResolver.ts

The prompt token expansion functions (`getCurrentBranch`, `getCurrentCommit`) consult the runtime gate:

```typescript
// Before (always executed git):
function getCurrentBranch(cwd: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd }).toString().trim();
  } catch {
    return "";
  }
}

// After (respects runtime gate):
function getCurrentBranch(cwd: string): string {
  if (!isGitEnabled()) {
    return getDefaultBranch();
  }
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd }).toString().trim();
  } catch {
    return getDefaultBranch();
  }
}
```

## Usage Examples

### CI/CD Pipeline (Default - Git Disabled)

```yaml
# No LEX_GIT_MODE set → defaults to "off"
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test  # Tests run git-free
```

### Local Development (Git Enabled)

```bash
export LEX_GIT_MODE=live
lex-pr plan  # Git operations work normally
```

### Custom Fallbacks

```bash
export LEX_GIT_MODE=off
export LEX_DEFAULT_BRANCH=develop
export LEX_DEFAULT_COMMIT=abc123def456789012345678901234567890abcd
lex-pr plan  # Uses custom fallback values
```

### Testing with Custom Values

```typescript
describe("My Test", () => {
  beforeEach(() => {
    process.env.LEX_GIT_MODE = "off";
    process.env.LEX_DEFAULT_BRANCH = "test-branch";
  });

  afterEach(() => {
    delete process.env.LEX_GIT_MODE;
    delete process.env.LEX_DEFAULT_BRANCH;
  });

  it("should use fallback branch", () => {
    expect(getDefaultBranch()).toBe("test-branch");
  });
});
```

## Design Decisions

### Default to "off"

The runtime gate defaults to `"off"` because:

1. **CI Safety:** CI environments should not depend on git state by default
2. **Ephemeral Environments:** Containers and serverless functions may not have git
3. **Predictability:** Tests should be deterministic without git
4. **Explicit Opt-in:** Live git requires explicit `LEX_GIT_MODE=live`

### Fallback Values

Safe fallbacks are returned instead of empty strings:

- **Branch:** `"main"` (common default branch name)
- **Commit:** 40 zeros (recognizable as placeholder)

This ensures downstream code can handle the values safely without null checks.

### Case Insensitivity

`LEX_GIT_MODE` is case-insensitive for developer convenience. All of these work:
- `LEX_GIT_MODE=live`
- `LEX_GIT_MODE=LIVE`
- `LEX_GIT_MODE=Live`

## Migration Guide

### From Empty String Fallbacks

If your code previously checked for empty strings:

```typescript
// Before
const branch = getCurrentBranch();
if (branch === "") {
  // Handle no git
}

// After
const branch = getCurrentBranch();
// branch will be "main" (or LEX_DEFAULT_BRANCH) when git is off
```

### Enabling Git in Tests

If tests need actual git operations:

```typescript
beforeEach(() => {
  process.env.LEX_GIT_MODE = "live";
});

afterEach(() => {
  delete process.env.LEX_GIT_MODE;
});
```

## Related Documentation

- [Environment Variables](../environment-variables.md) - Complete environment variable reference
- [CI/CD Integration](../ci-cd-integration.md) - CI/CD platform integration examples

## Changelog

### 2025-11-26

- Initial implementation of `LEX_GIT_MODE` runtime gate
- Added `LEX_DEFAULT_BRANCH` and `LEX_DEFAULT_COMMIT` fallback configuration
- Updated `promptsResolver.ts` to use runtime gate
- Added comprehensive tests in `tests/git-runtime.spec.ts`
