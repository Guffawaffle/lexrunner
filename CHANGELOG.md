# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres (prospectively) to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Governed task capability foundation** - Add a review-neutral task/profile binding and positive
  capability ceiling that represents recoverable workspace writes, explicitly bounded external
  effects, contained runtime execution, and attenuated nested Delegations without weakening `NO`.
- **Governed committed-corpus review** - Bind a clean committed native-WSL candidate to its exact
  Attempt, workspace lease, task packet, launch envelope, and path mapping; export only bounded Git
  object bytes and the exact patch; seal them read-only for the asynchronous two-phase Codex review.
- **Independent repository verification** - Reopen the authoritative lifecycle records and require
  protected provider receipts to match the corpus, prompt, schema, task offer, and Delegation before
  a review can become admissible.

### Changed

- **Governed review task profile** - Express read-only review through a durable generic
  `GovernedTaskSpec`, bind the Delegation offer to its exact task and provider, and independently
  reconstruct the profile from protected prompt, corpus, output-contract, and budget bindings;
  release accepted work only after the generic grant and qualified adapter evaluate, and dispatch
  `PASS`/`BLOCK` interpretation through the exact profile verifier.
- **Qualified provider topology** - Bind the root-owned repository exporter and exact Git executable
  and version into live qualification evidence, and securely discard sealed corpora that never
  become operation-bound.

### Fixed

- **Governed refusal and budget enforcement** - Persist an offer-phase `NO` directly from the
  offered Delegation state, and independently reject duration, output, evidence-byte, or tool-call
  usage beyond the exact task budget bound to execution requirements and the evidence reservation.
- **Generic continuation and outcome isolation** - Deny both direct work and post-`ACCEPT`
  continuation when the durable generic task/execution binding is absent, keep unbound legacy
  offers refusal-only, reject contradictory `PASS` output with blocking findings, and make generic
  results and verification receipts accept profile-owned outcome identifiers without embedding the
  code-review vocabulary. Bind the root task grant issuer to the operator principal named by the
  protected authorization requirements so a self-consistent caller grant cannot mint authority.
- **Git object substitution defense** - Verify every exported file against the blob object ID in
  the candidate tree, preserve that object ID in the sealed manifest, and recheck the binding at
  both the Windows corpus parser and provider boundary.
- **Qualification upgrade boundary** - Reject pre-profile qualification manifests so repository
  review cannot use a legacy attestation that omits the exporter and Git executable hashes.
- **Repository launch lease race** - Atomically require the bound active workspace lease when
  authorizing the offer, creating the durable operation, and authorizing post-acceptance work; the
  independent verifier also rejects results after lease release.
- **Repository corpus memory bounds** - Read Git blobs one at a time, reject aggregate tree size from
  object headers before buffering payloads, and stop every Git metadata or patch stream after its
  declared maximum plus one byte.
- **Repository receipt lifecycle projection** - Verify the provider's corpus-header receipt against
  provider-visible fields while independently enforcing the host-owned workspace-lease revision.
- **Failed repository launch cleanup** - Treat post-validation launch construction transactionally:
  stop partially created worker units and remove partial spools and unreferenced sealed corpora
  whenever launch fails before returning a handle.

## [1.4.1] - 2026-08-04

### Added

- **Canonical CLI executable** - Publish `lexrunner` as the primary npm binary alongside
  `lexrunner-mcp` and the retained `lex-pr` compatibility alias.

### Changed

- **Consistent CLI identity** - Use `lexrunner` in root and subcommand help, completions, diagnostic
  prefixes, installation guidance, current release documentation, and generated CLI/MCP surface
  guidance.

### Fixed

- **Package/executable mismatch** - Ensure installing `@smartergpt/lexrunner` exposes an executable
  matching the package and product name without breaking existing `lex-pr` automation.

## [1.4.0] - 2026-08-04

### Added

