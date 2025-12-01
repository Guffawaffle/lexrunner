#!/usr/bin/env bash
# capture-review-frame.sh
# Thin wrapper for Senior Dev executor capture-frame phase
#
# Usage: ./capture-review-frame.sh --pr <number> --module <path> --summary <text> --next-action <text> [options]

set -euo pipefail

PR_NUMBER=""
MODULE=""
SUMMARY=""
NEXT_ACTION=""
DEVELOPER=""
SEVERITY="review"
JIRA=""
BLOCKERS=""

show_usage() {
  echo "Usage: $0 --pr <number> --module <path> --summary <text> --next-action <text> [options]"
  echo ""
  echo "Required:"
  echo "  --pr <number>        PR number"
  echo "  --module <path>      Module path"
  echo "  --summary <text>     Review summary"
  echo "  --next-action <text> Next action for the author"
  echo ""
  echo "Options:"
  echo "  --developer <name>   Developer name"
  echo "  --severity <level>   Severity: blocker, must-fix, should-fix, nit, praise, review"
  echo "  --jira <ticket>      JIRA ticket reference"
  echo "  --blockers <list>    Comma-separated list of blockers"
}

if [[ $# -eq 0 ]]; then
  show_usage
  exit 1
fi

while [[ $# -gt 0 ]]; do
  case $1 in
    --pr)
      PR_NUMBER="$2"
      shift 2
      ;;
    --module)
      MODULE="$2"
      shift 2
      ;;
    --summary)
      SUMMARY="$2"
      shift 2
      ;;
    --next-action)
      NEXT_ACTION="$2"
      shift 2
      ;;
    --developer)
      DEVELOPER="$2"
      shift 2
      ;;
    --severity)
      SEVERITY="$2"
      shift 2
      ;;
    --jira)
      JIRA="$2"
      shift 2
      ;;
    --blockers)
      BLOCKERS="$2"
      shift 2
      ;;
    --help|-h)
      show_usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      show_usage
      exit 1
      ;;
  esac
done

# Validate required arguments
if [[ -z "$PR_NUMBER" ]]; then
  echo "Error: --pr is required"
  exit 1
fi

if [[ -z "$MODULE" ]]; then
  echo "Error: --module is required"
  exit 1
fi

if [[ -z "$SUMMARY" ]]; then
  echo "Error: --summary is required"
  exit 1
fi

if [[ -z "$NEXT_ACTION" ]]; then
  echo "Error: --next-action is required"
  exit 1
fi

echo "Capturing review frame for PR #${PR_NUMBER}..."

# Build command
CMD="npx lexrunner senior-dev capture-frame"
CMD="$CMD --pr '$PR_NUMBER'"
CMD="$CMD --module '$MODULE'"
CMD="$CMD --summary '$SUMMARY'"
CMD="$CMD --next-action '$NEXT_ACTION'"
CMD="$CMD --severity '$SEVERITY'"

if [[ -n "$DEVELOPER" ]]; then
  CMD="$CMD --developer '$DEVELOPER'"
fi

if [[ -n "$JIRA" ]]; then
  CMD="$CMD --jira '$JIRA'"
fi

if [[ -n "$BLOCKERS" ]]; then
  CMD="$CMD --blockers '$BLOCKERS'"
fi

# Execute
eval "$CMD"
