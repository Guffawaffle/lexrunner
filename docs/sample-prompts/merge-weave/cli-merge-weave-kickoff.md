# CLI Merge-Weave Kickoff Prompt (Umbrella Branch + PR, **Shell CLI**)

---

## Context
You will plan and execute a **merge-weave** into a single umbrella branch and PR using **lex-pr-runner CLI**:
- **Discover** open PRs from GitHub; `lex-pr discover` outputs JSON.
- **Plan:** `lex-pr plan --from-github` generates plan.json with dependency suggestions.
- **Order:** `lex-pr merge-order` computes topological sort; outputs levels + execution plan.
- **Create umbrella branch** (`merge-weave-{uuid}`) from default; open draft PR with checklist.
- **Fold PRs:** For each PR (in order), merge into umbrella branch, then run `lex-pr execute --plan plan.json` to validate gates.
  - `lex-pr execute` collects gate logs, test results, and any failures into artifacts (stdout as JSON).
  - You (agent) collect those artifacts and save to fixed paths.
- **Update umbrella PR body** with checklist checks as PRs fold successfully; **close** folded PRs.
- **Finalize:** Mark umbrella PR ready, merge to default.

**Agent session dir (fixed):** `.smartergpt.local/deliverables/_session` — for plans, merge logs, orchestration metadata
**lex-pr artifacts (configurable):** `lex-pr execute` writes gate artifacts to `--artifact-dir` (default: `./artifacts`)
  - **Recommended:** Use `--artifact-dir .smartergpt.local/deliverables/_session/gate-artifacts` to keep everything together
**Schema path (fixed):** `schema/plan.schema.json` — `lex-pr schema validate` uses this
**Safety:** No force-push, no history rewrites. Use `git revert` for safe undos.

> **Key insight:** `lex-pr` CLI is responsible for discovering PRs, generating plans, computing order, and running gates (it manages its own artifact collection internally). **You orchestrate the flow and capture lex-pr's JSON outputs to your session dir.** The two artifact spaces don't conflict—lex-pr writes gate logs/coverage to its `--artifact-dir`, you capture stdout (JSON) to `.smartergpt.local/deliverables/_session/`.

---

## Planner

### Role & Objective
Discover open PRs, generate and validate the merge plan, compute topological order, define gates.

### Inputs
- GitHub repo (owner/repo auto-detected from git remote, or specify via flags)
- Default branch name (e.g., `main`)
- PR filter criteria (labels, exclude list, etc.)

### Allowed Tools
- `lex-pr discover --json` — list open PRs from GitHub (lex-pr outputs JSON)
- `lex-pr plan --from-github --json` — generate plan.json with dependency suggestions (lex-pr outputs)
- `lex-pr schema validate plan.json --json` — validate plan structure (lex-pr outputs validation result)
- `lex-pr merge-order plan.json --json` — compute topological sort (lex-pr outputs levels + order)
- `jq`, `git log`, `git branch` — inspect and parse lex-pr outputs
- **You (agent) responsibility:** Capture outputs and save to fixed paths
- **Forbidden:** remote network calls, force-push, history rewrite

### Steps
1. **Discover PRs**:
   ```bash
   mkdir -p .smartergpt.local/deliverables/_session
   lex-pr discover --json > .smartergpt.local/deliverables/_session/discover.json
   echo "✓ Discovered $(jq '.total' .smartergpt.local/deliverables/_session/discover.json) PRs"
   ```

2. **Generate plan**:
   ```bash
   lex-pr plan --from-github --json > .smartergpt.local/deliverables/_session/plan.json
   echo "✓ Generated plan with $(jq '.items | length' .smartergpt.local/deliverables/_session/plan.json) items"
   ```

3. **Validate schema**:
   ```bash
   lex-pr schema validate .smartergpt.local/deliverables/_session/plan.json --json \
     | tee .smartergpt.local/deliverables/_session/plan.validate.json
   if jq -e '.valid == true' .smartergpt.local/deliverables/_session/plan.validate.json > /dev/null; then
     echo "✓ Plan validation passed"
   else
     echo "❌ Plan validation failed"
     exit 1
   fi
   ```

4. **Compute merge order**:
   ```bash
   lex-pr merge-order .smartergpt.local/deliverables/_session/plan.json --json \
     | tee .smartergpt.local/deliverables/_session/merge-order.json
   echo "✓ Merge order computed: $(jq '.levels | length' .smartergpt.local/deliverables/_session/merge-order.json) levels"
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
   echo "✓ Gate definitions written"
   ```

6. **Extract plan summary and return contract** to chat.