- **Native-host workspace boundary** - Add the versioned `WorkspaceBoundary` contract, production
  Linux backend, runtime resolver, lease-bound authority lineage, and shared hostile-race
  conformance coverage that preserves the existing Linux containment guarantee while defining the
  fail-closed path to a native Windows backend.

### Changed

- **Lex 4 compatibility** - Upgrade `@smartergpt/lex` to the audited 4.x line while preserving all
  directly consumed public exports.
- **Deterministic install scripts** - Check in explicit npm allow/deny decisions for native SQLite,
  esbuild, and Lex lifecycle scripts.

### Fixed

- **Native Windows bootstrap** - Validate clean installation, dependency policy, build, and focused
  portable regressions in Windows CI without claiming runtime parity through skipped tests.
- **Cross-platform patch application** - Apply unified diffs through argument-safe `git apply`
  instead of requiring a separately installed GNU `patch` executable.
- **Boundary integrity** - Canonicalize receipt identity sets, preserve path-private diagnostics,
  bind observations to live leases, and route Linux Git operations through boundary capabilities.
- **Plan validation stability** - Bound CLI validation subprocesses and retain actionable timeout
  diagnostics under hosted-runner load.
- **Dependency audit** - Remove all currently reported production and development advisories,
  including the Sharp/libvips path and newly disclosed URI, address, middleware, PostCSS, and brace
  expansion findings.

## [1.3.0] - 2026-07-30

### Added

- **Windows-to-native-WSL Attempt projection** - Added a read-only containment preflight,
  versioned projection and path-mapping contracts, rollback-safe native provisioning, and
  identity-bound launch, worker, receipt, verification, acceptance, and cleanup behavior.
- **Shared projection lifecycle** - Added matching CLI
  `attempt projection prepare|status|cleanup|quarantine` operations and MCP lifecycle tools with
  explicit mutation authority, path-private diagnostics, bounded quarantine inspection, and a
  recovery runbook.
- **Independent merge review gate** - Documented a mandatory-by-default, exact-head review step
  whose verdict is invalidated by candidate changes and whose opt-out requires an explicit warned
  `review_bypassed` receipt.

### Fixed

- **Plan validation diagnostics** - Return the individual validation failures instead of only an
  aggregate count, preserving the dogfood evidence needed to repair invalid plans.
- **Explicit plan references** - Resolve explicitly selected plan artifacts consistently across
  MCP status, ordering, and gate operations.
- **Projection durability and recovery** - Fail closed across selection revocation/publication,
  staging ownership, quarantine marker persistence, directory sync failures, source refresh, and
  active-worktree cleanup refusal.

---

## [1.2.1] - 2026-07-21

### Fixed

- **npm executable metadata** - Removed the leading `./` from the `lexrunner-mcp` bin target and
  normalized the repository URL so npm preserves both CLI executables without publish-time repair.
- **Human publication gate** - Added a package-boundary validation for npm-normalized metadata and
  a dry-run release gate that prints, but never executes, the final authenticated publish command.
- **Canonical release tags** - Reconciled the release workflow, preparation and drift scripts,
  publication gate, and operator guidance on the required `lexrunner-v*` tag prefix.

### Release note

- `v1.2.0` remains an immutable GitHub release but was not published to npm after the dry run exposed
  the removable MCP bin metadata. Use `1.2.1` for the private npm release and downstream proof.

---

## [1.2.0] - 2026-07-21

### Added

- **Assisted agent-work lifecycle** - Added ADR-010 WorkItem, Run, Attempt, packet, envelope,
  workspace, WorkerSession, receipt, engine-verification, acceptance, retry-delta, and fan-in
  contracts with fenced memory and SQLite persistence.
- **Public lifecycle surfaces** - Added bounded CLI and MCP adapters for Attempt preparation,
  start/status, worker attachment and heartbeat, receipt submission, independent verification,
  and policy acceptance.
- **Recovery and containment** - Added native worktree brokering, physical directory identity,
  incomplete-launch reconciliation, runtime authority negotiation/enforcement, fail-forward
  supervisor services, and persisted merge-weave resume.
