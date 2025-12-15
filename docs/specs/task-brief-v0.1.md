# Task Brief Specification v0.1

> **Status:** Draft
> **Author:** Lex (Chief Architect) + Opie (Implementation Advisor)
> **Date:** 2025-11-27

## Purpose

A Task Brief is a structured prompt format that reduces token usage and improves LLM effectiveness by:
1. Replacing messy natural language with normalized fields
2. Moving stable context to files (read on demand)
3. Preserving only what matters for the current task

## Schema

```markdown
# Task Brief: <Short Title>

## Objective
[1-3 sentences: what success looks like]

## Scope
- Repos: <list>
- Branch: <target branch>
- PRs: <list if merge-weave>
- Files likely touched: <globs or paths>

## Constraints
- <budget, rate limits, timing>
- <quality tradeoffs>
- <governance rules>

## Context Files (read if needed)
- <absolute paths to CONTRACTs, AGENTS.md, etc.>

## Prior Decisions
- <key decisions from previous sessions>
- <conflict resolutions to maintain>
- <patterns established>

## Exit Criteria
- [ ] <measurable outcome 1>
- [ ] <measurable outcome 2>
- [ ] <measurable outcome 3>
```

## Field Semantics

### Objective
- **Required:** Yes
- **Length:** 1-3 sentences
- **Content:** Concrete success state, not process description
- **Good:** "All PRs merged to main with gates passing"
- **Bad:** "Work on the PRs and make sure things are good"

### Scope
- **Required:** Yes
- **Content:**
  - `Repos`: Which repositories are in play
  - `Branch`: Target branch for merges/commits
  - `PRs`: Specific PR numbers (for merge-weave tasks)
  - `Files`: Globs or paths likely to be touched

### Constraints
- **Required:** Yes (can be "None" if truly unconstrained)
- **Examples:**
  - Budget: "minimize CI usage (end of month)"
  - Quality: "maintain review standards"
  - Governance: "no new fan-outs without approval"
  - Rate limits: "rate limited, batch operations"

### Context Files
- **Required:** No (but strongly recommended)
- **Content:** Absolute paths to files the LLM should read if needed
- **Purpose:** Replace prose descriptions with file references
- **Examples:**
  - `/srv/lex-mcp/lexrunner/src/store/CONTRACT.md`
  - `/srv/lex-mcp/lexrunner/AGENTS.md`

### Prior Decisions
- **Required:** No (but critical for multi-session work)
- **Content:** Decisions that should persist across sessions
- **Examples:**
  - "LexSona: using #377 schema (richer fields)"
  - "Conflict resolution: prefer newer implementation"
  - "Naming: use `Executor*` prefix for executor-specific types"

### Exit Criteria
- **Required:** Yes
- **Format:** Checkbox list (GitHub-compatible)
- **Content:** Measurable, verifiable outcomes
- **Good:** "[ ] `npm test` passing (3,200+ tests)"
- **Bad:** "[ ] Code is good"

## Storage

Task briefs are stored in the runner's working directory:

```
.smartergpt.local/runner/briefs/
├── 2025-11-27-merge-weave-lex-wave2.md
├── 2025-11-27-merge-weave-lexrunner-wave2.md
└── 2025-11-27-version-alignment.md
```

Naming convention: `YYYY-MM-DD-<task-slug>.md`

## Lifecycle

1. **Creation:** `lex-pr brief` generates from NL or issue references
2. **Execution:** Paste into Copilot chat or reference via path
3. **Completion:** Update exit criteria checkboxes
4. **Archive:** Keep for audit trail, move to `briefs/archive/` after 30 days

## Relationship to Other Artifacts

| Artifact | Scope | Lifetime | Task Brief Role |
|----------|-------|----------|-----------------|
| `AGENTS.md` | Repo | Permanent | Reference in Context Files |
| `CONTRACT.md` | Module | Permanent | Reference in Context Files |
| `Task Brief` | Session | Days | Primary prompt input |
| Lex Frame | Episode | Permanent | Source for Prior Decisions |
| Receipt | Decision | Permanent | Created when Exit Criteria met |

## Anti-Patterns

### ❌ Over-specification
```markdown
## Objective
Merge PRs #463, #464, #465, #466, #467 to main branch by first checking
out main, then fetching origin, then creating an umbrella branch with
the naming convention integration/umbrella-YYYYMMDD-HHMM, then merging
each PR in dependency order starting with #463 which has no dependencies...
```

### ✅ Right-sized
```markdown
## Objective
Merge PRs #463-467 to main, resolve conflicts, verify gates locally, push.
```

### ❌ Prose instead of paths
```markdown
## Prior Decisions
The CONTRACT.md file we created earlier says that all IDs should be ULIDs
and timestamps should be ISO 8601 format...
```

### ✅ Path reference
```markdown
## Context Files
- /srv/lex-mcp/lexrunner/src/store/CONTRACT.md
```

## Example: Complete Task Brief

```markdown
# Task Brief: Merge-Weave LexRunner Wave 2

## Objective
Merge PRs #463-467 to main, resolve conflicts, verify gates locally, push.

## Scope
- Repos: lexrunner
- Branch: main
- PRs: #463, #464, #465, #466, #467
- Files likely touched: src/runs/*.ts, src/cli.ts, src/procedures/*.ts

## Constraints
- Budget: minimize CI usage (end of month)
- Quality: maintain (review inline, don't shortcut)
- Governance: no new fan-outs

## Context Files (read if needed)
- /srv/lex-mcp/lexrunner/src/store/CONTRACT.md
- /srv/lex-mcp/lexrunner/AGENTS.md
- /srv/lex-mcp/lexrunner/docs/executor-authoring.md

## Prior Decisions
- FailureHandlingPayload: use #463 implementation
- Artifacts: use #465 listArtifacts pattern
- PR review procedure: #466 defines pr-review.yaml

## Exit Criteria
- [ ] All 5 PRs merged to umbrella
- [ ] Conflicts resolved (src/runs/index.ts expected)
- [ ] `npm run build` passing
- [ ] `npm run typecheck` clean
- [ ] `npm test` passing (3,200+ tests)
- [ ] Pushed to origin/main
```

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2025-11-27 | Initial draft from Opie/Lex session |