### Artifacts
- `.smartergpt.local/deliverables/_session/discover.json` — PR list from GitHub
- `.smartergpt.local/deliverables/_session/plan.json` — Generated plan (validated)
- `.smartergpt.local/deliverables/_session/merge-order.json` — Topological sort + levels
- `.smartergpt.local/deliverables/_session/gate-definitions.json` — Gate catalog
- `.smartergpt.local/deliverables/_session/plan.validate.json` — Validation result

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
- `git checkout`, `git branch`, `git push` — git operations
- `gh pr create`, `gh pr update` — GitHub CLI for PR operations
- Shell scripting (`cat`, `sed`, `jq`) — file operations
- **Forbidden:** force-push, rebase, history rewrite

### Steps
1. **Generate UUID and create umbrella branch name**:
   ```bash
   SESSION_UUID="$(uuidgen | tr 'A-Z' 'a-z')"
   UMB_BRANCH="merge-weave-${SESSION_UUID}"
   DEF_BRANCH="main"  # or detect: git symbolic-ref refs/remotes/origin/HEAD | cut -d'/' -f4

   echo "Session UUID: $SESSION_UUID"
   echo "Umbrella Branch: $UMB_BRANCH"
   ```

2. **Create and push umbrella branch**:
   ```bash
   git fetch origin
   git checkout "$DEF_BRANCH"
   git pull --ff-only
   git checkout -b "$UMB_BRANCH"
   git push -u origin "$UMB_BRANCH"
   echo "✓ Umbrella branch created and pushed: $UMB_BRANCH"
   ```

3. **Create umbrella PR body** (checklist + Closes lines):
   ```bash
   cat > .smartergpt.local/deliverables/_session/umbrella-body.md << EOF
   # Merge-Weave Session: ${SESSION_UUID}

   ## Folded PRs
   $(jq -r '.pullRequests[] | "- [ ] PR #\(.number) (\(.branch))"' .smartergpt.local/deliverables/_session/discover.json)

   ## Closes Issues
   (To be filled as PRs are analyzed)

   ## Status
   - **Umbrella Branch:** ${UMB_BRANCH}
   - **Merge-Weave Session:** ${SESSION_UUID}
   - **Gate Status:** pending

   ## Blockers
   (none yet)
   EOF
   echo "✓ Umbrella PR body template created"
   ```

4. **Create draft umbrella PR**:
   ```bash
   gh pr create --base "$DEF_BRANCH" --head "$UMB_BRANCH" \
     --title "Merge-weave session ${SESSION_UUID}" \
     --body-file .smartergpt.local/deliverables/_session/umbrella-body.md \
     --draft | tee .smartergpt.local/deliverables/_session/umbrella-pr-url.txt

   # Extract PR number
   UMB_PR_NUM=$(gh pr list --head "$UMB_BRANCH" --state draft --json number -q '.[0].number')
   echo "$UMB_PR_NUM" > .smartergpt.local/deliverables/_session/umbrella-pr-number.txt
   echo "✓ Umbrella PR created: #$UMB_PR_NUM"
   ```

### Artifacts
- `.smartergpt.local/deliverables/_session/umbrella-pr-number.txt` — PR number
- `.smartergpt.local/deliverables/_session/umbrella-pr-url.txt` — PR URL
- `.smartergpt.local/deliverables/_session/umbrella-body.md` — PR body (kept up-to-date)

### Success Criteria
- Umbrella branch created and pushed
- Draft PR created successfully
- Body template ready for checklist updates
- PR number saved for later updates

### Message Contract
```json
{
  "agent": "Umbrella Setup",
  "status": "complete",
  "umbrella_branch": "merge-weave-{uuid}",
  "umbrella_pr_number": 123,
  "session_uuid": "{uuid}",
  "next_agent": "Merge Orchestrator"
}
```

---

## Merge Orchestrator

### Role & Objective
Fold PR branches into umbrella, run gates, manage umbrella PR body, close folded PRs.

### Inputs
- Umbrella branch, PR number
- Merge-order from Planner
- Gate definitions

### Allowed Tools
- `git checkout`, `git merge`, `git commit`, `git push` — git operations (git outputs merge logs)
- `gh pr comment`, `gh pr close` — close and comment on PRs (gh outputs status)
- `gh pr edit` — update umbrella PR body
- `lex-pr execute --plan plan.json --json` — run gates on current branch (lex-pr outputs gate results JSON + logs)
- `jq`, `sed`, `cat`, `tee` — capture and manipulate outputs
- **You (agent) responsibility:** Run commands, capture outputs (gate results, merge logs), save to fixed paths
- **Forbidden:** force-push, rebase, history rewrite