- **Shared integration services** - Added canonical shared services for gate execution, discovery,
  planning, status, merge order/application, workspace configuration, and bounded IntegrationRun
  compatibility.
- **Release evidence** - Added generated CLI/MCP documentation, touched/adjacent implementation
  gate selection, deterministic package-boundary validation, clean packed-package smoke, and
  ecosystem dogfood isolation.

### Changed

- **Documentation and ADR-010 reconciliation** - Reframed LexRunner around its progressive
  integration workflow, distinguished the stateless integration core from optional stateful
  coordination, documented assisted-versus-headless maturity honestly, added a bounded read-only
  agent evaluation, generated CLI/MCP surface and package-version facts from repository authority,
  and corrected private npm publishing guidance for `@smartergpt/lexrunner`.
- **Node.js 24 runtime floor** - Ecosystem 3.1 requires Node.js 24 or newer for the CLI,
  MCP server, SDK package, and downstream consumers. Node.js 20 is EOL and Node.js 22 is no
  longer a supported LexRunner runtime. Upgrade local, CI, and Windows consumer environments
  before installing this release. The package intentionally has no speculative upper bound;
  Node 24 is the validated release line and later majors remain installable for forward testing.
- **Lex 3 compatibility** - Updated the runtime dependency from `@smartergpt/lex@^2.10.0` to
  `@smartergpt/lex@^3.0.1` after validating that every LexRunner-imported export remains present
  and the Node 24 build, integration tests, and packed consumer succeed.

### Fixed

- **Published package boundary** - Replaced broken `.smartergpt` schema export targets with built
  ESM/CommonJS/declaration artifacts, bounded the tarball allowlist, and verified the real packed
  CLI and MCP bins.
- **Canonical surface drift** - Centralized CLI alias warnings/removal windows and verified all
  125 CLI registrations and 28 MCP tools against explicit dispositions and application-service
  ownership.

### Compatibility

- No canonical CLI command, MCP tool, or package export key from 1.1 is removed. Deprecated aliases
  remain migration-only and retain their declared 2.0 removal window.
- The Node 24 floor is an intentional minor-release migration for Ecosystem 3.1. Node 20 and 22
  consumers must upgrade before installing LexRunner 1.2.0.
- Assisted orchestration is supported. A general public headless launcher, native reboot recovery,
  and the complete Stage 5 hostile fault-injection/authority-expansion matrix remain deferred.

---

## [1.1.0] - 2026-02-08

### Fixed

