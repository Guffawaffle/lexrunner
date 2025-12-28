# Executor Architecture

This document describes the executor architecture in lexrunner, including the manifest schema, registry patterns, and implementation guidelines.

## Overview

An **executor** is a small, named, versioned unit that:

- Implements a narrow role (e.g., code review, triage, pattern mining)
- Fixes its **tool budget** (which tools it may call, under what limits)
- Binds to a particular **guardrail profile** (scope, tool, epistemic, style, audit)
- Follows the **Jordan-mode protocol** (prep → stochastic → receipt)

## Architecture Components

### 1. Executor Manifest Schema

**Location:** `src/schemas/executorManifest.ts`

The canonical schema for executor manifests, implemented using Zod. Defines:

- Schema versioning (`executor-1.0.0`)
- Tool budget (allowed/denied tools, limits)
- Guardrails (scope, tool, epistemic, style, audit)
- Jordan-mode protocol phases
- Executor authorities

**Status:** ✅ Implemented in issue #405 (LPR-041: Persona Loader & Schema Validation)

**Example manifest:** `executors/senior-dev/executor-manifest.yaml`

### 2. Executor Registry

**Current Status:** Test fixture implementation only

**Location:** `tests/fixtures/executors/registry.ts`

The executor registry is currently implemented as a **test fixture** for use in executor lifecycle tests. It provides basic functionality:

- `register(executor)` - Register an executor
- `load(executorId)` - Load an executor by ID
- `list()` - List all registered executor IDs
- `clear()` - Clear registry (for testing)

**Note from code (previous, now corrected):**

```typescript
/**
 * Placeholder ExecutorRegistry for Testing
 *
 * This is a simplified mock implementation until PR #412 is merged.
 * Real implementation will provide full registry functionality.
 */
```

**IMPORTANT FINDING:** Issue #412 is **NOT** about Executor Registry. It's titled "LPR-048: Lex Memory Integration" and was closed on 2025-12-16. The comment in the test fixture was outdated/misleading and has been corrected.

### 3. Registry Implementation Status

**What was implemented:**

- ✅ ExecutorManifestSchema (issue #405)
- ✅ Manifest validation script (PR #583 - `scripts/validate-manifests.ts`)
- ✅ CI validation pipeline (PR #583 - validates all manifests)
- ✅ Senior Dev executor with full manifest (issue #415)
- ✅ Test fixtures for executor registry pattern

**What is NOT implemented in production:**

- ❌ Production ExecutorRegistry class in `src/`
- ❌ Executor loader/discovery system
- ❌ Runtime executor instantiation from manifests

**Current approach:**
The executor system is schema-driven with validation, but actual executor loading/registry is handled via direct imports and test fixtures rather than a centralized registry pattern.

### 4. Manifest Validation

**Location:** `scripts/validate-manifests.ts`

**Purpose:** CI gate that validates all executor manifests against the schema

**Features:**

- Schema conformance validation via Zod
- Tool budget consistency (detects allowed/denied overlaps)
- Guardrail completeness (ensures required tools are in allowed list)
- Exits non-zero on any failure with actionable error messages

**Run locally:**

```bash
npm run validate:manifests
```

**CI Integration:** Runs in parallel with lint/typecheck in `.github/workflows/ci.yml`

## File Structure

```
executors/                    # Canonical executor implementations
├── senior-dev/
│   ├── executor-manifest.yaml   # Manifest following executor-1.0.0 schema
│   ├── ARCHITECTURE.md          # Design documentation
│   └── prompts/                 # Prompt templates
│
src/
├── schemas/
│   └── executorManifest.ts      # Zod schema for manifests
├── executors/
│   └── seniorDev/               # TypeScript implementation
│       ├── core.ts
│       ├── types.ts
│       └── index.ts
│
tests/fixtures/executors/
├── registry.ts                   # Test fixture registry implementation
├── mock-executor.ts              # Mock executor for tests
└── types.ts                      # Test types

scripts/
├── validate-manifests.ts         # Manifest validation CLI
└── generate-executor-manifest-schema.ts  # JSON Schema generator
```

## Related Issues & PRs

### Completed

- **#404** - LPR-E-009: Executor Canonicalization (Architecture Redesign)
- **#405** - LPR-041: Persona Loader & Schema Validation (ExecutorManifestSchema)
- **#415** - EXE-010: Senior Dev Executor Migration
- **#583** - Add executor manifest validation to CI pipeline (merged 2025-12-17)

### Misleading Dependencies

- **#412** - LPR-048: Lex Memory Integration (NOT about Executor Registry)
  - This issue is about integrating Lex memory APIs (`lex recall`, `lex remember`, `lex timeline`)
  - PR #583 incorrectly listed "Depends-on: #412 (Executor Registry)"
  - The test fixture comment referencing "PR #412" is misleading

## Implementation Notes

### Current Pattern: Direct Imports

Executors are currently loaded via direct TypeScript imports:

```typescript
import { executeReview } from "../executors/seniorDev/core.js";
```

### Future: Registry Pattern (Not Currently Planned)

A production registry **could** enable:

- Dynamic executor discovery from `executors/` directory
- Runtime manifest loading and validation
- Executor lifecycle management
- Plugin-style executor additions

**Current decision:** The direct import approach is sufficient for the current architecture (small number of executors, TypeScript module system). A production registry is **not currently planned** but could be implemented in the future if dynamic loading becomes a requirement.

**Potential implementation location (if needed):** `src/executors/registry.ts`

## Summary for PR #583

**Finding:** PR #583's dependency on "#412 (Executor Registry)" is **incorrect**.

**Actual status:**

- ✅ ExecutorManifestSchema exists (`src/schemas/executorManifest.ts`)
- ✅ Validation script implemented (`scripts/validate-manifests.ts`)
- ✅ CI integration complete
- ✅ Senior Dev manifest validated
- ❌ No production registry in `src/` (only test fixture)

**Recommendation:**

- PR #583 can be considered complete for its stated goal (manifest validation)
- Update PR #583 description to remove incorrect dependency on #412
- If a production registry is needed, create a new issue for it
- For now, the test fixture registry is sufficient for testing purposes

## References

- Executor Authoring Guide: `docs/executor-authoring.md`
- Executor Decoupling: `docs/executor-decoupling.md`
- v0.3.0 thesis: Section 3.3 (Executors as Operational Units)
- ExecutorManifestSchema source: `src/schemas/executorManifest.ts`
- Example manifest: `executors/senior-dev/executor-manifest.yaml`
