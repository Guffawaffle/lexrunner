# MCP Merge-Weave Kickoff Prompt (Umbrella Branch + PR, **MCP-first**)

---

## Context
You will plan and execute a **merge-weave** into a single umbrella branch and PR using **MCP tools**:
- **Discover** open PRs from GitHub and build a dependency-aware plan using lex-pr-runner.
- Create **`merge-weave-{uuid}`** umbrella branch from the default branch.
- **Fold** designated PR branches into the umbrella branch **in topological order**, running gates after each fold.
- Maintain one **umbrella PR → default branch**, keeping its body updated with a checklist of folded PRs and **"Closes #issue"** lines for linked issues.
- As each PR branch successfully folds in, **close that PR** and update the umbrella PR body.
- After all levels pass gates, **merge the umbrella PR** to default.

**Agent session dir (fixed):** `.smartergpt.local/deliverables/_session` — for plans, merge logs, orchestration metadata
**lex-pr artifacts (configurable):** `lex-pr execute` writes gate artifacts to `--artifact-dir` (default: `./artifacts`)
  - **Recommended:** Use `--artifact-dir .smartergpt.local/deliverables/_session/gate-artifacts` to keep everything together
**Schema path (fixed):** `schema/plan.schema.json` — `lex-pr schema validate` uses this
**Safety:** No force-push, no history rewrites. Use `git revert` for safe undos.

> **MCP Preference:** Use MCP tools for git/GitHub ops (`mcp:git.*`, `mcp:github.*`). For lex-pr-runner commands, wrap via `mcp:tool.run name="lex-pr" args=[...]`. Fallback to `gh` CLI, then shell, then REST.
>
> **Key insight:** `lex-pr` CLI is responsible for discovering PRs, generating plans, computing order, and running gates (it manages its own artifact collection internally). **You orchestrate the flow and capture lex-pr's JSON outputs to your session dir.** The two artifact spaces don't conflict—lex-pr writes gate logs/coverage to its `--artifact-dir`, you capture MCP tool outputs (JSON) to `.smartergpt.local/deliverables/_session/`.

---

## Planner

### Role & Objective
Discover open PRs, generate and validate the merge plan, compute topological order, define gates.

### Inputs
- GitHub repo (owner/repo auto-detected from git remote, or specify via `--owner`/`--repo`)
- Default branch name (e.g., `main`)
- PR filter criteria (labels, exclude list, etc.)

### Allowed Tools
- `mcp:tool.run name="lex-pr" args=["discover", "--json"]` — list open PRs from GitHub (lex-pr outputs JSON)
- `mcp:tool.run name="lex-pr" args=["plan", "--from-github", "--json"]` — generate plan.json with dependency suggestions (lex-pr outputs)
- `mcp:tool.run name="lex-pr" args=["schema", "validate", "plan.json", "--json"]` — validate plan structure (lex-pr outputs validation result)
- `mcp:tool.run name="lex-pr" args=["merge-order", "plan.json", "--json"]` — compute topological sort (lex-pr outputs levels + order)
- `filesystem/read`, `filesystem/write` — manage local files
- `git/log`, `git/branch` — inspect repo state
- **You (agent) responsibility:** Capture lex-pr MCP tool outputs and save to fixed paths
- **Forbidden:** remote network calls, force-push, history rewrite

### Steps
1. **Discover PRs**:
   ```bash
   mcp:tool.run name="lex-pr" args=["discover", "--json"] \
     > .smartergpt.local/deliverables/_session/discover.json
   ```
   Fallback: `gh pr list --json number,headRefName,title,labels`

2. **Generate plan**:
   ```bash
   mcp:tool.run name="lex-pr" args=["plan", "--from-github", "--json"] \
     > .smartergpt.local/deliverables/_session/plan.json
   ```
   Fallback: `lex-pr plan --from-github --json > plan.json`

3. **Validate schema**:
   ```bash
   mcp:tool.run name="lex-pr" args=["schema", "validate", ".smartergpt.local/deliverables/_session/plan.json", "--json"] \
     | tee .smartergpt.local/deliverables/_session/plan.validate.json
   ```

4. **Compute merge order**:
   ```bash
   mcp:tool.run name="lex-pr" args=["merge-order", ".smartergpt.local/deliverables/_session/plan.json", "--json"] \
     | tee .smartergpt.local/deliverables/_session/merge-order.json
   ```

