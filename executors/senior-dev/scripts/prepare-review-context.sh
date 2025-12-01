#!/usr/bin/env bash
# prepare-review-context.sh
# Thin wrapper for Senior Dev executor prepare-context phase
#
# Usage: ./prepare-review-context.sh <pr_number> [--base-branch <branch>] [--skip-tests] [--skip-lint]

set -euo pipefail

PR_NUMBER="${1:-}"
BASE_BRANCH="main"
SKIP_TESTS=""
SKIP_LINT=""
SKIP_TYPECHECK=""

if [[ -z "$PR_NUMBER" ]]; then
  echo "Usage: $0 <pr_number> [options]"
  echo ""
  echo "Options:"
  echo "  --base-branch <branch>  Base branch for diff (default: main)"
  echo "  --skip-tests            Skip running tests"
  echo "  --skip-lint             Skip running lint"
  echo "  --skip-typecheck        Skip running typecheck"
  exit 1
fi

shift

while [[ $# -gt 0 ]]; do
  case $1 in
    --base-branch)
      BASE_BRANCH="$2"
      shift 2
      ;;
    --skip-tests)
      SKIP_TESTS="--skip-tests"
      shift
      ;;
    --skip-lint)
      SKIP_LINT="--skip-lint"
      shift
      ;;
    --skip-typecheck)
      SKIP_TYPECHECK="--skip-typecheck"
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

echo "Preparing review context for PR #${PR_NUMBER}..."

# Delegate to the CLI command
exec npx lexrunner senior-dev prepare-context \
  --pr "$PR_NUMBER" \
  --base-branch "$BASE_BRANCH" \
  $SKIP_TESTS \
  $SKIP_LINT \
  $SKIP_TYPECHECK
