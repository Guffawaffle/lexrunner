# Dockerfile for local CI testing - matches GitHub Actions ubuntu-latest
FROM ubuntu:22.04

# Install base dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js (matching .nvmrc and package.json engines: >=20 <23)
ARG NODE_VERSION=20.18.0
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && node --version \
    && npm --version

# Set working directory
WORKDIR /workspace

# Copy package files first for layer caching
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the code
COPY . .

# Default command runs all CI checks
CMD ["bash", "-c", "set -e && \
    echo '=== Lint ===' && npm run lint && \
    echo '=== Typecheck ===' && npm run typecheck && \
    echo '=== Build ===' && npm run build && \
    echo '=== Tests ===' && npm test && \
    echo '=== CLI Smoke Test ===' && node dist/cli.js --help && \
    echo '✅ All CI checks passed!'"]
