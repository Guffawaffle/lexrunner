# EXE-012 Investigation Summary: Executor Registry Status

**Date:** 2025-12-25  
**Investigator:** GitHub Copilot Agent  
**Issue:** EXE-012 - Investigate #412 Executor Registry status

## Executive Summary

**Finding:** Issue #412 is **NOT** about an "Executor Registry". It's titled "LPR-048: Lex Memory Integration" and concerns integrating Lex memory APIs into LexRunner workflows.

**Impact on PR #583:** The dependency listing "Depends-on: #412 (Executor Registry)" in PR #583 is **incorrect**. However, this does not block PR #583, which was already merged on 2025-12-17.

**Registry Status:** A production ExecutorRegistry does not exist in `src/`. Only a test fixture exists in `tests/fixtures/executors/registry.ts`.

---

## Investigation Process

### 1. GitHub Issue/PR Lookup

**Issue #412 Details:**
- **Title:** "LPR-048: Lex Memory Integration"
- **State:** Closed (2025-12-16)
- **Purpose:** Integrate Lex's memory APIs (`lex recall`, `lex remember`, `lex timeline`)
- **Scope:** Creating `src/integrations/lex-memory.ts` and related MCP tools
- **Conclusion:** This is about memory integration, NOT an executor registry

**PR #412:** Does not exist (404 Not Found)

**PR #583 Details:**
- **Title:** "Add executor manifest validation to CI pipeline"
- **State:** Merged (2025-12-17)
- **Dependency Listed:** "Depends-on: #412 (Executor Registry)" ❌ INCORRECT
- **Actual Dependencies:** 
  - #405 (ExecutorManifestSchema) ✅ Implemented
  - Validation logic itself ✅ Implemented

### 2. Codebase Search for Registry

**Search Results:**

```bash
# Files mentioning "registry" (case-insensitive)
tests/fixtures/executors/registry.ts     # Test fixture only
tests/fixtures/executors/index.ts        # Re-exports registry
tests/executors/lifecycle.spec.ts        # Uses test registry
tests/executors/guardrailEnforcement.spec.ts  # Uses test registry
```

**No production registry found in `src/`**

### 3. Test Fixture Analysis

**Location:** `tests/fixtures/executors/registry.ts`

**Comment in test fixture (previous, now corrected):**
```typescript
/**
 * Placeholder ExecutorRegistry for Testing
 * 
 * This is a simplified mock implementation until PR #412 is merged.
 * Real implementation will provide full registry functionality.
 */
```

**Analysis:** This comment was misleading and has been corrected. It references "PR #412" which doesn't exist and conflates issue #412 (Lex Memory) with a registry implementation.

**Functionality:**
- `register(executor)` - Add executor to in-memory map
- `load(executorId)` - Retrieve executor by ID
- `list()` - List registered executor IDs
- `clear()` - Clear registry (for tests)

### 4. Executor Architecture Components

**What EXISTS:**

1. **ExecutorManifestSchema** (`src/schemas/executorManifest.ts`)
   - Zod schema for `executor-manifest.yaml`
   - Defines tool budget, guardrails, Jordan-mode protocol
   - Implemented via issue #405

2. **Manifest Validation** (`scripts/validate-manifests.ts`)
   - CI validation script
   - Validates all manifests against schema
   - Implemented via PR #583

3. **Senior Dev Executor** (`executors/senior-dev/`)
   - Full manifest following executor-1.0.0 schema
   - TypeScript implementation in `src/executors/seniorDev/`
   - Migrated via issue #415

4. **Test Fixtures** (`tests/fixtures/executors/`)
   - Mock registry for testing
   - Mock executor implementations
   - Used in lifecycle and guardrail tests

**What DOES NOT EXIST:**

1. **Production ExecutorRegistry** in `src/executors/registry.ts`
2. **Dynamic executor loading** from manifest files
3. **Executor discovery system**

---

## Findings by Acceptance Criteria

### ✅ Locate #412 issue and check status

**Status:** Closed (2025-12-16)  
**Title:** LPR-048: Lex Memory Integration  
**Type:** Issue (not PR)  
**Scope:** Memory API integration, NOT executor registry

### ✅ If merged: identify which files contain registry implementation

**Not applicable** - #412 was about Lex Memory, not a registry.

**Registry-related files:**
- `tests/fixtures/executors/registry.ts` - Test fixture only (not production code)
- `src/schemas/executorManifest.ts` - Schema for manifests (not a registry)
- `scripts/validate-manifests.ts` - Validation script (not a registry)

### ✅ If merged: update PR #583 description

**Not applicable** - PR #583 was already merged.

**Recommendation:** Create a follow-up issue to clarify the dependency confusion and update any references to "#412 (Executor Registry)" in documentation or code comments.

### ✅ If not merged: determine if registry is needed

**Analysis:**

