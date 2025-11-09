#!/usr/bin/env bash
set -euo pipefail

# Example: Capture idea using lex-pr idea

echo "=== lex-pr idea Example ==="
echo ""
echo "This script demonstrates the 'lex-pr idea' command."
echo ""

# Parse arguments
DRY_RUN=""
if [[ "${1:-}" == "--dry-run" ]]; then
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

echo "Capturing idea: 'Add dark mode support'"
echo ""

# Run lex-pr idea with example data
node dist/cli.js idea \
  --title "Add dark mode support" \
  --description "Implement theme switcher with light/dark modes" \
  ${DRY_RUN}

echo ""
echo "✓ Example complete"
echo ""

if [[ -n "${DRY_RUN}" ]]; then
  echo "Next steps:"
  echo "  1. Review the generated Feature Spec v0 in .smartergpt.local/deliverables/_session/"
  echo "  2. Run without --dry-run to create a GitHub Issue"
  echo "  3. Use the spec file with 'lex-pr create-project' to generate Epic + Sub-Issues"
else
  echo "Feature Spec v0 written to .smartergpt.local/deliverables/_session/"
  echo ""
  echo "Next steps:"
  echo "  1. Review the generated spec file"
  echo "  2. Use it with 'lex-pr create-project --spec <path>'"
fi

echo ""
