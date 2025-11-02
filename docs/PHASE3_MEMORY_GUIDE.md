# Memory Retrieval Guide for Phase 3 & Beyond

## Quick Context Recall

To retrieve the most recent session state memory in a new chat, use this query with the lexbrain memory system:

### Query Parameters (NO COMMIT SPECIFIED)

```
Tool: mcp_lexbrain_thought_get

Parameters:
  repo: Guffawaffle/lex-pr-runner
  kind: note
  inputs_hash: session-2025-11-01-epic75-and-phase3

DO NOT specify commit - this allows broader search across commits
```

### What This Returns

Complete session state including:
- Current branch and commit (main @ 478bfb8)
- Epic completion status (75 CLOSED, 171 CLOSED)
- Phase 3 assignments (issues #239-244, 6 agents assigned)
- Dogfooding discoveries and bugs (#238 gate executor bug)
- Next session checklist (check PRs, dogfood CLI, merge-weave)
- Key metrics and remaining work (Epic #172 Phases 4-6)

## Example Usage in New Chat

**Tell the new chat copilot:**

> "Please retrieve the Phase 3 merge-weave context using mcp_lexbrain_thought_get with:
>   - repo: Guffawaffle/lex-pr-runner
>   - kind: note
>   - inputs_hash: session-2025-11-01-epic75-and-phase3
> Don't specify a commit parameter - let it search broadly."

## Why This Works Better Than Commit-Locked Query

✅ **No commit dependency** - Works even after new commits
✅ **Broader search** - Finds memory across all commits with that hash
✅ **More reliable** - Returns most recent memory automatically
✅ **Future-proof** - Doesn't break when main branch advances

## What's Stored

**Fact ID:** `62fdec37021ee4b540940f370c008e2e33ab266a8756a0367866fddfead42235`

**Session Date:** 2025-11-01
**Current Branch:** main
**Last Commit:** 478bfb8
**Test Suite:** 1,737 tests passing

### Epics Completed
- Epic #75: Diffgraph Planner (5 PRs, 8,700 lines) ✅ CLOSED
- Epic #171: Pyramid Orchestration (7 features, 78% time savings) ✅ CLOSED

### Phase 3 Status
- **Issues Assigned:** #239, #240, #241, #242, #243, #244
- **Commands to Extract:** plan, discover, schema, report, retry, query
- **Agents Working:** 6 (Copilot)
- **Expected Delivery:** 2-3 hours from 23:53:47 UTC 2025-11-01
- **Current cli.ts:** 2,493 lines → Target after Phase 3: 1,870-2,080 lines

### Known Issues
- **#238:** Gate executor working directory bug (ENOENT: uv_cwd when running test gates)
  - **Workaround:** Test each PR branch individually with `npm test` before merging

### Next Session Checklist
1. Check if Phase 3 PRs are ready: `gh pr list --state open --author app/github-copilot`
2. Review PR descriptions for any dependencies or conflicts
3. Dogfood: `lex-pr plan --from-github --include-drafts` to generate merge plan
4. Test each PR individually first: `git checkout PR-branch && npm test`
5. Create integration branch: `git checkout -b integration/phase3 main`
6. Merge PRs one by one with gate verification
7. Merge integration → main when all pass
8. Close issues #239-244
9. Update Epic #172 with Phase 3 completion
10. Decide: Create Phase 4 issues or pause for assessment

### Remaining Work
- **Epic #172 Phase 4:** Complex commands (execute, merge, autopilot, doctor, gate-report)
  - Note: `execute` extraction can fix #238 bug
- **Epic #172 Phase 5:** Remaining commands (not yet scoped)
- **Epic #172 Phase 6:** Polish & documentation (not yet scoped)
- **Other open epics:** #76 (Comms), #77 (Rollout), #189 (Audit - only SARIF #195 remaining)

## If Memory Query Returns Empty

Fallback options:
1. Check `.smartergpt.local/SESSION_PHASE3_READY.md` if it exists
2. Run: `git log --oneline | head -20` to see recent commits
3. Ask copilot to `cat .github/copilot-instructions.md` for project context
4. Review the PRs manually: `gh pr list --limit 20`

## Dogfooding Discoveries This Session

**What Worked:**
- ✅ `lex-pr plan --from-github` - Generated perfect plan.json from open PRs
- ✅ `lex-pr merge-order` - Computed dependency levels correctly
- ✅ Manual merge-weave with git - Reliable when CLI tools unavailable

**What Needs Fixing:**
- ❌ `lex-pr execute` - Working directory context issues (Issue #238)
- 🤔 CLI workflow integration - 3 separate commands needed (plan, execute, merge)
- 💡 Future: Single `weave` command that chains them?

---

**Last Updated:** 2025-11-01T23:56:04.080Z
