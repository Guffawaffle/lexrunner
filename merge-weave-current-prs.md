# LexRunner Open PRs Analysis - Dec 16, 2025

## Current State: 6 Open PRs (All Draft)

### Executor Canonicalization Track (4 PRs)

**PR #588 - Tool Budget Enforcement** (LPR-043)
- **Status**: Draft
- **Branch**: Unknown (Copilot-created)
- **Files**: `src/executors/toolBudget.ts` (24 unit tests)
- **Dependencies**: Depends on #405 (EXE-001: Executor Manifest Schema) - **MERGED**
- **Ready**: ✅ Foundation schema exists in codebase

**PR #585 - Frame Emission Enforcement** (LPR-044)
- **Status**: Draft
- **Branch**: Unknown (Copilot-created)
- **Files**: `src/executors/frameContract.ts` (26 tests total)
- **Dependencies**: Depends on #405 (EXE-001: Executor Manifest Schema) - **MERGED**
- **Ready**: ✅ Foundation schema exists in codebase

**PR #587 - Guardrail Runtime Enforcement** (LPR-047)
- **Status**: Draft
- **Branch**: Unknown (Copilot-created)
- **Files**: `src/executors/guardrailEnforcement.ts` (59 integration tests)
- **Dependencies**:
  - Depends on #406 (EXE-002: Guardrail Profile Types) - **MERGED** (GuardrailProfileSchema exists)
  - Depends on #407 (EXE-003: Tool Budget Enforcement) - **PR #588**
- **Ready**: ⚠️ Needs PR #588 merged first

**PR #583 - Manifest Validation CI** (LPR-049)
- **Status**: Draft
- **Branch**: Unknown (Copilot-created)
- **Files**: `scripts/validate-manifests.ts`, CI workflow updates (10 tests)
- **Dependencies**: Depends on #405, #412 (EXE-006: Executor Registry)
- **Ready**: ⚠️ May need registry loader (unclear if #412 is merged)

### CLI Improvement Track (2 PRs)

**PR #584 - CLI Category-Action Pattern** (ALN-003)
- **Status**: Draft - **BLOCKED by firewall** (GitHub API access denied)
- **Branch**: Unknown (Copilot-created)
- **Files**: CLI command refactoring (weave/gate/workspace/fanout categories)
- **Dependencies**: Depends on #574 (naming conventions doc)
- **Ready**: ⚠️ Firewall blocked GitHub API access during Copilot execution

**PR #586 - Universal --json Flag** (ALN-004)
- **Status**: Draft
- **Branch**: Unknown (Copilot-created)
- **Files**: `src/cli/jsonEnvelope.ts`, `docs/JSON_OUTPUT_SCHEMAS.md` (13 tests)
- **Dependencies**: None (standalone)
- **Ready**: ✅ No blockers

---

## Dependency Order (Topological Sort)

### Layer 1: No Dependencies (Can merge immediately)
1. **PR #586** - Universal --json flag support
2. **PR #588** - Tool budget enforcement

### Layer 2: Depends on Layer 1
3. **PR #585** - Frame emission enforcement (needs schema from main, already there)
4. **PR #587** - Guardrail enforcement (needs #588)

### Layer 3: Needs review
5. **PR #583** - Manifest validation (check if #412 is merged)
6. **PR #584** - CLI refactoring (BLOCKED - needs firewall allowlist fix)

---

## Senior Dev Assessment

### ✅ Can Proceed
- PRs #586, #588, #585 can be merged sequentially
- All have foundation schemas already in main
- All have comprehensive test coverage

### ⚠️ Needs Attention
- **PR #584**: Firewall blocked GitHub API during Copilot execution
  - Recovery: Add GitHub API domains to Copilot allowlist
  - Or: Re-run locally with proper credentials
- **PR #583**: Verify #412 (Executor Registry) is merged
  - If not: Either merge #412 first or adjust dependencies

### 🚫 Blockers
- No GitHub token available for CLI `discover` command
- Cannot fetch PR branches without authentication
- All PRs are in draft status (per user request, we'll proceed anyway)

---

## Recommended Merge Strategy

### Option A: Sequential Merge (Safe)
```bash
1. Verify #412 status
2. Merge #586 (--json support)
3. Merge #588 (tool budget)
4. Merge #585 (frame emission)
5. Merge #587 (guardrails)
6. Fix #584 firewall issue
7. Merge #583 (manifest validation)
```

### Option B: Parallel Tracks (Faster)
```bash
Track 1: #586 (standalone)
Track 2: #588 → #587
Track 3: #585 (standalone)
Track 4: Investigate #583, #584 blockers

Then: Merge all at once via integration branch
```

---

## Action Items for Eager PM

1. **Verify #412 (Executor Registry) status**
   - Is it merged? If not, create ticket for it

2. **Create ticket: Fix Copilot firewall allowlist**
   - Title: "ALN-005: Add GitHub API to Copilot firewall allowlist"
   - Blocked: PR #584
   - Impact: All future PRs needing GitHub API

3. **Create ticket: Setup GitHub token for CI**
   - Title: "CFG-001: Configure GITHUB_TOKEN for CLI discover command"
   - Enables: Local merge-weave workflows

4. **Fan-out candidate**: Break CLI refactoring into smaller PRs
   - PR #584 is large (weave + gate + workspace + fanout categories)
   - Could be 4 separate PRs for easier review

---

## Dogfooding Notes

### What Worked
- Copilot agent created well-structured PRs with comprehensive tests
- Dependency declarations in issue descriptions are clear
- PRs follow naming conventions and include documentation

### What Needs Improvement
- Firewall configuration for Copilot agents
- GitHub authentication for CLI tooling
- Need MCP tools for fetching PR branches directly
- Could benefit from automated dependency graph visualization

### Feedback for Tooling
- `mcp_lexrunner_plan_create` needs better error messaging when GitHub auth fails
- Should detect when foundation schemas are already merged
- Could suggest which PRs are ready to merge vs blocked
