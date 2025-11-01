# Stand-Alone Merge-Weave Kickoff Prompt (umbrella branch + PR, **MCP-first**)

## Context
You will plan and execute a **merge-weave** into a single umbrella branch and PR:
- Create **`merge-weave-{uuid}`** from the default branch (e.g., `main`).
- Fold designated **open PR branches** into that umbrella branch **in topological order**.
- Open one **umbrella PR → default branch**, keep its body updated with a checklist of folded PRs and **“Closes #issue”** lines for linked issues.
- As each PR branch successfully folds in, **close that PR** (add a comment noting it was folded into the umbrella PR).
- After all levels pass gates on the umbrella branch, merge the umbrella PR to default.

**Deliverables dir (fixed):** `.smartergpt.local/deliverables/_session`
**Local schema path (fixed):** `schema/plan.schema.json`
**History safety:** no force-push, no history rewrites.

> **Preference:** Use **MCP tools first** for git/GitHub operations (e.g., `mcp:git.*`, `mcp:github.*`). If an MCP op is unavailable, **fallback** to `gh` CLI; if that’s unavailable, emit equivalent **REST** calls (with method/path/body).

---

## Inputs Needed (minimal)
- **Default branch name** (e.g., `main`).
- **Open PR list** to fold (number → head branch). If not provided, discover via MCP first:
  ```bash
  mcp:github.pr.list state="open" fields=["number","headRefName","baseRefName","url"]
  # Fallback
  gh pr list --json number,headRefName,baseRefName,url
  # Fallback (REST outline)
  GET /repos/{owner}/{repo}/pulls?state=open
  ```
- **Known dependencies** between PRs (optional; otherwise infer conservatively).
- **Issue links** per PR (optional; infer from PR bodies/labels where possible).

---

## Policy & Guardrails
- **Dry-run first** for each fold-in (test-merge without committing).
- **Proceed with passing siblings** at a level; record blockers precisely.
- **Forward momentum**: allow **minimal, obvious, safe** code edits to unblock; otherwise halt with a crisp report.
- **Merge strategy**: `git merge --no-ff` for each fold-in; **merge umbrella PR** with a normal merge (no squash/rebase) for auditability.
- **Close folded PRs** immediately after a successful fold-in (comment with umbrella PR reference).
- **Close issues** by placing **“Closes #…”** lines in the umbrella PR body; these close when the umbrella PR merges.
- **No force-push**; no history rewrites.

---

## Gates (Uniform Contract)
Write gate catalog and policy first:
- `.smartergpt.local/deliverables/_session/gate-definitions.json`
- `.smartergpt.local/deliverables/_session/policy.json` (requiredGates, proceedWithSiblings=true, mergeStrategy="no-fast-forward")

Auto-detect commands from repo if possible (e.g., `npm run lint`, `composer test`, `pytest -q`, `npm run build && git diff --exit-code`); otherwise use sensible defaults. Timeouts/log paths live under `.smartergpt.local/deliverables/_session/`.

---

## Plan & Merge Pyramid
1) Build `.smartergpt.local/deliverables/_session/plan.json` (nodes: id, branch, dependsOn[], gates[]).
2) Compute `.smartergpt.local/deliverables/_session/merge-order.json` (levels + mergeSequence).
3) Emit `.smartergpt.local/deliverables/_session/dryrun.{md,json}` (narrative + machine form).

---

## Umbrella Branch & PR Workflow (MCP-first)

