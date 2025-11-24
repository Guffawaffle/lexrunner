# Local CI Testing

Save GitHub Actions credits by testing CI locally before pushing.

## Quick Start

```bash
# Docker-based CI (recommended - exact GitHub Actions environment)
npm run ci:docker

# Local bash-based CI (faster)
npm run ci:local
```

## Docker CI (Recommended)

Runs checks in exact GitHub Actions `ubuntu-latest` environment:

```bash
npm run ci:docker
```

**Checks:**
1. Lint (TypeScript compilation)
2. Typecheck
3. Build
4. Tests
5. CLI smoke test

## Local CI (Faster)

Runs checks on your local machine:

```bash
npm run ci:local

# With determinism check:
RUN_DETERMINISM=true npm run ci:local
```

## Cost Savings

- GitHub Actions: ~$0.008/minute
- Typical CI run: 3-5 minutes
- **Saves $0.024-$0.040 per push**
- **Protects free tier quota (2,000 min/month)**

## Files

- `docker-ci.sh` - Docker-based CI
- `test-ci-local.sh` - Local bash CI
- `../ci.Dockerfile` - Docker image (matches GitHub Actions)
