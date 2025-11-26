# Git Feature Flag Redesign

**Version:** 1.0.0
**Status:** Implemented
**Last Updated:** 2025-11-26
**Related Issues:** GIT-001, GIT-002, GIT-003 (under GIT-EPIC #418)

## Overview

This document describes the runtime gate and centralized git wrapper that provides safe defaults for automation and testing environments.

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

## Problem Statement

Direct usage of `execSync`/`spawnSync` for git operations throughout the codebase caused several issues:

1. **GPG signing prompts**: In automation/CI environments, GPG signing could cause interactive prompts that block execution
2. **Inconsistent error handling**: Different modules handled git errors differently
3. **Testing difficulty**: Mocking git operations required complex setup in each test
4. **No dry-run capability**: Testing git-dependent code required actual git repositories

## Solution

Two complementary modules in `src/shared/git/`:

1. **`runtime.ts`** — Runtime gate functions (`isGitEnabled()`, `getGitMode()`, `getDefaultBranch()`, `getDefaultCommit()`)
2. **`runGit.ts`** — Centralized git wrapper with:
   - GPG signing disabled by default (`-c commit.gpgsign=false`)
   - Consistent return type: `{ exitCode, stdout, stderr }`
   - Dry-run mode support via `LEX_GIT_MODE=off`
   - Helper functions for common operations

## API Reference

### Runtime Gate (runtime.ts)

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

### runGit (runGit.ts)

The core wrapper function for executing git commands.

```typescript
import { runGit, GitResult, RunGitOptions } from "../shared/git/runGit.js";

const result: GitResult = runGit(["status", "--short"], {
  cwd: "/path/to/repo",
  timeout: 30000,
  disableGpgSign: true,
  dryRunFallback: { exitCode: 0, stdout: "", stderr: "" }
});

if (result.exitCode === 0) {
  console.log("Output:", result.stdout);
}
```

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `args` | `string[]` | Required | Git command arguments |
| `options.cwd` | `string` | `process.cwd()` | Working directory |
| `options.timeout` | `number` | `30000` | Timeout in milliseconds |
| `options.disableGpgSign` | `boolean` | `true` | Disable GPG signing |
| `options.dryRunFallback` | `GitResult` | `{ exitCode: 0, stdout: "", stderr: "" }` | Return value in dry-run mode |

#### Return Value

```typescript
interface GitResult {
  exitCode: number;  // 0 = success, non-zero = failure
  stdout: string;    // Standard output
  stderr: string;    // Standard error
}
```

### Helper Functions

#### getCurrentBranch

Returns the current git branch name.

```typescript
import { getCurrentBranch } from "../shared/git/runGit.js";

const branch = getCurrentBranch();
// Returns: "main" or "" if not in a git repo
```

#### getCurrentCommit

Returns the current commit SHA.

```typescript
import { getCurrentCommit } from "../shared/git/runGit.js";

const fullSha = getCurrentCommit();
// Returns: "abc1234567890..." (40 chars)

const shortSha = getCurrentCommit(undefined, true);
// Returns: "abc1234" (7 chars)
```

#### getRemoteUrl

Returns the URL of a remote.

```typescript
import { getRemoteUrl } from "../shared/git/runGit.js";

const url = getRemoteUrl();
// Returns: "https://github.com/owner/repo.git"

const upstreamUrl = getRemoteUrl(undefined, "upstream");
// Returns URL of "upstream" remote
```

#### isGitRepository

Checks if a directory is inside a git repository.

```typescript
import { isGitRepository } from "../shared/git/runGit.js";

if (isGitRepository("/path/to/check")) {
  // Inside a git repository
}
```

#### getRepositoryRoot

Returns the root directory of the git repository.

```typescript
import { getRepositoryRoot } from "../shared/git/runGit.js";

const root = getRepositoryRoot();
// Returns: "/home/user/project"
```

## Dry-Run Mode

Set `LEX_GIT_MODE=off` to enable dry-run mode. In this mode:

- All git commands return configured fallback values instead of executing
- Useful for testing git-dependent code without actual git operations
- Each helper function has sensible defaults:
  - `getCurrentBranch()` returns `"main"`
  - `getCurrentCommit()` returns a placeholder SHA
  - `getRemoteUrl()` returns `"https://github.com/example/repo.git"`
  - `isGitRepository()` returns `true`
  - `getRepositoryRoot()` returns `process.cwd()`

### Example Usage

```typescript
// In tests
process.env.LEX_GIT_MODE = "off";

const branch = getCurrentBranch();
// Returns "main" without executing git

const result = runGit(["status"], {
  dryRunFallback: {
    exitCode: 0,
    stdout: "On branch main\nnothing to commit",
    stderr: ""
  }
});
// Returns the custom fallback without executing git
```

### Checking Dry-Run Status

```typescript
import { isGitDryRun } from "../shared/git/runGit.js";

if (isGitDryRun()) {
  console.log("Git commands are in dry-run mode");
}
```

## Migration Guide

### Before (Direct execSync)

```typescript
import { execSync } from "child_process";

function getCurrentBranch(cwd: string): string {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return branch.trim();
  } catch {
    return "";
  }
}
```

### After (Using runGit)

```typescript
import { getCurrentBranch } from "../shared/git/runGit.js";

const branch = getCurrentBranch(cwd);
// Returns branch name or "" if not in a git repo
// Automatically handles errors and supports dry-run mode
```

### Migrating Custom Commands

For commands not covered by helpers:

```typescript
import { runGit } from "../shared/git/runGit.js";

// Before
const output = execSync("git log --oneline -5", { cwd, encoding: "utf8" });

// After
const result = runGit(["log", "--oneline", "-5"], { cwd });
if (result.exitCode === 0) {
  const output = result.stdout;
}
```

## Refactored Modules

The following modules have been updated to use the new wrapper:

1. **`src/config/promptsResolver.ts`**
   - `getCurrentBranch()` → `getGitBranch()` (imported from shared)
   - `getCurrentCommit()` → `getGitCommit()` (imported from shared)

2. **`src/executors/seniorDev/core.ts`**
   - `getCurrentBranch()` → uses imported `getGitBranch()` with "unknown" fallback

## Best Practices

1. **Prefer helper functions** over raw `runGit` for common operations
2. **Use dry-run mode** in unit tests to avoid git dependencies
3. **Provide custom fallbacks** when testing specific scenarios
4. **Keep GPG signing disabled** (`disableGpgSign: true`) in automation
5. **Set appropriate timeouts** for long-running operations

## Testing

Tests are located in `tests/runGit.spec.ts` and cover:

- Basic command execution
- Error handling
- Dry-run mode behavior
- Helper function accuracy
- GPG signing configuration

Run tests with:

```bash
npm test -- tests/runGit.spec.ts
```

## Related Documentation

- [Git Operations (existing)](../../../src/git/operations.ts) - Uses `simple-git` library for complex merge operations
- [Parse Remote](../../../src/git/parseRemote.ts) - Remote URL parsing utilities
