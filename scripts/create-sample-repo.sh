#!/bin/bash
# Sample Repository Creation Script for Testing lexrunner
# This script creates a minimal test repository with example PRs and dependencies

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_step() {
    echo -e "${BLUE}==>${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

# Default values
REPO_NAME="lex-pr-test-repo"
REPO_DIR="/tmp/${REPO_NAME}"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --name)
            REPO_NAME="$2"
            REPO_DIR="/tmp/${REPO_NAME}"
            shift 2
            ;;
        --dir)
            REPO_DIR="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--name repo-name] [--dir /path/to/repo]"
            exit 1
            ;;
    esac
done

print_step "Creating sample repository at ${REPO_DIR}"

# Clean up if exists
if [ -d "${REPO_DIR}" ]; then
    print_step "Cleaning up existing directory"
    rm -rf "${REPO_DIR}"
fi

# Create directory and initialize git
mkdir -p "${REPO_DIR}"
cd "${REPO_DIR}"

git init
git config user.name "Test User"
git config user.email "test@example.com"

print_success "Git repository initialized"

# Create initial files
print_step "Creating initial files"

# Package.json
cat > package.json <<'EOF'
{
  "name": "sample-project",
  "version": "1.0.0",
  "scripts": {
    "test": "echo \"Running tests...\" && exit 0",
    "lint": "echo \"Running linter...\" && exit 0",
    "typecheck": "echo \"Running type check...\" && exit 0",
    "build": "echo \"Building project...\" && exit 0"
  }
}
EOF

# README
cat > README.md <<'EOF'
# Sample Test Repository

This is a sample repository for testing lexrunner.

## Features
- Feature A: Core functionality
- Feature B: Additional features
- Feature C: Bug fixes

## Testing
Run tests with `npm test`
EOF

# Sample source file
mkdir -p src
cat > src/index.js <<'EOF'
// Main application file
function main() {
    console.log('Hello, World!');
}

main();
EOF

# Commit initial state
git add .
git commit -m "Initial commit: Project setup"
git branch -M main

print_success "Initial files created"

# Create feature branches with different files
print_step "Creating feature branches"

# Feature A - independent
git checkout -b feature-a
cat > src/feature-a.js <<'EOF'
// Feature A implementation
export function featureA() {
    return 'Feature A works!';
}
EOF
git add .
git commit -m "feat: Add feature A

Implements core feature A functionality.

This is an independent feature that can be merged without dependencies."
print_success "Created feature-a branch"

# Feature B - independent
git checkout main
git checkout -b feature-b
cat > src/feature-b.js <<'EOF'
// Feature B implementation
export function featureB() {
    return 'Feature B works!';
}
EOF
git add .
git commit -m "feat: Add feature B

Implements feature B functionality.

This is an independent feature that can be merged without dependencies."
print_success "Created feature-b branch"

# Feature C - depends on feature A
git checkout main
git checkout -b feature-c
cat > src/feature-c.js <<'EOF'
// Feature C implementation (uses feature A)
import { featureA } from './feature-a.js';

export function featureC() {
    featureA();
    return 'Feature C works!';
}
EOF
git add .
git commit -m "feat: Add feature C

Implements feature C that depends on feature A.

Depends-On: feature-a

This feature requires feature A to be merged first."
print_success "Created feature-c branch (depends on feature-a)"

# Bugfix - depends on feature B
git checkout main
git checkout -b bugfix/critical
cat > src/bugfix.js <<'EOF'
// Critical bugfix (requires feature B)
import { featureB } from './feature-b.js';

export function fixCriticalBug() {
    featureB();
    return 'Bug fixed!';
}
EOF
git add .
git commit -m "fix: Critical bug in feature B integration

Fixes critical bug in feature B integration.

Depends-On: feature-b"
print_success "Created bugfix/critical branch (depends on feature-b)"

# Feature D - depends on both C and bugfix
git checkout main
git checkout -b feature-d
cat > src/feature-d.js <<'EOF'
// Feature D implementation (uses C and bugfix)
import { featureC } from './feature-c.js';
import { fixCriticalBug } from './bugfix.js';

export function featureD() {
    featureC();
    fixCriticalBug();
    return 'Feature D works!';
}
EOF
git add .
git commit -m "feat: Add feature D (integration)

Implements feature D that integrates C and bugfix.

Depends-On: feature-c, bugfix/critical

This feature requires both feature-c and bugfix/critical."
print_success "Created feature-d branch (depends on feature-c and bugfix/critical)"

# Return to main
git checkout main

print_success "Repository created successfully!"
echo ""
print_step "Repository structure:"
echo "  Main branch: main"
echo "  Feature branches:"
echo "    - feature-a (independent)"
echo "    - feature-b (independent)"
echo "    - feature-c (depends on: feature-a)"
echo "    - bugfix/critical (depends on: feature-b)"
echo "    - feature-d (depends on: feature-c, bugfix/critical)"
echo ""
print_step "Dependency graph:"
echo "  feature-a ← feature-c ← feature-d"
echo "  feature-b ← bugfix/critical ← feature-d"
echo ""
print_step "Expected merge order:"
echo "  Level 1: [feature-a, feature-b]"
echo "  Level 2: [feature-c, bugfix/critical]"
echo "  Level 3: [feature-d]"
echo ""
print_step "Next steps:"
echo "  1. cd ${REPO_DIR}"
echo "  2. lex-pr init"
echo "  3. lex-pr doctor"
echo "  4. Create deps.yml with the branch dependencies"
echo "  5. lex-pr plan"
echo "  6. lex-pr execute plan.json"
echo ""
print_success "Sample repository ready at: ${REPO_DIR}"