5. **Write gate definitions** (infer from plan policy):
   ```bash
   cat > .smartergpt.local/deliverables/_session/gate-definitions.json << 'EOF'
   {
     "gates": [
       {"name": "lint", "command": "npm run lint", "required": true, "timeout_seconds": 300},
       {"name": "typecheck", "command": "npm run typecheck", "required": true, "timeout_seconds": 300},
       {"name": "test", "command": "npm test", "required": true, "timeout_seconds": 600},
       {"name": "determinism", "command": "npm run build && git diff --exit-code", "required": true, "timeout_seconds": 300}
     ]
   }
   EOF
   ```

6. **Return contract** to chat with plan summary.

### Artifacts
- `.smartergpt.local/deliverables/_session/discover.json` — PR list from GitHub
- `.smartergpt.local/deliverables/_session/plan.json` — Generated plan (validated)
- `.smartergpt.local/deliverables/_session/merge-order.json` — Topological sort + levels
- `.smartergpt.local/deliverables/_session/gate-definitions.json` — Gate catalog
- `.smartergpt.local/deliverables/_session/policy.json` — Execution policy

### Success Criteria
- Plan is syntactically valid and cycles-free
- Merge order computed successfully
- Gate definitions defined and reasonable
- All artifacts written to fixed deliverables dir

### Message Contract
```json
{
  "agent": "Planner",
  "status": "complete",
  "plan_valid": true,
  "total_prs": 5,
  "merge_levels": 3,
  "gates_defined": 4,
  "blockers": [],
  "artifacts": {
    "discover": ".smartergpt.local/deliverables/_session/discover.json",
    "plan": ".smartergpt.local/deliverables/_session/plan.json",
    "merge_order": ".smartergpt.local/deliverables/_session/merge-order.json"
  },
  "next_agent": "Umbrella Setup"
}
```

---

## Umbrella Setup

### Role & Objective
Create umbrella branch and draft PR; prepare checklist body.

### Inputs
- Default branch name
- Plan + merge-order from Planner
- GitHub repo info

### Allowed Tools
- `mcp:git.checkout ref="<branch>"` — switch branches
- `mcp:git.branch new_branch="<name>"` — create branch
- `mcp:git.push remote="origin" branch="<name>" set_upstream=true` — push branch
- `mcp:github.pr.create` — create draft PR
- `mcp:github.pr.update` — update PR body
- `filesystem/write` — create markdown/JSON files
- **Forbidden:** force-push, rebase, history rewrite

### Steps
1. **Generate UUID** and create umbrella branch name:
   ```bash
   SESSION_UUID="$(uuidgen | tr 'A-Z' 'a-z')"
   UMB_BRANCH="merge-weave-${SESSION_UUID}"
   DEF_BRANCH="main"  # or detect from repo
   ```

2. **Create and push umbrella branch** (MCP-first):
   ```bash
   mcp:git.fetch remote="origin"
   mcp:git.checkout ref="$DEF_BRANCH"
   mcp:git.pull mode="ff-only"
   mcp:git.checkout new_branch="$UMB_BRANCH" from="$DEF_BRANCH"
   mcp:git.push remote="origin" branch="$UMB_BRANCH" set_upstream=true
   ```
   Fallback: `git fetch && git checkout -b $UMB_BRANCH && git push -u origin $UMB_BRANCH`

3. **Create umbrella PR body** (checklist + Closes lines):
   ```bash
   cat > .smartergpt.local/deliverables/_session/umbrella-body.md << 'EOF'
   # Merge-Weave Session: {SESSION_UUID}

   ## Folded PRs
   - [ ] PR #... (branch: ...)
   - [ ] PR #... (branch: ...)

   ## Closes Issues
   Closes #...

   ## Status
   - **Umbrella Branch:** {UMB_BRANCH}
   - **Merge-Weave Session:** {SESSION_UUID}
   - **Gate Status:** pending

   ## Blockers
   (none yet)
   EOF
   ```

4. **Create draft umbrella PR** (MCP-first):
   ```bash
   mcp:github.pr.create \
     base="$DEF_BRANCH" \
     head="$UMB_BRANCH" \
     title="Merge-weave session ${SESSION_UUID}" \
     body_file=".smartergpt.local/deliverables/_session/umbrella-body.md" \
     draft=true \
     > .smartergpt.local/deliverables/_session/umbrella.json
   ```
   Fallback: `gh pr create --base $DEF_BRANCH --head $UMB_BRANCH --draft --title "Merge-weave session $SESSION_UUID" --body-file .smartergpt.local/deliverables/_session/umbrella-body.md`