### Steps (pseudocode per level)
```bash
# Load saved values from Planner's outputs
UMB_BRANCH=$(cat .smartergpt.local/deliverables/_session/umbrella-branch.txt)
UMB_PR_NUM=$(cat .smartergpt.local/deliverables/_session/umbrella-pr-number.txt)
MERGE_ORDER=$(cat .smartergpt.local/deliverables/_session/merge-order.json)

# For each level in merge-order:
jq -r '.levels[] | .items[]' .smartergpt.local/deliverables/_session/merge-order.json | while read PR_ITEM; do
  PR_NUM=$(echo "$PR_ITEM" | sed 's/PR-//')
  PR_BRANCH=$(jq -r --arg num "PR-$PR_NUM" '.pullRequests[] | select(.number == ($num | ltrimstr("PR-") | tonumber)) | .branch' \
    .smartergpt.local/deliverables/_session/discover.json)

  echo "=== Folding PR #$PR_NUM ($PR_BRANCH) ===" | tee -a .smartergpt.local/deliverables/_session/fold.log

  # Dry-run merge (git outputs merge details to stdout/stderr)
  git checkout "$UMB_BRANCH"
  if ! git merge --no-commit --no-ff "origin/${PR_BRANCH}" 2>&1 | tee -a .smartergpt.local/deliverables/_session/fold.log; then
    echo "BLOCKED: merge conflict on PR #$PR_NUM" | tee -a .smartergpt.local/deliverables/_session/blockers.md
    git merge --abort
    continue
  fi

  # Run gates on umbrella + PR_BRANCH (lex-pr outputs gate results as JSON to stdout)
  # Agent captures JSON output; lex-pr writes detailed gate artifacts to --artifact-dir
  if ! lex-pr execute --plan .smartergpt.local/deliverables/_session/plan.json \
    --artifact-dir .smartergpt.local/deliverables/_session/gate-artifacts \
    --json \
    | tee .smartergpt.local/deliverables/_session/gate-result-${PR_NUM}.json | \
    jq -e '.execution.mergeSummary.failed == null or (.execution.mergeSummary.failed | length == 0)' > /dev/null; then
    echo "BLOCKED: gates failed for PR #$PR_NUM. See gate-result-${PR_NUM}.json" | tee -a .smartergpt.local/deliverables/_session/blockers.md
    git merge --abort
    continue
  fi

  # Commit the fold-in (git outputs commit info)
  git commit -m "merge-weave: fold PR #${PR_NUM} (${PR_BRANCH}) into ${UMB_BRANCH}" \
    | tee -a .smartergpt.local/deliverables/_session/fold.log
  git push origin "$UMB_BRANCH" 2>&1 | tee -a .smartergpt.local/deliverables/_session/fold.log
  echo "✓ PR #$PR_NUM folded successfully" | tee -a .smartergpt.local/deliverables/_session/fold.log

  # Close the folded PR (gh outputs PR status)
  gh pr comment "$PR_NUM" --body "Folded into umbrella PR #$UMB_PR_NUM ($UMB_BRANCH). See .smartergpt.local/deliverables/_session/ for logs."
  gh pr close "$PR_NUM"

  # Update umbrella PR body (sed output not needed, just update the file)
  sed -i "s/- \[ \] PR #${PR_NUM}/- [x] PR #${PR_NUM}/" .smartergpt.local/deliverables/_session/umbrella-body.md
  gh pr edit "$UMB_PR_NUM" --body-file .smartergpt.local/deliverables/_session/umbrella-body.md
done

# Record summary (agent computes from logs)
jq -n \
  --arg folded "$(grep -c '✓ PR #' .smartergpt.local/deliverables/_session/fold.log || echo 0)" \
  --arg blocked "$(grep -c 'BLOCKED' .smartergpt.local/deliverables/_session/blockers.md || echo 0)" \
  '{folded_prs: ($folded | tonumber), blocked_prs: ($blocked | tonumber), timestamp: now | todate}' \
  > .smartergpt.local/deliverables/_session/fold-summary.json

echo "Fold summary saved to fold-summary.json"
```

### Artifacts
**Agent session artifacts (you create/capture):**
- `.smartergpt.local/deliverables/_session/gate-result-{PR}.json` — gate summary JSON (lex-pr stdout captured via `tee`)
- `.smartergpt.local/deliverables/_session/fold.log` — merge + push logs (git/gh stdout captured via `tee`)
- `.smartergpt.local/deliverables/_session/blockers.md` — blocker log (merge conflicts, failed gates; you create)
- `.smartergpt.local/deliverables/_session/umbrella-body.md` — umbrella PR body with checklist (you update)
- `.smartergpt.local/deliverables/_session/fold-summary.json` — fold statistics (you compute from logs)

