# GitHub Copilot Instructions for lexrunner

**North Star:** _Fan-out tasks as multiple PRs in parallel, then build a merge pyramid from the blocks. Compute dependency order, run gates locally, and merge cleanly._

## Naming Quick Reference

Use canonical terms per [`docs/TERMS.md`](../docs/TERMS.md):

- **lexrunner (project/repo)**: The repository you're reading
- **Runner CLI (core runner)**: TypeScript command-line app under `src/**`
- **MCP server (adapter)**: Optional read-only adapter at `src/mcp/server.ts`
- **Workspace profile**: Portable example profile under `.smartergpt/**`

## Architecture guardrails

- **Two-track separation (firm):**
  - **Core runner**: `src/**` (CLI, core logic, packaging, MCP adapter). Never store user/work artifacts.
  - **Workspace example**: `.smartergpt/**` is a portable example profile only. Track: `intent.md`, `scope.yml`, `deps.yml`, `gates.yml`, `pull-request-template.md`. **Ignore**: `.smartergpt/runner/`, `cache/`, `deliverables/`. Deliverables are posted as a **PR comment**, not committed.
- **Language:** TypeScript only. Remove dead Python wiring when nearby but do not rewrite history.

## Build & test

- **Node:** 20 LTS.
- **Install:** `npm ci`
- **Common scripts:**
  - Lint: `npm run lint`
  - Types: `npm run typecheck`
  - Test: `npm test`
  - Build: `npm run build`
- **Determinism check:** After `npm run build && npm run format`, the tree must be clean: `git diff --exit-code`.

## PR conventions