5. **Extract umbrella PR number** from JSON for later updates.

### Artifacts
- `.smartergpt.local/deliverables/_session/umbrella.json` — PR metadata (number, URL, branch)
- `.smartergpt.local/deliverables/_session/umbrella-body.md` — PR body (kept up-to-date)

### Success Criteria
- Umbrella branch created and pushed
- Draft PR created successfully
- Body template ready for checklist updates

### Message Contract
```json
{
  "agent": "Umbrella Setup",
  "status": "complete",
  "umbrella_branch": "merge-weave-{uuid}",
  "umbrella_pr_number": 123,
  "umbrella_pr_url": "https://github.com/...",
  "session_uuid": "{uuid}",
  "next_agent": "Merge Orchestrator"
}
```

---

## Merge Orchestrator

### Role & Objective
Fold PR branches into umbrella, run gates, manage umbrella PR body, close folded PRs.

### Inputs
- Umbrella branch, PR number, URL
- Merge-order from Planner
- Gate definitions

### Allowed Tools
- `mcp:git.checkout`, `mcp:git.merge`, `mcp:git.commit`, `mcp:git.push` — fold PRs (git outputs merge logs)
- `mcp:github.pr.update` — update umbrella PR body (github outputs status)
- `mcp:github.pr.comment` — comment on PRs (github outputs status)
- `mcp:github.pr.close` — close folded PRs (github outputs status)
- `mcp:tool.run name="lex-pr" args=["execute", "--plan", "...", "--artifact-dir", "...", "--json"]` — run gates (lex-pr outputs gate results JSON + logs)
- `filesystem/read`, `filesystem/write` — capture and organize outputs
- **You (agent) responsibility:** Run MCP tools, capture outputs (gate results, merge logs), save to fixed paths
- **Forbidden:** force-push, rebase, history rewrite

### Steps (pseudocode per level)
```bash
# For each level in merge-order:
for PR in level_items; do
  PR_BRANCH="<PR branch name>"

  # Dry-run fold
  git checkout $UMB_BRANCH
  git merge --no-commit --no-ff "origin/${PR_BRANCH}" 2>&1 | tee -a dryrun.log
  if [ $? -ne 0 ]; then
    echo "BLOCKED: merge conflict on $PR" >> blockers.md
    git merge --abort
    continue
  fi

  # Run gates on umbrella + PR_BRANCH (lex-pr outputs gate results as JSON to stdout)
  # Agent captures JSON output; lex-pr writes detailed gate artifacts to --artifact-dir
  mcp:tool.run name="lex-pr" args=["execute", "--plan", "plan.json", \
    "--artifact-dir", ".smartergpt.local/deliverables/_session/gate-artifacts", \
    "--json"] \
    | tee gate-result-${PR}.json

  if ! jq -e '.execution.mergeSummary.failed | length == 0' gate-result-${PR}.json; then
    echo "BLOCKED: gates failed for $PR. See gate-result-${PR}.json" >> blockers.md
    git merge --abort
    continue
  fi

  # Commit the fold-in
  git commit -m "merge-weave: fold PR #${PR_NUM} into ${UMB_BRANCH}"
  git push origin $UMB_BRANCH

  # Close the folded PR
  gh pr comment $PR_NUM --body "Folded into umbrella PR #$UMB_PR_NUM"
  gh pr close $PR_NUM

  # Update umbrella PR body with checklist
  # (check off [ ] → [x], add final status)
  mcp:github.pr.update number="$UMB_PR_NUM" body_file=".smartergpt.local/deliverables/_session/umbrella-body.md"
done
```

### Artifacts
**Agent session artifacts (you create/capture):**
- `.smartergpt.local/deliverables/_session/gate-result-{PR}.json` — gate summary JSON (lex-pr MCP tool output captured)
- `.smartergpt.local/deliverables/_session/fold.log` — merge + push logs (git MCP tool outputs captured)
- `.smartergpt.local/deliverables/_session/blockers.md` — blocker log (merge conflicts, failed gates; you create)
- `.smartergpt.local/deliverables/_session/umbrella-body.md` — umbrella PR body with checklist (you update)
- `.smartergpt.local/deliverables/_session/fold-summary.json` — fold statistics (you compute from logs)

**lex-pr internal artifacts (lex-pr creates via `--artifact-dir`):**
- `.smartergpt.local/deliverables/_session/gate-artifacts/{gate-name}/` — detailed gate logs, coverage, test results, build artifacts (created by `lex-pr execute --artifact-dir ...`)

