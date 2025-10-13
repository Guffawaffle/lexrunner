# FAQ — lex-pr-runner

Quick answers to common questions. See `docs/README.md` for the full documentation index.

## What is lex-pr-runner?

A deterministic CLI that fans out tasks as many PRs, computes a merge pyramid (dependency order), runs gates uniformly (lint/type/test/etc.), and merges cleanly.

## Where does the runner read inputs from?

At integration time, only from a single frozen `plan.json` (Schema v1). See `docs/schemas.md` and `src/schema.ts`.

## What’s the difference between `src/**` and `.smartergpt/**`?

- `src/**`: Core runner (stateless, packageable). Never stores user/work artifacts.
- `.smartergpt/**`: Portable example profile for humans/agents. Not read at runtime by the runner.

## How do I generate a plan?

Use GitHub discovery and plan commands:
- `npm run cli -- discover --json`
- `npm run cli -- plan --from-github --json > plan.json`

## How do I run gates locally and in CI?

`npm run cli -- execute plan.json` — the same semantics apply in both places. See `docs/cli.md` and `docs/gate-report-examples.md`.

## Are outputs deterministic?

Yes. We sort items and keys for stable diffs. The determinism check is described in `AGENTS.md`.

## How do I scan for secrets or vulnerabilities?

Security subcommands:
- `lex-pr security scan-plan plan.json`
- `lex-pr security check-rotation GITHUB_TOKEN --max-age 90`
- `lex-pr security validate-secrets GITHUB_TOKEN DATABASE_URL`

See `docs/SECURITY_IMPLEMENTATION.md`.

## Do you support SARIF ingestion for a vulnerability gate?

The security scanning service is present (`src/security/scanning.ts`) and a SARIF-backed "vuln" gate is on the roadmap (Issue #129). Until then, you can run npm audit locally and enforce thresholds via policy.

## How do I contribute?

See `CONTRIBUTING.md`. Keep PRs small and deterministic. Include a "How to verify" section.