- **SQLite package alignment** - Replaced `better-sqlite3` with `better-sqlite3-multiple-ciphers` ^12.6.2 (#730)
  - LexRunner can now open encrypted Lex databases (cipher support via `pragma key`)
  - Aligns all ecosystem repos (lex, lexsona, lexrunner) on the same SQLite package
  - Drop-in replacement — no API changes, same `@types/better-sqlite3` types

---

## [1.0.0] - 2026-01-04

### 🎉 First Stable Release

LexRunner reaches 1.0.0 with comprehensive merge-weave automation, enterprise onboarding, and robust gate execution.

### Added

- **Post-merge Type Check Gate** - Catch integration breaks early with automatic type checking after merges
- **Auto-update PR Branches** (#693) - Automatically update PR branches during sequential merge-weave
- **Batch Issue State Checking** - Parallel API calls with TTL caching for faster state checks
- **Enterprise Onboarding Wizard** (#692) - Unified setup experience for new users
- **Import Gate Results from GitHub** (#691) - Import check run results as gate attestations
- **Auto-undraft Copilot Agent PRs** (#690) - Automatically mark Copilot PRs ready when complete
- **Agent Stall Detection** (#689) - Automatic nudging when agents stall
- **Checkpoint and Resume** (#688) - Resume interrupted merge-weave operations
- **Inter-PR Conflict Detection** (#681) - Detection and resolution guidance for PR conflicts
- **Gate Attestation and Import** (#680) - Record external gate runs
- **D2 Executor** (#675, #677) - Draft promotion and multi-repo plan support
- **Counter-example Capture** (LR-TSF-003) - Capture gate failure examples for learning
- **Constraint Preview in Dry-run** (LR-TSF-002) - Preview constraints before execution
- **Constraint Attribution** (LR-TSF-001) - Track which rules produced which constraints
- **Fanout Harvest/Analyze Tools** (Epic #654) - MCP tools for Copilot agent fanout

### Removed

- All deprecated `lexrunner_*` MCP tool aliases (use canonical names)

---

## [0.6.0] - 2025-12-16

### ⚠️ BREAKING CHANGE: MCP Tool Names

**VS Code automatically adds `mcp_{servername}_` prefix to all tool names.** Our previous naming included redundant prefixes, causing tools to appear as `mcp_lexrunner_lexrunner_plan_create` instead of `mcp_lexrunner_plan_create`.

This release removes the namespace prefix from tool definitions to match the GitHub MCP pattern.

#### Migration Guide

| v0.5.x Tool Name              | v0.6.x Tool Name  | VS Code Display                 |
| ----------------------------- | ----------------- | ------------------------------- |
| `lexrunner_plan_create`       | `plan_create`     | `mcp_lexrunner_plan_create`     |
| `lexrunner_gate_run`          | `gates_run`       | `mcp_lexrunner_gates_run`       |
| `lexrunner_weave_apply`       | `merge_apply`     | `mcp_lexrunner_merge_apply`     |
| `lexrunner_weave_discover`    | `discover`        | `mcp_lexrunner_discover`        |
| `lexrunner_weave_status`      | `weave_status`    | `mcp_lexrunner_weave_status`    |
| `lexrunner_weave_order`       | `merge_order`     | `mcp_lexrunner_merge_order`     |
| `lexrunner_workspace_init`    | `local_init`      | `mcp_lexrunner_local_init`      |
| `lexrunner_workspace_resolve` | `profile_resolve` | `mcp_lexrunner_profile_resolve` |
| `lexrunner_workspace_doctor`  | `doctor`          | `mcp_lexrunner_doctor`          |
| `lexrunner_core_health`       | `health`          | `mcp_lexrunner_health`          |
| `lexrunner_core_config`       | `config_show`     | `mcp_lexrunner_config_show`     |
| `lexrunner_core_guide`        | `workflow_guide`  | `mcp_lexrunner_workflow_guide`  |
| `lexrunner_core_metrics`      | `metrics`         | `mcp_lexrunner_metrics`         |
| `lexrunner_executor_*`        | `executor_*`      | `mcp_lexrunner_executor_*`      |
| `lexrunner_run_start`         | `start_run`       | `mcp_lexrunner_start_run`       |
| `lexrunner_run_status`        | `get_status`      | `mcp_lexrunner_get_status`      |
| `lexrunner_run_list`          | `list_artifacts`  | `mcp_lexrunner_list_artifacts`  |
| `lexrunner_run_decision`      | `run_decision`    | `mcp_lexrunner_run_decision`    |

**Backwards Compatibility:** Old `lexrunner_*` names are preserved as deprecated aliases and will continue to work. They will be removed in v1.0.0.

### Added

- Governance wrapper delegation tests: validates `scripts/analyze-governance-logs.mjs` correctly delegates to CLI

### Changed

- MCP tool names no longer include namespace prefix (GitHub MCP pattern)
- LexSona rule injection now enabled by default with environment variable configuration
- Updated `loadLexSonaRules()` API to use `RuleInjectionConfig` object instead of boolean parameter
- Removed legacy runner/ location fallback for config files in bootstrap

### Fixed

- Tools now display correctly in VS Code as `mcp_lexrunner_{action}` instead of `mcp_lexrunner_lexrunner_{action}`

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

---

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
