#!/usr/bin/env bash
# Docker-based CI testing - matches GitHub Actions environment exactly
# Run this before pushing to save GitHub Actions credits

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🐳 Docker CI Test - Exact GitHub Actions Environment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed or not in PATH"
    echo "   Install Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# Build the CI image
echo "📦 Building CI Docker image..."
if docker build -f ci.Dockerfile -t lex-pr-runner-ci:local . > /dev/null 2>&1; then
    echo "✅ Docker image built successfully"
else
    echo "❌ Docker build failed"
    docker build -f ci.Dockerfile -t lex-pr-runner-ci:local .
    exit 1
fi
echo ""

# Run CI checks in container
echo "🧪 Running CI checks in Docker container..."
echo ""

if docker run --rm \
    -e TZ=UTC \
    -e LANG=en_US.UTF-8 \
    -e LC_ALL=en_US.UTF-8 \
    lex-pr-runner-ci:local; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✅ All Docker CI checks passed!"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Safe to push! 🚀"
    echo ""
else
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "❌ Docker CI checks failed"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Fix the errors above before pushing."
    echo ""
    exit 1
fi