- **One PR = One chat.** Keep scope tight and acceptance criteria explicit.
- Add a **"How to verify"** section (exact commands + expected outcomes).
- **Commit style**: imperative mood ("Add…", "Fix…", "Update…") with optional prefixes (`runner:`, `mcp:`, `schema:`, `tests:`, `ci:`, `docs:`, `workspace:`).
- Prefer **plan + tests first** when requested (it's common here).

## Tasks Copilot should prioritize

- CI hygiene, docs, small refactors, test coverage, schema changes, CLI ergonomics, non-critical bug fixes.
- Avoid broad/ambiguous migrations, cross-repo designs, or anything requiring secrets or production credentials.

## Execution Rules (Cost Management)

- **NEVER stop mid-task to ask questions** - complete the full workflow when intent is clear
- **NO todo management for straightforward operations** - just execute directly
- **Complete merge-weave workflows**: discover real PRs → merge to integration → merge to main → close PRs → cleanup
- **Use real data**: `gh pr list` not fake plans when user asks for "all open PRs"
- **Finish completely**: don't declare success until the full contract is fulfilled

## Coding notes

- Outputs and ordering must be **stable/deterministic** (no random, time-dependent ordering; sort explicitly).
- Keep runtime deps minimal. Dev/test deps OK when justified in the PR.
- Never commit secrets or auth tokens. Do not modify branch protections.

## Merge-Weave Operations

When user requests merge-weave on "all open PRs":

1. `gh pr list --state open` to get real PRs (not fake plans)
2. Execute merge-weave with conflict resolution
3. Merge integration branch to main
4. Close successfully merged PRs with cleanup
5. Push changes to remote
6. **NEVER** stop to ask questions - complete the full workflow

### Umbrella Branch Pattern (When Blocked)

**It is OK to merge-weave into an umbrella/integration branch when individual PRs are blocked by branch protection.**

The umbrella branch pattern:

1. Create integration branch: `git checkout -b integration/wave-N`
2. Merge all PRs into umbrella branch (resolve conflicts here)
3. Run full local CI: `npm run lint && npm run typecheck && npm test`
4. **Only the final PR from umbrella → main requires approval**
5. The umbrella is just building foundation to do a single gate and push to main in CI

**Key insight:** Individual PR blocks don't matter during weave—we're building a verified bundle.

### Admin Authority Delegation

**Standing Grant (effective 2025-12-05):** Guff grants GitHub Copilot (Senior Dev / Eager PM personas) delegated `--admin` merge authority to main **when all local CI passes**.

**Conditions for `--admin` merge:**

1. All local CI gates pass: `npm run lint && npm run typecheck && npm test`
2. Merge target is `main` branch
3. Document CI pass in merge commit message

**What this enables:**

- Bypass branch protection review requirements for Copilot-authored PRs
- Self-merge after verified CI pass (no human approval needed for routine work)

**What this does NOT grant:**

- Authority to merge others' PRs without Guff's explicit approval
- Bypass of CI gates (all gates must pass locally)
- Any access to production credentials or secrets

**Authority chain:** Guff (admin, standing grant) → Copilot personas (delegated, CI-gated)

## File Editing Rules (MANDATORY)

> **⚠️ SELF-CHECK BEFORE EVERY FILE EDIT:**
>
> - [ ] Am I about to use `sed`, `awk`, `perl`, or shell redirection?
> - [ ] If YES → STOP. Use `replace_string_in_file` instead.
> - [ ] If NO → Verify I'm using the correct editing tool.

**Core Principle: ALWAYS use the provided editing tools. NEVER use shell commands to edit files unless explicitly requested.**

### Available Editing Tools (USE THESE)

1. **`replace_string_in_file`** - Primary editing tool
   - Use for ALL file modifications
   - Include 3-5 lines of context before/after the change
   - MUST provide exact literal strings (no placeholders, no `...existing code...`)

2. **`read_file`** - Context gathering
   - Use BEFORE editing to understand the file
   - Read large meaningful chunks (50-100 lines)
   - Prefer one large read over many small reads

3. **`create_file`** - New file creation
   - Use for new files only
   - Never use for editing existing files

4. **`get_errors`** - Validation
   - Use AFTER editing to verify correctness
   - Check TypeScript, lint, and syntax errors

### FORBIDDEN Editing Approaches

❌ **NEVER use these for file editing:**

- `sed -i` or any sed command
- `awk` for in-place modification
- `perl -pi -e`
- `echo "..." > file` or `cat > file`
- `git checkout --ours/--theirs` followed by manual edits
- Heredocs (`cat << EOF`) to write code
- `vim`, `nano`, or editor commands in terminal

### Conflict Resolution Protocol

When encountering git merge conflicts:

**❌ WRONG Approach:**

```bash
git checkout --theirs src/file.ts
sed -i 's/pattern/replacement/g' src/file.ts
git add src/file.ts
```

**✅ CORRECT Approach:**

```typescript
// Step 1: Read the conflict
read_file({ filePath: "/path/to/file.ts", startLine: 1, endLine: 200 });

// Step 2: Resolve with replace_string_in_file
replace_string_in_file({
  filePath: "/path/to/file.ts",
  oldString: `import { initColorControl } from "./util/colorControl.js";
<<<<<<< HEAD
import { writeJsonOutput } from "./cli/output.js";
import { exitHandler } from "./cli/exitHandler.js";
||||||| parent
=======
import { parseGlobalFlags } from "./cli/flags.js";
>>>>>>> branch
import * as fs from "fs";`,
  newString: `import { initColorControl } from "./util/colorControl.js";
import { parseGlobalFlags } from "./cli/flags.js";
import { writeJsonOutput } from "./cli/output.js";
import { exitHandler } from "./cli/exitHandler.js";
import * as fs from "fs";`,
});

// Step 3: Verify
get_errors({ filePaths: ["/path/to/file.ts"] });
```

### When Shell Commands ARE Appropriate

✅ **Allowed shell command usage:**

- Git operations: `git fetch`, `git merge`, `git commit`, `git push`
- Build commands: `npm run build`, `npm test`, `npm run lint`
- File inspection: `cat`, `head`, `tail`, `wc`, `ls`, `find`
- Search: `grep`, `git diff`, `git log`
- Directory operations: `mkdir`, `cp`, `mv`, `rm` (files/dirs, not editing)

❌ **NOT allowed:**

- Any command that modifies file CONTENTS
- Text processing that results in file changes

### Compliance Checklist

Before using a terminal command to modify a file, ask:

1. ❓ Is this editing file contents? → Use `replace_string_in_file`
2. ❓ Am I creating a new file? → Use `create_file`
3. ❓ Am I reading a file? → Use `read_file`
4. ❓ Did the user EXPLICITLY ask for a shell command? → Only then proceed

**Violation of these rules is considered a critical error and may result in:**

- Rejected changes requiring complete rework
- Loss of Copilot context/trust
- Need to manually verify all edits
- Potential file corruption requiring git reset

**When in doubt:** Always choose editing tools over shell commands.

### Common lexrunner Editing Scenarios

**Scenario 1: Merge conflict in src/cli.ts (imports)**

```typescript
// ❌ WRONG
git checkout --theirs src/cli.ts
sed -i '/import { initColorControl/a import { newModule } from "./new.js";' src/cli.ts

// ✅ CORRECT
read_file({ filePath: "src/cli.ts", startLine: 1, endLine: 50 })
replace_string_in_file({
  filePath: "src/cli.ts",
  oldString: `import { initColorControl } from "./util/colorControl.js";
<<<<<<< HEAD
import { writeJsonOutput } from "./cli/output.js";
=======
import { parseGlobalFlags } from "./cli/flags.js";
>>>>>>> branch`,
  newString: `import { initColorControl } from "./util/colorControl.js";
import { parseGlobalFlags } from "./cli/flags.js";
import { writeJsonOutput } from "./cli/output.js";`
})
get_errors({ filePaths: ["src/cli.ts"] })
```

**Scenario 2: Update schema version in plan.json**

```typescript
// ❌ WRONG
sed -i 's/"schemaVersion": "1.0.0"/"schemaVersion": "1.1.0"/' plan.json

// ✅ CORRECT
read_file({ filePath: "plan.json", startLine: 1, endLine: 20 })
replace_string_in_file({
  filePath: "plan.json",
  oldString: `{
  "schemaVersion": "1.0.0",
  "items": [`,
  newString: `{
  "schemaVersion": "1.1.0",
  "items": [`
})
```

**Scenario 3: Add gate to existing plan item**

```typescript
// ❌ WRONG
echo '{"name": "e2e", "run": "npm run e2e"}' >> temp &&
cat temp | jq '.items[0].gates += [input]' plan.json

// ✅ CORRECT
read_file({ filePath: "plan.json", startLine: 1, endLine: 100 })
replace_string_in_file({
  filePath: "plan.json",
  oldString: `      "gates": [
        {
          "name": "lint",
          "run": "npm run lint"
        }
      ]`,
  newString: `      "gates": [
        {
          "name": "lint",
          "run": "npm run lint"
        },
        {
          "name": "e2e",
          "run": "npm run e2e"
        }
      ]`
})
```

### Post-Conflict Validation (Required)

After resolving any merge conflict with `replace_string_in_file`:

1. **Check syntax:** `get_errors({ filePaths: ["<resolved-file>"] })`
2. **Verify imports:** Ensure all modules are properly imported
3. **Test build:** Run `npm run build` to catch integration issues
4. **Type check:** Run `npm run typecheck` for TypeScript files
5. **Document resolution:** Note which files had conflicts in commit message

**Example commit message:**

```
Merge PR-XXX: Feature description

Resolved conflicts:
- src/cli.ts: Combined imports from output, exitHandler, and flags modules
- Used writeJsonOutput with jsonModeActive flag

Files touched: src/cli.ts
```

### Known Anti-Patterns (Learn from Past Violations)

**Case Study: Merge-Weave Conflict Resolution (2025-10-13)**

**Context:** Merging 4 CLI modularization PRs with overlapping changes in `src/cli.ts`

❌ **What was done WRONG:**

```bash
# Violation 1: Used git checkout to blindly accept one side
git checkout --theirs src/cli.ts

# Violation 2: Used sed to add imports
sed -i '/import { parseGlobalFlags/a import { \n\tCLIExitSignal...' src/cli.ts

# Violation 3: Used sed with regex for bulk replacements
sed -i 's/console\.log(canonicalJSONStringify(\(.*\)));/writeJsonOutput(\1);/g' src/cli.ts

# Violation 4: Created shell script with heredocs
cat > /tmp/resolve.sh << 'EOF'
git checkout --theirs src/cli.ts
sed -i '...'
EOF
```

**Problems:**

- Non-deterministic: sed regex could match unintended code
- No validation: No immediate feedback if edits succeeded
- Hard to debug: Shell escaping and quoting made errors opaque
- Not auditable: Changes not visible in tool logs

✅ **What SHOULD have been done:**

```typescript
// Step 1: Read the full conflict context
read_file({ filePath: "src/cli.ts", startLine: 1, endLine: 100 });

// Step 2: Resolve EACH conflict block precisely
replace_string_in_file({
  filePath: "src/cli.ts",
  oldString: `import { initColorControl } from "./util/colorControl.js";
<<<<<<< HEAD
import { writeJsonOutput } from "./cli/output.js";
import {
      CLIExitSignal,
      throwExit,
      installSignalHandlers,
      installUnhandledRejectionHandler
} from "./cli/exitHandler.js";
||||||| parent
=======
import { parseGlobalFlags } from "./cli/flags.js";
>>>>>>> branch
import * as fs from "fs";`,
  newString: `import { initColorControl } from "./util/colorControl.js";
import { parseGlobalFlags } from "./cli/flags.js";
import { writeJsonOutput } from "./cli/output.js";
import {
      CLIExitSignal,
      throwExit,
      installSignalHandlers,
      installUnhandledRejectionHandler
} from "./cli/exitHandler.js";
import * as fs from "fs";`,
});

// Step 3: Verify TypeScript validity
get_errors({ filePaths: ["src/cli.ts"] });

// Step 4: Repeat for each remaining conflict block
```

**Impact of violations:** 2 hours debugging, non-deterministic results, violated documented guidelines

**Lesson:** Shell commands feel faster but create technical debt. Tool-based edits are deterministic and auditable.

### Related Documentation

These file editing rules align with and extend the principles in:

- [`AGENTS.md`](../AGENTS.md) - Overall agent operating principles
- [`docs/TERMS.md`](../docs/TERMS.md) - Canonical terminology

**Violation of these rules is considered a critical error.**

## Version Contracts

This repo uses **version contracts** to keep scope bounded and "done" meaningful. See [`docs/attestation/Lex_Guff_Version_Contract_Pact_v1.0.0.md`](../docs/attestation/Lex_Guff_Version_Contract_Pact_v1.0.0.md) for the full pact.

### Key rules for AI agents

1. **Recognize contracts**: A scope/DoD marked with `[signed ~]` (Guff) and `[signed Lex ✶]` (Lex) is a **frozen contract** for the current iteration. Treat it as binding.

2. **Label scope creep**: If new work goes beyond the signed contract, explicitly call it **next-version scope** and suggest parking it—don't silently integrate it.

3. **Challenge amendments**: Contract changes require discussion. Push back if a change appears driven by anxiety or perfectionism rather than necessity, or if it would break the current iteration.

4. **Push for clarity**: Call out vague acceptance criteria. Ask for checkable, concrete promises before treating something as a contract.

5. **Prompt for signatures**: If something _functions_ as a contract but lacks `[signed ~]`, ask the user to add the signature marker before treating it as binding.

6. **Amendments are versioned**: If a contract must change, it becomes a new version (e.g., v0.2) with fresh signatures—never a silent edit.

## Directory quick map

- `src/` – core library & CLI.
- `schema/` – generated schemas kept in sync with source (CI verifies).
- `tests/` – Vitest unit/integration tests (`*.spec.ts`).
- `.github/` – workflows, repo instructions.
- `.smartergpt/` – portable example profile (see guardrails above).
