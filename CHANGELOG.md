# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres (prospectively) to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Governance wrapper delegation tests: validates `scripts/analyze-governance-logs.mjs` correctly delegates to CLI

### Changed
- LexSona rule injection now enabled by default with environment variable configuration
- Updated `loadLexSonaRules()` API to use `RuleInjectionConfig` object instead of boolean parameter
- Removed legacy runner/ location fallback for config files in bootstrap

### Documentation
- Updated LexSona rules documentation with v0.5.0 API changes
- Documented remaining compatibility shims with removal timeline (v2.0.0)
- Updated QOL-COMPLETION-REPORT.md with governance consolidation reality check:
  - `governance:report` is the canonical analysis command
  - `scripts/analyze-governance-logs.mjs` is a backwards-compatibility wrapper
  - Schema versioning is semver-based with legacy normalization via `--accept-legacy`
  - Dedicated `--quiet-shadow` flag is deferred (use global `--quiet`)

### Removed
- `src/cli-old.ts` dead code (old CLI implementation, was already excluded from build)
- Deprecated `migrateGateReport` alias (use `normalizeGateReport` instead)

## [0.5.0] - 2025-11-27

### Added
- Autopilot Levels 0–4 with progressive feature set (planning, safety, merge simulation, deliverables, compliance reporting).
- Deliverables management system: manifests, retention policy, symlinked latest, custom directory via `--deliverables-dir`.
- Gate Report JSON Schema (`gate-report.schema.json`) and validation command (`gate-report validate`).
- Security & compliance reporting foundation with signing, integrity verification, and audit artifacts.
- Deterministic plan hashing & reproducibility safeguards (canonical JSON ordering, build determinism check guidance).
- Extensive documentation suite: architecture, CI/CD integration, deliverables management, plan generation, troubleshooting, performance scaling, migration guide.
- New tests: deliverables lifecycle, extended autopilot E2E coverage, gate report schema validation, security compliance scenarios.
- **Procedure Library:** Config-driven state machines for merge-weave and other workflows.
  - `ProcedureLoader` API for loading procedures from YAML.
  - `ProcedureStateMachine` for state transitions and decision points.
  - `merge-weave-main.yaml` canonical procedure definition.

### Changed
- CLI autopilot command deduplicated options and removed merge conflict artifacts.
- Standardized exit behavior and error messaging across autopilot and gate validation paths.
- Refined documentation structure; consolidated implementation summary and security sections.

### Fixed
- Resolved merge conflicts in `IMPLEMENTATION_SUMMARY.md` and `src/cli.ts` (duplicate option & duplicate execution call).
- Addressed minor drift in documentation references after feature merges.
- Closed Issue #456: Procedure schema now matches merge-weave-main.yaml format.

### Documentation
- Closed documentation gap (Issue #103) with enriched guides (`docs/*.md`).
- Added detailed deliverables management guide and CI/CD integration examples.
- Updated terminology references aligning with `AGENTS.md` and `TERMS.md`.
- **@experimental markings:** Autopilot L3-L4 marked as experimental, subject to breaking changes.
- **@internal markings:** Procedure library marked as internal, format may change between versions.

### Testing
- Increased total passing tests to 2970+ with new suites for deliverables, schema validation, and compliance.
- Added fixtures for plan validation edge cases (cycles, unknown dependencies, invalid schema).
- Procedure loader tests (35 tests) covering schema validation, semantics, and state machine.

### Security
- Established baseline security verification (integrity signing, audit logs) — sets stage for Phase 2 (Issue #129).

### Deprecated
- Legacy duplicated autopilot CLI logic (removed). No formal deprecations yet.

### Removed
- Merge artifact duplicate `--deliverables-dir` option and redundant `autopilot.execute()` call.

### Internal
- Issue triage and closure: #74 (Autopilot Levels), #90 (Gate Report Schema), #96 (Extended Autopilot), #103 (Documentation), #456 (Procedure Schema) closed.
- Opened follow-up tracking issues: #128 (CLI UX), #129 (Security Phase 2), #130 (Test Infra Phase 2), #131 (Config Expansion), #132 (Release Pipeline), #133 (Planner Auto-Discovery), #134 (Contributor Onboarding).

## [0.1.0] - 2025-11-06

**First Stable Release** — Establishes product branding and Frame emission foundation.

### Added

#### Product Branding
- **ADR-000:** Product Naming & Branding decision (LexRunner proprietary vs Lex MIT OSS).
- README branding and badge updates for LexRunner identity.
- Release workflow on `lexrunner-v*` tag pattern for deterministic versioning.
- Architecture Decision Record (ADR) directory and index in `docs/adr/`.
- Clear separation between LexRunner (proprietary) and Lex (MIT OSS core).

#### Frame Emission System
- Frame emitter utilities in `src/frames/emitter.ts` for workflow execution tracking.
- Frame storage to `.lexrunner/frames/` directory with atomic writes.
- Frame types: merge-weave, gate, executor, and procedure frames.
- Frame validation schema with outcome tracking (success, partial, failure).
- Optional Frame emission controlled via `LEX_PR_EMIT_FRAMES` environment variable (default: `false`).
- Audit trail capabilities for workflow history and debugging.

#### Documentation
- Migration guide for v0.1 (`docs/MIGRATION_v0.1.md`) with:
  - Frame emission enablement instructions
  - Before/after examples
  - Troubleshooting section
  - CI/CD integration examples
- ADR-000 documenting product naming and release tag conventions.
- Lex (MIT OSS) cross-reference in README.
- Badges for licensing clarity (Proprietary + Powered by Lex).
- "Branding & Licensing" section with link to ADR-000.
- Link to module aliasing documentation for future Lex integration.

### Changed
- README header now prominently displays "LexRunner — Merge-Weave & Fanout CLI (`lex-pr`)".
- Release workflow condition updated to trigger on `lexrunner-v*.*.*` tags (not legacy `v*` format).
- Product name standardized to "LexRunner" in all documentation.

### Fixed
- N/A (first stable release)

### Breaking Changes
- **None** — All changes are additive and maintain backward compatibility.

### Deprecated
- **None** — This is the initial stable release.

### Security
- Frame storage uses atomic file writes (temp file + rename) to prevent corruption.
- Frame validation ensures data integrity before storage.

### Migration Notes

**From Pre-Release:**
1. No breaking changes; all existing workflows continue to work.
2. Frame emission is **disabled by default**; opt-in via `export LEX_PR_EMIT_FRAMES=true`.
3. Release tags now use `lexrunner-v*` format; old `v*` tags deprecated.
4. Update documentation references to use "LexRunner" (product) and "Lex" (OSS core) appropriately.

See [Migration Guide](docs/MIGRATION_v0.1.md) for complete upgrade instructions.

### Known Limitations
- Frame emission to Lex memory API not yet implemented (planned for v0.2+).
- Module aliasing for Frames not yet available (planned for v0.2+).
- Frame query/recall tools not yet implemented (planned for future releases).

### Related Issues
- Epic E: Paid-vs-free split, CI gates, and release notes
- LPR-010: Sub E.3: Migration guide and release notes for v0.1

---

### Release Process (Preview)
Planned automation (Issue #132) will generate future entries via a `release:prepare` script parsing conventional commits. Until then, updates are manual but must remain deterministic and audit-friendly.

### Verification Notes
For each unreleased change, gates (lint, type, unit) pass locally and in CI; plan hashing and artifact determinism validated via reproducible builds (`npm run build && npm run format` => clean git tree).
