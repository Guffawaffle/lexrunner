#!/usr/bin/env bash
# recall-context.sh
# Thin wrapper for Senior Dev executor recall-context phase
#
# Usage: ./recall-context.sh --module <path> | --developer <name> | --pattern | --pr <number>

set -euo pipefail

QUERY_TYPE=""
QUERY=""
LIMIT=10

show_usage() {
  echo "Usage: $0 <query-type> [options]"
  echo ""
  echo "Query Types:"
  echo "  --module <path>      Recall reviews for a module"
  echo "  --developer <name>   Recall reviews by developer"
  echo "  --pattern            Recall pattern library"
  echo "  --pr <number>        Recall reviews for a specific PR"
  echo ""
  echo "Options:"
  echo "  --limit <n>          Maximum frames to return (default: 10)"
}

if [[ $# -eq 0 ]]; then
  show_usage
  exit 1
fi

while [[ $# -gt 0 ]]; do
  case $1 in
    --module)
      QUERY_TYPE="module"
      QUERY="$2"
      shift 2
      ;;
    --developer)
      QUERY_TYPE="developer"
      QUERY="$2"
      shift 2
      ;;
    --pattern)
      QUERY_TYPE="pattern"
      QUERY=""
      shift
      ;;
    --pr)
      QUERY_TYPE="pr"
      QUERY="$2"
      shift 2
      ;;
    --limit)
      LIMIT="$2"
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

if [[ -z "$QUERY_TYPE" ]]; then
  echo "Error: Query type is required"
  show_usage
  exit 1
fi

echo "Recalling context (type: ${QUERY_TYPE}, query: ${QUERY:-'(none)'})..."

# Delegate to the CLI command
if [[ -n "$QUERY" ]]; then
  exec npx lexrunner senior-dev recall-context \
    --type "$QUERY_TYPE" \
    --query "$QUERY" \
    --limit "$LIMIT"
else
  exec npx lexrunner senior-dev recall-context \
    --type "$QUERY_TYPE" \
    --limit "$LIMIT"
fi
