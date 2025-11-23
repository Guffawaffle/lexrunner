# WSL2 Test Execution Guide

## Problem

Running the full test suite with `npm test` in WSL2 can crash the VS Code Remote-WSL server due to:

1. **Excessive child process spawning** - Tests use `execSync` and `exec` heavily
2. **Rapid temp directory churn** - Many tests create/destroy temp dirs with `mkdtempSync`
3. **File system watchers** - Git operations trigger inotify events that overwhelm WSL2

## Solutions

### Option 1: Use Batch Script (Recommended for WSL2)

```bash
./scripts/test-wsl2-safe.sh
```

This runs tests in small, isolated batches that won't overwhelm the file system.

### Option 2: Run Specific Test Files

```bash
# Run only non-git tests
npx vitest run tests/schema.spec.ts

# Run specific test suites
npx vitest run tests/cli-*.spec.ts
```

### Option 3: Use CI

Push to a branch and let GitHub Actions run the full suite in a native Linux environment.

## Configuration Changes

**`vitest.config.ts`** has been configured for WSL2 safety:

- `pool: 'threads'` - Use threads instead of forks (fewer processes)
- `maxThreads: 4` - Limit concurrency to reduce file system pressure
- `testTimeout: 15000` - Account for WSL2 file system latency
- `hookTimeout: 15000` - Prevent timeouts during cleanup

## Test Helpers

**`tests/helpers/wsl2-safe-cleanup.ts`** provides:

- `safeRmSync()` - Robust directory removal with retries
- `safeMkdirSync()` - Idempotent directory creation

These helpers handle WSL2's slow/inconsistent file system operations gracefully.

## What Tests to Skip Locally

In WSL2, avoid running locally:

- `tests/autopilot-e2e-level3-4.spec.ts` - Spawns many git child processes
- `tests/e2e-comprehensive.test.ts` - Creates many temp repos
- `tests/deterministic-build.test.ts` - Runs build commands repeatedly

These are safe to run in CI where the file system is more robust.