**Current approach:** Direct TypeScript imports
```typescript
import { executeReview } from '../executors/seniorDev/core.js';
```

**Registry pattern would enable:**
- Dynamic executor discovery
- Runtime manifest loading
- Plugin-style executor additions
- Executor lifecycle management

**Recommendation:**
- **For now:** Test fixture registry is sufficient
- **For future:** If dynamic executor loading is needed, create a new issue specifically for implementing a production registry in `src/executors/registry.ts`
- **Priority:** Low - current direct import approach works fine for a small number of executors

### ✅ Document registry location in `docs/architecture/executors.md`

**Created:** `docs/architecture/executors.md`

**Contents:**
- Executor architecture overview
- Manifest schema documentation
- Registry status (test fixture vs production)
- File structure
- Related issues clarification
- Implementation notes and recommendations

---

## Related Issues Analysis

### Completed Issues

**#404 - Executor Canonicalization**
- Defined canonical structure for executors
- Established `executors/` vs `project/` separation
- Status: Closed (2025-12-01)

**#405 - ExecutorManifestSchema**
- Implemented Zod schema for manifests
- Created `src/schemas/executorManifest.ts`
- Status: Closed (2025-11-26)

**#415 - Senior Dev Migration**
- Migrated Senior Dev executor to canonical location
- Demonstrates full manifest implementation
- Status: Closed (2025-12-17)

**#583 - Manifest Validation CI**
- Created validation script
- Added CI pipeline integration
- Status: Merged (2025-12-17)

### Dependency Confusion

**Issue #415** lists:
```
Dependencies:
- Depends-on: #412 (EXE-006: Executor Registry & Loader)
- Depends-on: #413 (EXE-009: Manifest Validation in CI)
```

**Issue #412** is actually "LPR-048: Lex Memory Integration"

**Hypothesis:** There may have been a planned issue for "EXE-006: Executor Registry & Loader" that was never created, and #412 was mistakenly referenced instead.

---

## Recommendations

### Immediate Actions

1. ✅ **Document current state** - COMPLETED
   - Created `docs/architecture/executors.md`
   - Clarified registry status
   - Documented file locations

2. **Update code comment** - ✅ COMPLETED
   - File: `tests/fixtures/executors/registry.ts`
   - Updated to clarify this is a test fixture
   - Clarified that production registry is not currently planned
   - Noted that direct imports are the current approach

3. **Create clarification issue** - OPTIONAL
   - Title: "Clarify executor registry dependency confusion"
   - Scope: Document the #412 confusion and clean up references

### Future Considerations

**If dynamic executor loading becomes a requirement:**

1. Create new issue: "EXE-XXX: Implement Production Executor Registry"
2. Scope:
   - Create `src/executors/registry.ts`
   - Implement manifest loading from `executors/` directory
   - Support runtime executor discovery
   - Executor lifecycle management
3. Priority: **Not currently planned** - current direct import approach is intentional

**Why current approach is preferred:**
- Small number of executors (currently only senior-dev)
- Executors are TypeScript modules with compile-time type safety
- Test fixtures provide registry pattern for testing
- CI validation ensures manifest correctness
- No runtime discovery requirement

---

## Conclusion

**PR #583 dependency on "#412 (Executor Registry)" was incorrect**, but this does not impact PR #583's completion status. The PR successfully implemented manifest validation, which was its actual goal.

**A production executor registry does not exist**, only a test fixture. This is acceptable for the current architecture, which uses direct imports for executor loading.

**Documentation has been created** at `docs/architecture/executors.md` to clarify the executor architecture and registry status.

**No blocking issues identified** for the executor canonicalization epic (#404).

---

## Appendix: File Inventory

### Executor Manifest & Schema
- `src/schemas/executorManifest.ts` - Zod schema ✅
- `executors/senior-dev/executor-manifest.yaml` - Example manifest ✅
- `scripts/validate-manifests.ts` - Validation script ✅
- `scripts/generate-executor-manifest-schema.ts` - JSON Schema generator ✅

### Executor Implementation
- `src/executors/seniorDev/core.ts` - Core logic ✅
- `src/executors/seniorDev/types.ts` - Type definitions ✅
- `src/executors/seniorDev/index.ts` - Public exports ✅

### Test Fixtures
- `tests/fixtures/executors/registry.ts` - Test registry ✅
- `tests/fixtures/executors/mock-executor.ts` - Mock executor ✅
- `tests/fixtures/executors/types.ts` - Test types ✅
- `tests/fixtures/executors/index.ts` - Fixture exports ✅

### Documentation
- `docs/executor-authoring.md` - Authoring guide ✅
- `docs/executor-decoupling.md` - Architecture patterns ✅
- `docs/architecture/executors.md` - Architecture reference ✅ NEW

### Production Registry
- `src/executors/registry.ts` - ❌ DOES NOT EXIST
