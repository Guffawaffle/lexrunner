#!/usr/bin/env bash
# Local CI testing script - mimics GitHub Actions CI workflow
# Run this before pushing to save GitHub Actions credits

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 Local CI Test - Mimicking GitHub Actions Workflow"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if we're on the right Node version
REQUIRED_NODE="$(cat .nvmrc)"
CURRENT_NODE="$(node --version | cut -d'v' -f2)"

if [[ "$CURRENT_NODE" != "$REQUIRED_NODE"* ]]; then
    echo "⚠️  Warning: Node version mismatch"
    echo "   Required: $REQUIRED_NODE (from .nvmrc)"
    echo "   Current:  $CURRENT_NODE"
    echo "   Run: nvm use"
    echo ""
fi

# Stage 0: Verify Commit Signatures (skip locally - requires GPG setup)
echo "⏭️  Stage 0: Verify Signatures (skipped locally)"
echo ""

# Stage 1: Setup - Install dependencies
echo "📦 Stage 1: Setup"
echo "   Installing dependencies..."
if ! npm ci --quiet; then
    echo "❌ npm ci failed"
    exit 1
fi
echo "   ✅ Dependencies installed"
echo ""

# Stage 2: Lint
echo "🔍 Stage 2: Lint"
echo "   Running lint check..."
if ! npm run lint > /dev/null 2>&1; then
    echo "❌ Lint failed"
    npm run lint
    exit 1
fi
echo "   ✅ Lint passed"
echo ""

# Stage 3: Typecheck
echo "📝 Stage 3: Typecheck"
echo "   Running TypeScript typecheck..."
if ! npm run typecheck > /dev/null 2>&1; then
    echo "❌ Typecheck failed"
    npm run typecheck
    exit 1
fi
echo "   ✅ Typecheck passed"
echo ""

# Stage 4: Build
echo "🔨 Stage 4: Build"
echo "   Building project..."
if ! npm run build > /dev/null 2>&1; then
    echo "❌ Build failed"
    npm run build
    exit 1
fi
echo "   ✅ Build passed"
echo ""

# Stage 5: Tests
echo "🧪 Stage 5: Tests"
echo "   Running test suite..."
TEST_OUTPUT=$(mktemp)
if ! npm test > "$TEST_OUTPUT" 2>&1; then
    echo "❌ Tests failed"
    echo ""
    echo "Test output (last 100 lines):"
    tail -100 "$TEST_OUTPUT"
    rm "$TEST_OUTPUT"
    exit 1
fi

# Extract summary
SUMMARY=$(tail -20 "$TEST_OUTPUT" | grep -E "Test Files|Tests" || echo "Could not parse test summary")
echo "   $SUMMARY"
rm "$TEST_OUTPUT"
echo "   ✅ Tests passed"
echo ""

# Stage 6: CLI Smoke Test
echo "💨 Stage 6: CLI Smoke Test"
echo "   Testing CLI --help..."
if ! node dist/cli.js --help > /dev/null 2>&1; then
    echo "❌ CLI smoke test failed"
    exit 1
fi
echo "   ✅ CLI smoke test passed"
echo ""

# Stage 7: Determinism Check (expensive - optional)
if [[ "${RUN_DETERMINISM:-false}" == "true" ]]; then
    echo "🎯 Stage 7: Determinism Check"
    echo "   Running format..."
    npm run format > /dev/null 2>&1

    echo "   Checking for uncommitted changes..."
    if ! git diff --exit-code > /dev/null 2>&1; then
        echo "❌ Repository is not clean after build and format"
        echo "   The following files have changes:"
        git diff --name-only
        echo ""
        echo "   Please run 'npm run build && npm run format' and commit the changes."
        exit 1
    fi
    echo "   ✅ Repository is clean"

    echo "   Testing plan determinism..."
    rm -rf .artifactsA .artifactsB
    node dist/cli.js plan --out .artifactsA > /dev/null 2>&1
    node dist/cli.js plan --out .artifactsB > /dev/null 2>&1

    if ! diff -q .artifactsA/plan.json .artifactsB/plan.json > /dev/null 2>&1; then
        echo "❌ Plan output is not deterministic"
        diff -u .artifactsA/plan.json .artifactsB/plan.json || true
        exit 1
    fi

    if ! diff -q .artifactsA/snapshot.md .artifactsB/snapshot.md > /dev/null 2>&1; then
        echo "❌ Snapshot output is not deterministic"
        diff -u .artifactsA/snapshot.md .artifactsB/snapshot.md || true
        exit 1
    fi

    rm -rf .artifactsA .artifactsB
    echo "   ✅ Determinism check passed"
    echo ""
else
    echo "⏭️  Stage 7: Determinism Check (skipped - set RUN_DETERMINISM=true to run)"
    echo ""
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All CI checks passed!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Safe to push! 🚀"
echo ""
