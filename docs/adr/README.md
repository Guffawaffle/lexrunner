# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for LexRunner. Each ADR documents a significant decision, its context, and consequences.

> **IP Boundary Note:** ADRs in this directory contain LexRunner-specific implementation details. Public, engine-agnostic decisions live in [Lex's ADR directory](https://github.com/smartergpt/lex/docs/adr/).

## Index

| ID  | Title                                                                    | Status   | Date       |
| --- | ------------------------------------------------------------------------ | -------- | ---------- |
| 000 | [Product Naming & Branding](./ADR-000-product-naming-and-branding.md)    | Accepted | 2025-11-06 |
| 001 | [Plan.json as Frozen Runtime Input](./ADR-001-plan-json-frozen-input.md) | Accepted | 2025-11-25 |
| 002 | [Two-Track Separation](./ADR-002-two-track-separation.md)                | Accepted | 2025-11-25 |
| 003 | [Gate Uniform Execution](./ADR-003-gate-uniform-execution.md)            | Accepted | 2025-11-25 |
| 004 | [Runner State Model](./ADR-004-runner-state-model.md)                    | Accepted | 2025-11-25 |
| 005 | [Merge Pyramid Ordering](./ADR-005-merge-pyramid-ordering.md)            | Accepted | 2025-11-25 |
| 006 | [Schema Versioning with SemVer](./ADR-006-schema-versioning-semver.md)   | Accepted | 2025-11-25 |
| 007 | [Task Snapshot Contract](./ADR-007-task-snapshot-contract.md)            | Accepted | 2025-12-19 |
| 008 | [Lex Packaging Strategy](./ADR-008-lex-packaging.md)                     | Accepted | 2026-01-01 |

## Conventions

- **One ADR per decision:** Each record captures a single architectural or product decision.
- **Immutable after acceptance:** Accepted ADRs are not modified (except to update Status or add links).
- **Format:** Use the provided template (see ADR-000 for reference).
- **Naming:** `ADR-NNN-kebab-case-title.md`

## Using This Index

- New ADRs should be added to this table.
- Reference the full ADR by its number in discussions and docs.
- Link to ADRs from relevant code or README sections.