### Create umbrella branch (and PR shell)
```bash
SESSION_UUID="$(uuidgen | tr 'A-Z' 'a-z')"
UMB_BRANCH="merge-weave-${SESSION_UUID}"
DEF="main"  # set to the actual default branch

# MCP-first branch setup
mcp:git.fetch remote="origin"
mcp:git.checkout ref="$DEF"
mcp:git.pull mode="ff-only"
mcp:git.checkout new_branch="$UMB_BRANCH" from="$DEF"
mcp:git.push remote="origin" branch="$UMB_BRANCH" set_upstream=true

# Fallback (gh)
gh repo sync || true
git fetch origin && git checkout "$DEF" && git pull --ff-only
git checkout -b "$UMB_BRANCH"
git push -u origin "$UMB_BRANCH"

# Create umbrella PR (draft) — MCP-first
mcp:github.pr.create base="$DEF" head="$UMB_BRANCH" title="Merge-weave session ${SESSION_UUID}"       body_file=".smartergpt.local/deliverables/_session/umbrella-body.md" draft=true       > ".smartergpt.local/deliverables/_session/umbrella.json"

# Fallback (gh)
gh pr create --base "$DEF" --head "$UMB_BRANCH"       --title "Merge-weave session ${SESSION_UUID}"       --body-file ".smartergpt.local/deliverables/_session/umbrella-body.md"       --draft | tee ".smartergpt.local/deliverables/_session/umbrella.txt"

# Fallback (REST outline)
POST /repos/{owner}/{repo}/pulls
{
  "title": "Merge-weave session ${SESSION_UUID}",
  "head": "$UMB_BRANCH",
  "base": "$DEF",
  "body": "<contents of umbrella-body.md>",
  "draft": true
}
```

Keep **umbrella body** at `.smartergpt.local/deliverables/_session/umbrella-body.md`:
- Checklist of folded PRs: `- [x] Folded PR #123 (branch foo)`
- “Closes #…” lines for issues that should close when umbrella merges
- “Blockers” section

Update PR body (MCP-first; then gh; then REST outline):
```bash
mcp:github.pr.update from_file=".smartergpt.local/deliverables/_session/umbrella-body.md"
gh pr edit --body-file ".smartergpt.local/deliverables/_session/umbrella-body.md"
PATCH /repos/{owner}/{repo}/pulls/{number} { "body": "<file contents>" }
```

### Fold each PR branch (per merge-pyramid order)
_For each item in each level (siblings can proceed independently if safe):_
```bash
PR_NUMBER=123
PR_BRANCH="feature/xyz"

# Stage dry-run against umbrella branch (MCP-first)
mcp:git.checkout ref="$UMB_BRANCH"
mcp:git.merge ref="origin/${PR_BRANCH}" no_commit=true no_ff=true       | tee ".smartergpt.local/deliverables/_session/dryrun-pr-${PR_NUMBER}.log"       || { echo "BLOCKED: conflicts merging PR #${PR_NUMBER}" >> .smartergpt.local/deliverables/_session/dryrun.md; mcp:git.merge abort=true; exit 1; }

# Fallback (git)
git checkout "$UMB_BRANCH"
git merge --no-commit --no-ff "origin/${PR_BRANCH}" 2>&1 | tee ".smartergpt.local/deliverables/_session/dryrun-pr-${PR_NUMBER}.log"       || { echo "BLOCKED: conflicts merging PR #${PR_NUMBER}" >> .smartergpt.local/deliverables/_session/dryrun.md; git merge --abort; exit 1; }

# Run gates anchored on umbrella + PR_BRANCH (sketch)
# (lint/type/unit/determinism; write logs under deliverables/_session/)
# If a tiny, obvious fix is needed, commit it now with a clear message.
# Otherwise abort merge and record blocker.

# Determinism example
npm run build 2>&1 | tee .smartergpt.local/deliverables/_session/build-pr-${PR_NUMBER}.log
git diff --exit-code || { echo "BLOCKED: determinism failed for #${PR_NUMBER}" >> .smartergpt.local/deliverables/_session/dryrun.md; mcp:git.merge abort=true || git merge --abort; exit 2; }

# Commit the fold-in (no squash/rebase)
mcp:git.commit message="merge-weave: fold PR #${PR_NUMBER} (${PR_BRANCH}) into ${UMB_BRANCH} (no-ff)"
mcp:git.push
# Fallback
git commit -m "merge-weave: fold PR #${PR_NUMBER} (${PR_BRANCH}) into ${UMB_BRANCH} (no-ff)" && git push
```

