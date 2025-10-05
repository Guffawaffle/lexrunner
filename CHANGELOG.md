# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres (prospectively) to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Autopilot Levels 0–4 with progressive feature set (planning, safety, merge simulation, deliverables, compliance reporting).
- Deliverables management system: manifests, retention policy, symlinked latest, custom directory via `--deliverables-dir`.
- Gate Report JSON Schema (`gate-report.schema.json`) and validation command (`gate-report validate`).
- Security & compliance reporting foundation with signing, integrity verification, and audit artifacts.
- Deterministic plan hashing & reproducibility safeguards (canonical JSON ordering, build determinism check guidance).
- Extensive documentation suite: architecture, CI/CD integration, deliverables management, plan generation, troubleshooting, performance scaling, migration guide.
- New tests: deliverables lifecycle, extended autopilot E2E coverage, gate report schema validation, security compliance scenarios.

### Changed
- CLI autopilot command deduplicated options and removed merge conflict artifacts.
- Standardized exit behavior and error messaging across autopilot and gate validation paths.
- Refined documentation structure; consolidated implementation summary and security sections.

### Fixed
- Resolved merge conflicts in `IMPLEMENTATION_SUMMARY.md` and `src/cli.ts` (duplicate option & duplicate execution call).
- Addressed minor drift in documentation references after feature merges.

### Documentation
- Closed documentation gap (Issue #103) with enriched guides (`docs/*.md`).
- Added detailed deliverables management guide and CI/CD integration examples.
- Updated terminology references aligning with `AGENTS.md` and `TERMS.md`.

### Testing
- Increased total passing tests to 950+ with new suites for deliverables, schema validation, and compliance.
- Added fixtures for plan validation edge cases (cycles, unknown dependencies, invalid schema).

### Security
- Established baseline security verification (integrity signing, audit logs) — sets stage for Phase 2 (Issue #129).

### Deprecated
- Legacy duplicated autopilot CLI logic (removed). No formal deprecations yet.

### Removed
- Merge artifact duplicate `--deliverables-dir` option and redundant `autopilot.execute()` call.

### Internal
- Issue triage and closure: #74 (Autopilot Levels), #90 (Gate Report Schema), #96 (Extended Autopilot), #103 (Documentation) closed.
- Opened follow-up tracking issues: #128 (CLI UX), #129 (Security Phase 2), #130 (Test Infra Phase 2), #131 (Config Expansion), #132 (Release Pipeline), #133 (Planner Auto-Discovery), #134 (Contributor Onboarding).

## [0.1.0] - 2024-XX-XX
Initial tagged pre-release (placeholder – to be backfilled once versioning workflow lands).

---

### Release Process (Preview)
Planned automation (Issue #132) will generate future entries via a `release:prepare` script parsing conventional commits. Until then, updates are manual but must remain deterministic and audit-friendly.

### Verification Notes
For each unreleased change, gates (lint, type, unit) pass locally and in CI; plan hashing and artifact determinism validated via reproducible builds (`npm run build && npm run format` => clean git tree).
