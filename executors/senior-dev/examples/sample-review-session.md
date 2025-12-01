# Sample Review Session

This example demonstrates a complete Senior Dev executor workflow for reviewing PR #42.

## Scenario

- **PR #42:** "Add gate validation improvements"
- **Author:** alice
- **Modules affected:** `src/gates`, `tests/gates`

---

## Step 1: Prepare Context

```bash
lexrunner senior-dev prepare-context --pr 42
```

**Output:**

```json
{
  "executor": "senior-dev",
  "phase": "deterministic-prep",
  "pr_number": "42",
  "base_branch": "main",
  "timestamp": "2024-12-01T10:00:00.000Z",
  "output_dir": "/tmp/senior-dev-review-42-2024-12-01T10-00-00",
  "artifacts": {
    "pr_metadata": "pr-metadata.json",
    "pr_description": "pr-description.md",
    "diff": "changes.diff",
    "diff_summary": "changes-summary.txt",
    "changed_files": "changed-files.txt",
    "lint": "lint-output.txt",
    "typecheck": "typecheck-output.txt",
    "tests": "test-output.txt",
    "frames": "related-frames.txt"
  },
  "commands_run": [
    { "command": "gh pr view --json", "status": "success", "duration_ms": 1200 },
    { "command": "git diff", "status": "success", "duration_ms": 50 },
    { "command": "git diff --name-only", "status": "success", "duration_ms": 30 },
    { "command": "npm run lint", "status": "success", "duration_ms": 5000 },
    { "command": "npm run typecheck", "status": "success", "duration_ms": 8000 },
    { "command": "npm test", "status": "success", "duration_ms": 45000 },
    { "command": "lex recall", "status": "success" }
  ],
  "modules_detected": ["src/gates", "tests/gates"]
}
```

---

## Step 2: Recall Context

```bash
lexrunner senior-dev recall-context --module src/gates
```

**Output:**

```json
{
  "executor": "senior-dev",
  "phase": "recall",
  "query_type": "module",
  "query": "src/gates",
  "timestamp": "2024-12-01T10:01:00.000Z",
  "frames": [
    {
      "id": "frame-2024-11-28-001",
      "timestamp": "2024-11-28T14:30:00.000Z",
      "reference_point": "PR-38 review src/gates",
      "summary_caption": "Gate report validation refactoring",
      "module_scope": ["src/gates"],
      "status_snapshot": {
        "next_action": "Merged successfully"
      }
    },
    {
      "id": "frame-2024-11-15-003",
      "timestamp": "2024-11-15T09:00:00.000Z",
      "reference_point": "PR-35 review src/gates",
      "summary_caption": "Added gate result caching",
      "module_scope": ["src/gates"],
      "status_snapshot": {
        "next_action": "Merged with suggestions"
      }
    }
  ],
  "related_frames": [
    {
      "id": "pattern-2024-11-20-001",
      "reference_point": "Pattern: Error handling in gates",
      "summary_caption": "Consistent error handling pattern for gate failures"
    }
  ],
  "suggested_prompt": "prompts/code-review.prompt.md"
}
```

---

## Step 3: Model Review (Stochastic Phase)

The model reviews the code using the recalled context and produces:

```json
{
  "summary": "Gate validation improvements with edge case handling",
  "verdict": "approve",
  "severity": "should-fix",
  "findings": [
    {
      "file": "src/gates/gateReport.ts",
      "line": 42,
      "severity": "should-fix",
      "category": "maintainability",
      "finding": "Magic number for timeout",
      "suggestion": "Extract to named constant: const GATE_TIMEOUT_MS = 30000",
      "teaching_point": "Named constants improve readability and make future changes easier"
    },
    {
      "file": "src/gates/gateReport.ts",
      "line": 78,
      "severity": "nit",
      "category": "style",
      "finding": "Inconsistent error message format",
      "suggestion": "Use template: `Gate ${gateName} failed: ${reason}`",
      "teaching_point": "Consistent error messages make debugging easier"
    },
    {
      "file": "tests/gates/gateReport.spec.ts",
      "line": 156,
      "severity": "praise",
      "category": "maintainability",
      "finding": "Excellent edge case coverage",
      "suggestion": null,
      "teaching_point": "Testing edge cases prevents regression bugs"
    }
  ],
  "patterns_observed": [
    {
      "pattern": "Magic numbers in configuration",
      "occurrences": 2,
      "recommendation": "Consider a gate config constants file"
    }
  ],
  "blockers": [],
  "next_action": "Address should-fix items, then merge"
}
```

---

## Step 4: Capture Frame

```bash
lexrunner senior-dev capture-frame \
  --pr 42 \
  --module src/gates \
  --summary "Gate validation improvements with edge case handling" \
  --next-action "Address should-fix items, then merge" \
  --severity should-fix \
  --developer alice
```

**Output:**

```json
{
  "executor": "senior-dev",
  "phase": "frame-capture",
  "timestamp": "2024-12-01T10:15:00.000Z",
  "frame_payload": {
    "reference_point": "PR-42 review src/gates",
    "summary_caption": "Gate validation improvements with edge case handling",
    "module_scope": ["src/gates"],
    "status_snapshot": {
      "next_action": "Address should-fix items, then merge"
    },
    "keywords": ["senior-dev", "review", "pr-42", "should-fix", "developer:alice"],
    "branch": "feature/gate-improvements"
  },
  "frame_id": "frame-2024-12-01-001",
  "success": true
}
```

---

## Summary

| Phase | Duration | Status |
|-------|----------|--------|
| Prepare Context | ~60s | ✅ Success |
| Recall Context | ~2s | ✅ Success |
| Model Review | ~10s | ✅ Complete |
| Capture Frame | ~1s | ✅ Success |

**Total Review Time:** ~75 seconds for a thorough code review with memory integration.

---

## Artifacts Generated

```
/tmp/senior-dev-review-42-2024-12-01T10-00-00/
├── pr-metadata.json
├── pr-description.md
├── changes.diff
├── changes-summary.txt
├── changed-files.txt
├── lint-output.txt
├── typecheck-output.txt
├── test-output.txt
├── related-frames.txt
└── context.json
```

## Frame in Lex Memory

```bash
lex recall "PR-42 review"
```

Returns the captured frame, available for future reviews of `src/gates`.