**lex-pr internal artifacts (lex-pr creates via `--artifact-dir`):**
- `.smartergpt.local/deliverables/_session/gate-artifacts/{gate-name}/` — detailed gate logs, coverage, test results, build artifacts (created by `lex-pr execute --artifact-dir ...`)

### Success Criteria
- All eligible PRs folded into umbrella
- Gates pass after each fold-in
- Umbrella PR body kept up-to-date with checklist
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
- `gh pr ready` — mark PR as ready for review (if draft)
- `gh pr merge` — merge PR with normal merge (no squash/rebase)
- `git fetch`, `git log` — verify final state
- **Forbidden:** force-push, delete umbrella branch automatically

### Steps
1. **Mark PR ready** (if still draft):
   ```bash
   UMB_PR_NUM=$(cat .smartergpt.local/deliverables/_session/umbrella-pr-number.txt)
   gh pr ready "$UMB_PR_NUM"
   echo "✓ Umbrella PR marked as ready"
   ```

2. **Merge umbrella PR** (normal merge, no-ff):
   ```bash
   gh pr merge "$UMB_PR_NUM" --merge --delete-branch=false
   echo "✓ Umbrella PR merged"
   ```

3. **Verify final state**:
   ```bash
   git fetch origin
   DEF_BRANCH="main"
   git log --oneline "origin/$DEF_BRANCH" | head -10
   echo "✓ Final state verified"
   ```

4. **Emit summary report**:
   ```bash
   cat > .smartergpt.local/deliverables/_session/merge-summary.json << EOF
   {
     "umbrella_pr_merged": true,
     "umbrella_pr_number": $UMB_PR_NUM,
     "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
     "status": "complete"
   }
   EOF
   ```

### Artifacts
- `.smartergpt.local/deliverables/_session/merge-summary.json` — final merge summary

### Message Contract
```json
{
  "agent": "Finalization",
  "status": "complete",
  "umbrella_pr_merged": true,
  "umbrella_pr_number": 123,
  "timestamp": "2025-11-01T13:30:00Z",
  "notes": "All PRs successfully folded and merged."
}
```

---

## Rollback & Recovery

### When Triggered
- Merge conflict or gate failure during fold-in
- Post-merge blocker surfaces
- Manual recovery request

### Safe Recovery (no history rewrite)
1. **Identify the problematic fold-in**:
   ```bash
   git log --oneline "$UMB_BRANCH" | head -20
   # Find the merge commit SHA for the problematic PR
   ```

2. **Revert merge commit** (creates new revert commit):
   ```bash
   git revert -m 1 <sha>
   git push origin "$UMB_BRANCH"
   echo "✓ Reverted problematic merge"
   ```

3. **Update umbrella PR body**:
   ```bash
   # Edit .smartergpt.local/deliverables/_session/umbrella-body.md
   # Mark reverted PR, add recovery note
   gh pr edit "$UMB_PR_NUM" --body-file .smartergpt.local/deliverables/_session/umbrella-body.md
   ```

4. **Comment on original PR with recovery guidance**:
   ```bash
   gh pr comment "$PR_NUM" --body "This PR was reverted from umbrella weave. Please fix [details] and resubmit."
   ```

5. **User fixes PR locally**, then re-run fold-in.

### Example Flow
```bash
# Problem: PR #5 unit tests fail
# Action: Revert
REVERTED_SHA=$(git log --oneline origin/merge-weave-* | grep "PR #5" | awk '{print $1}')
git revert -m 1 "$REVERTED_SHA"
git push origin merge-weave-*

# Update checklist and comment
sed -i 's/- \[x\] PR #5/- [ ] PR #5 (reverted)/' umbrella-body.md
gh pr edit $UMB_PR_NUM --body-file umbrella-body.md
gh pr comment 5 --body "Reverted due to unit test failures. Please fix and resubmit."
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
- **Default branch:** auto-detected from repo (or `git symbolic-ref refs/remotes/origin/HEAD | cut -d'/' -f4`)
- **Commands:** `lex-pr discover`, `lex-pr plan`, `lex-pr execute`, `lex-pr schema validate`, `lex-pr merge-order`

---

## How to Use This Prompt
1. **Copy this entire prompt** into a new chat.
2. **Paste and send.** I will roleplay all agents, executing shell commands and lex-pr CLI to discover PRs, generate plans, fold them, run gates, and manage the umbrella PR.
3. **Review artifacts** in `.smartergpt.local/deliverables/_session/` as progress is made.
4. **For issues**, refer to Rollback & Recovery section or request guidance in chat.