### Close the folded PR and log the fold-in
```bash
# Comment and close via MCP-first
UMB_NUMBER="$(jq -r '.number // empty' .smartergpt.local/deliverables/_session/umbrella.json)"
mcp:github.pr.comment number="$PR_NUMBER" body="Folded into umbrella PR #${UMB_NUMBER} (${UMB_BRANCH})."
mcp:github.pr.close number="$PR_NUMBER"

# Fallback (gh)
gh pr comment "${PR_NUMBER}" --body "Folded into umbrella PR #${UMB_NUMBER} (${UMB_BRANCH})."
gh pr close "${PR_NUMBER}"

# Fallback (REST outline)
POST /repos/{owner}/{repo}/issues/{PR_NUMBER}/comments { "body": "Folded into umbrella PR #${UMB_NUMBER} ..." }
PATCH /repos/{owner}/{repo}/pulls/{PR_NUMBER} { "state": "closed" }

# Track fold-in status
jq -n --arg pr "${PR_NUMBER}" --arg br "${PR_BRANCH}" --arg status "folded"       '{pr: $pr, branch: $br, status: $status, at: now}'       >> .smartergpt.local/deliverables/_session/fold-ins.ndjson
```

### Keep umbrella PR body up to date
```bash
mcp:github.pr.update number="$UMB_NUMBER" from_file=".smartergpt.local/deliverables/_session/umbrella-body.md"
gh pr edit "${UMB_NUMBER}" --body-file ".smartergpt.local/deliverables/_session/umbrella-body.md"
PATCH /repos/{owner}/{repo}/pulls/{UMB_NUMBER} { "body": "<file contents>" }
```

---

## Finalization
When all levels are folded and umbrella gates pass:
```bash
# Ready the PR (if draft)
mcp:github.pr.ready number="$UMB_NUMBER"
gh pr ready "${UMB_NUMBER}"
# REST outline:
# No direct "ready" endpoint; update draft=false or convert via checks/workflow

# Merge umbrella PR with a normal merge commit (no squash/rebase)
mcp:github.pr.merge number="$UMB_NUMBER" method="merge" delete_branch=false
gh pr merge "${UMB_NUMBER}" --merge --delete-branch=false
# REST outline:
PUT /repos/{owner}/{repo}/pulls/{UMB_NUMBER}/merge { "merge_method": "merge" }
```

Do **not** delete the umbrella branch automatically unless policy dictates; keep it until post-merge verification passes.

---

## Saveable Artifacts
- `.smartergpt.local/deliverables/_session/plan.json`
- `.smartergpt.local/deliverables/_session/merge-order.json`
- `.smartergpt.local/deliverables/_session/gate-definitions.json`
- `.smartergpt.local/deliverables/_session/policy.json`
- `.smartergpt.local/deliverables/_session/dryrun.{md,json}`
- `.smartergpt.local/deliverables/_session/summary.md`
- `.smartergpt.local/deliverables/_session/recovery.md`
- `.smartergpt.local/deliverables/_session/umbrella.json` (PR number, URL, branch; when MCP returns JSON)
- `.smartergpt.local/deliverables/_session/umbrella-body.md` (kept up to date)
- `.smartergpt.local/deliverables/_session/fold-ins.ndjson` (append-only log of PR folds)

---

## Recovery (no rewrites)
- If a fold-in commit regresses or a later fold blocks:
  - **Revert the offending merge commit** on the umbrella branch (`git revert -m 1 <sha>`), push, update umbrella body/checklist.
  - Reopen the original PR if you previously closed it and the fix cannot live in umbrella.
  - Update `summary.md` and `recovery.md` with what changed and why.

---

### Conformance with our merge-weave rules
- **Dry-run first** at each fold-in; logs captured.
- **Proceed with siblings** when safe; blockers recorded.
- **Forward-momentum edits** allowed only when tiny & obvious.
- **No force-push**; merges are `--no-ff`, umbrella merged with normal merge.
- **Umbrella PR** drives closure of issues via body text; folded PRs are explicitly **closed** as they’re integrated.
- **Fixed paths** under `.smartergpt.local/deliverables/_session`; no placeholders.
- **MCP-first** operations with `gh`/REST fallbacks everywhere.