### Success Criteria
- All eligible PRs folded into umbrella
- Gates pass after each fold-in
- Umbrella PR body kept up-to-date
- Folded PRs closed with comment
- Blockers documented

### Message Contract
```json
{
  "agent": "Merge Orchestrator",
  "status": "complete|halted",
  "folded_prs": 3,
  "blocked_prs": 1,
  "failed_prs": 0,
  "blockers": [
    {
      "pr": 5,
      "reason": "unit tests failed after fold-in",
      "recovery": "Fix tests in PR #5 and rerun"
    }
  ],
  "umbrella_pr_updated": true,
  "next_agent": "Finalization"
}
```

---

## Finalization

### Role & Objective
Mark umbrella PR ready, merge to default branch, verify state.

### Inputs
- Umbrella PR number, branch
- All folds complete and gates passing

### Allowed Tools
- `mcp:github.pr.ready` — mark PR as ready for review (if draft)
- `mcp:github.pr.merge` — merge PR with normal merge (no squash/rebase)
- `mcp:git.push` — push final state
- **Forbidden:** force-push, delete umbrella branch automatically

### Steps
1. **Mark PR ready** (if still draft):
   ```bash
   mcp:github.pr.ready number="$UMB_PR_NUM"
   ```
   Fallback: `gh pr ready $UMB_PR_NUM` (or manual via GitHub UI)

2. **Merge umbrella PR** (normal merge, no-ff):
   ```bash
   mcp:github.pr.merge number="$UMB_PR_NUM" method="merge" delete_branch=false
   ```
   Fallback: `gh pr merge $UMB_PR_NUM --merge --delete-branch=false`

3. **Verify final state**:
   ```bash
   git fetch origin
   git log --oneline origin/main | head -10  # verify merge commit is there
   ```

4. **Emit summary report** and link to umbrella PR URL.

### Artifacts
- Final merge commit SHA in `.smartergpt.local/deliverables/_session/merge-summary.json`

### Message Contract
```json
{
  "agent": "Finalization",
  "status": "complete",
  "umbrella_pr_merged": true,
  "merge_commit": "abc123...",
  "summary_url": "https://github.com/.../pull/{UMB_PR_NUM}",
  "notes": "All PRs successfully folded and merged."
}
```

---

## Rollback & Recovery

### When Triggered
- Merge conflict or gate failure during fold-in
- Post-merge blocker surface
- Manual recovery request

### Safe Recovery (no history rewrite)
1. **Identify the problematic fold-in** from `.smartergpt.local/deliverables/_session/fold-ins.ndjson`.
2. **Revert merge commit** (creates new revert commit):
   ```bash
   git log --oneline origin/$UMB_BRANCH | head -5  # find the merge commit SHA
   git revert -m 1 <sha>
   git push origin $UMB_BRANCH
   ```
3. **Update umbrella PR body**: mark reverted PR as "reverted", add recovery note.
4. **Fix PR locally** on its own branch.
5. **Re-run fold-in** when ready.

### Example Flow
```
Problem: PR #5 unit tests fail after fold-in
Action:  Revert merge of PR #5
         Update umbrella PR body: "PR #5 reverted due to test failure"
         Comment on original PR #5 with recovery guidance
         User fixes PR #5 tests
         Re-run fold-in for PR #5
```

---

## Execution Order
1. **Planner** — discover PRs, generate plan, compute order
2. **Umbrella Setup** — create umbrella branch & draft PR
3. **Merge Orchestrator** — fold PRs, run gates, update body, close PRs
4. **Finalization** — mark ready, merge umbrella PR
5. **Rollback & Recovery** — if needed

---

## Fixed Paths & Defaults
- **Deliverables:** `.smartergpt.local/deliverables/_session` (no placeholders)
- **Schema:** `schema/plan.schema.json`
- **Default branch:** auto-detected from repo (or specify `--target`)
- **MCP Prefix:** `mcp:tool.run name="lex-pr" args=[...]`

---

## How to Use This Prompt
1. **Copy this entire prompt** into a chat with an MCP-enabled Claude instance.
2. **Paste and send.** Claude will roleplay all agents, using MCP tool calls to discover PRs, generate plans, fold them, run gates, and manage the umbrella PR.
3. **Review artifacts** in `.smartergpt.local/deliverables/_session/` as progress is made.
4. **For issues**, refer to Rollback & Recovery section or request guidance in chat.
