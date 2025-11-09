#!/usr/bin/env bash
set -euo pipefail

# Example: Generate project using lex-pr create-project

echo "=== lex-pr create-project Example ==="
echo ""
echo "This script demonstrates the 'lex-pr create-project' command."
echo ""

# Parse arguments
DRY_RUN=""
SPEC_FILE="${1:-}"

if [[ "${SPEC_FILE}" == "--dry-run" ]] || [[ "${2:-}" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
  echo "Running in DRY RUN mode (no GitHub Issue creation)"
  echo ""
fi

# Check if we're in the repo root
if [[ ! -f "package.json" ]]; then
  echo "Error: Must run from repository root"
  exit 1
fi

# Check if dist/cli.js exists
if [[ ! -f "dist/cli.js" ]]; then
  echo "Error: dist/cli.js not found. Please run 'npm run build' first."
  exit 1
fi

# Use provided spec file or look for example
if [[ -z "${SPEC_FILE}" ]] || [[ "${SPEC_FILE}" == "--dry-run" ]]; then
  SPEC_FILE="examples/front-end-capture-pipeline/idea-dark-mode.json"
  
  if [[ ! -f "${SPEC_FILE}" ]]; then
    echo "Error: Example spec file not found: ${SPEC_FILE}"
    echo ""
    echo "Usage: $0 [<spec-file>] [--dry-run]"
    echo ""
    echo "To generate a spec file, run:"
    echo "  ./idea-example.sh"
    exit 1
  fi
  
  echo "Using example spec file: ${SPEC_FILE}"
else
  if [[ ! -f "${SPEC_FILE}" ]]; then
    echo "Error: Spec file not found: ${SPEC_FILE}"
    exit 1
  fi
  echo "Using spec file: ${SPEC_FILE}"
fi

echo ""
echo "Generating project from Feature Spec v0..."
echo ""

# Run lex-pr create-project
node dist/cli.js create-project \
  --spec "${SPEC_FILE}" \
  ${DRY_RUN}

echo ""
echo "✓ Example complete"
echo ""

if [[ -n "${DRY_RUN}" ]]; then
  echo "Next steps:"
  echo "  1. Review the generated Execution Plan v1 in .smartergpt.local/deliverables/_session/"
  echo "  2. Run without --dry-run to create GitHub Epic + Sub-Issues"
else
  echo "Execution Plan v1 written to .smartergpt.local/deliverables/_session/"
  echo ""
  echo "GitHub Issues created:"
  echo "  - Epic Issue"
  echo "  - Sub-Issue (feature)"
  echo "  - Sub-Issue (testing)"
  echo "  - Sub-Issue (docs)"
fi

echo ""
