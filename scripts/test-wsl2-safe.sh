#!/bin/bash
# WSL2-safe test runner
# Runs tests in small batches to avoid overwhelming the file system

set -e

echo "🧪 Running WSL2-safe test batches..."
echo ""

# Run non-git tests first (safest)
echo "📦 Batch 1: Schema and parsing tests"
npx vitest run tests/schema.spec.ts tests/plan-*.spec.ts tests/policy*.spec.ts tests/gates/schema.spec.ts

# Run git tests in isolation
echo "📦 Batch 2: Git operation tests"
npx vitest run tests/merge-*.spec.ts tests/preflightConflicts.spec.ts tests/gates/operations.spec.ts

# Run CLI tests (moderate risk)
echo "📦 Batch 3: CLI tests"
npx vitest run tests/cli-*.spec.ts tests/init.spec.ts

# Skip E2E tests that spawn many child processes
echo "⏭️  Skipping autopilot E2E tests (use CI for full validation)"
echo ""
echo "✅ WSL2-safe test batches complete"
