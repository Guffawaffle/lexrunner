# Manual Test Checklist

This checklist provides comprehensive manual testing steps for the front-end capture pipeline commands.

## Prerequisites

- [ ] GITHUB_TOKEN environment variable set (`export GITHUB_TOKEN=ghp_...`)
- [ ] Test repository available (e.g., `Guffawaffle/test-repo`)
- [ ] lexrunner built: `npm run build`
- [ ] Confirm `dist/cli.js` exists

## Test Environment Setup

```bash
# Set GitHub token
export GITHUB_TOKEN=ghp_your_token_here

# Build the project
cd /path/to/lexrunner
npm run build

# Verify build succeeded
ls -la dist/cli.js
```

---

## `lex-pr idea` Tests

### Test 1: Basic Usage (Dry Run)

**Objective:** Verify Feature Spec v0 generation without Issue creation

```bash
# Run command
node dist/cli.js idea \
  --title "Test Feature" \
  --description "Test description" \
  --dry-run

# Expected results:
# ✓ Feature Spec v0 created in .smartergpt.local/deliverables/_session/
# ✓ File name follows pattern: idea-YYYY-MM-DDTHH-MM-SS.json
# ✓ Schema validation passes
# ✓ No GitHub Issue created
```

**Validation:**
- [ ] Feature Spec v0 file exists
- [ ] File contains valid JSON
- [ ] Schema version is "0.1.0"
- [ ] Title and description match input
- [ ] No error messages

---

### Test 2: Interactive Mode

**Objective:** Verify interactive prompts work correctly

```bash
# Run command (no flags)
node dist/cli.js idea

# When prompted, enter:
# - Title: "Interactive Test Feature"
# - Description: "Testing interactive mode"
# - Acceptance criteria: "Test passes" (press Enter twice to finish)
```

**Validation:**
- [ ] Prompts appear for title, description, acceptance criteria
- [ ] Can enter multiple acceptance criteria lines
- [ ] Feature Spec v0 generated with correct data
- [ ] No error messages

---

### Test 3: Issue Creation

**Objective:** Verify GitHub Issue creation

```bash
# Run command
GITHUB_TOKEN=ghp_... node dist/cli.js idea \
  --title "Test Issue Creation" \
  --description "Verify Issue creation works"

# Expected results:
# ✓ Feature Spec v0 created
# ✓ GitHub Issue created with [IDEA] prefix
# ✓ Labels: 'idea', 'needs-triage' applied
# ✓ Issue URL displayed
```

**Validation:**
- [ ] GitHub Issue created successfully
- [ ] Issue title has `[IDEA]` prefix
- [ ] Issue has `idea` and `needs-triage` labels
- [ ] Issue body contains fingerprint (view HTML source)
- [ ] Feature Spec v0 file created locally

---

### Test 4: Idempotent Updates

**Objective:** Verify fingerprint-based idempotent updates

```bash
# Step 1: Create initial Issue
GITHUB_TOKEN=ghp_... node dist/cli.js idea \
  --title "Test Idempotency" \
  --description "Initial description"
# Note the Issue number (e.g., #123)

# Step 2: Update with same content (should be no-op)
GITHUB_TOKEN=ghp_... node dist/cli.js idea \
  --title "Test Idempotency" \
  --description "Initial description" \
  --update-issue 123

# Expected: "No changes detected (fingerprint unchanged)"

# Step 3: Update with different content
GITHUB_TOKEN=ghp_... node dist/cli.js idea \
  --title "Test Idempotency (revised)" \
  --description "Updated description" \
  --update-issue 123

# Expected: Issue updated
```

**Validation:**
- [ ] No-op update skips unnecessary API calls
- [ ] Content update successfully modifies Issue
- [ ] Fingerprint changes in Issue body
- [ ] No duplicate Issues created

---

### Test 5: Custom Output Path

**Objective:** Verify custom output paths work

```bash
# Create temp directory
mkdir -p /tmp/lex-pr-test

# Run with custom output
node dist/cli.js idea \
  --title "Custom Path Test" \
  --description "Testing custom output" \
  --output /tmp/lex-pr-test/my-spec.json \
  --dry-run

# Verify file exists
ls -la /tmp/lex-pr-test/my-spec.json
```

**Validation:**
- [ ] File created at specified path
- [ ] Content is valid Feature Spec v0
- [ ] No error messages

---

## `lex-pr create-project` Tests

### Test 6: Basic Usage (Dry Run)

**Objective:** Verify Execution Plan v1 generation without Issue creation

```bash
# Run command with example spec
node dist/cli.js create-project \
  --spec examples/front-end-capture-pipeline/idea-dark-mode.json \
  --dry-run

# Expected results:
# ✓ Execution Plan v1 created
# ✓ File name follows pattern: plan-YYYY-MM-DDTHH-MM-SS.json
# ✓ Schema validation passes
# ✓ No GitHub Issues created
```

**Validation:**
- [ ] Execution Plan v1 file exists
- [ ] File contains valid JSON
- [ ] Schema version is "1.0.0"
- [ ] Epic and 3 sub-issues defined
- [ ] Dependencies correct (tests/docs depend on feature-impl)
- [ ] No error messages

---

### Test 7: Epic + Sub-Issue Creation

**Objective:** Verify GitHub Epic and Sub-Issues creation

```bash
# Run command
GITHUB_TOKEN=ghp_... node dist/cli.js create-project \
  --spec examples/front-end-capture-pipeline/idea-dark-mode.json

# Expected results:
# ✓ Execution Plan v1 created
# ✓ Epic Issue created with 'epic' label
# ✓ 3 Sub-Issues created (feature, testing, docs)
# ✓ Sub-Issues reference Epic
# ✓ All Issue URLs displayed
```

**Validation:**
- [ ] Epic Issue created successfully
- [ ] Epic has `epic` label
- [ ] 3 Sub-Issues created (one per type)
- [ ] Sub-Issues have correct types in title/labels
- [ ] Sub-Issues reference Epic number
- [ ] Execution Plan v1 file created locally

---

### Test 8: Custom Labels

**Objective:** Verify custom label application

```bash
# Run with custom labels
GITHUB_TOKEN=ghp_... node dist/cli.js create-project \
  --spec examples/front-end-capture-pipeline/idea-dark-mode.json \
  --epic-labels "phase-1,high-priority" \
  --issue-labels "sprint-3"

# Expected: Epic has 'phase-1', 'high-priority' labels
# Expected: Sub-Issues have 'sprint-3' label
```

**Validation:**
- [ ] Epic has specified custom labels
- [ ] Sub-Issues have specified custom labels
- [ ] Default labels still applied (`epic`, etc.)

---

### Test 9: Sub-Issue Linking

**Objective:** Verify sub-issue linking/unlinking

```bash
# Test 1: With linking (default)
GITHUB_TOKEN=ghp_... node dist/cli.js create-project \
  --spec examples/front-end-capture-pipeline/idea-dark-mode.json

# Verify: Sub-Issues reference Epic in body

# Test 2: Without linking
GITHUB_TOKEN=ghp_... node dist/cli.js create-project \
  --spec examples/front-end-capture-pipeline/idea-dark-mode.json \
  --no-link

# Verify: Sub-Issues created but don't reference Epic
```

**Validation:**
- [ ] Default behavior links sub-issues to Epic
- [ ] `--no-link` flag skips linking
- [ ] Both modes create all Issues successfully

---

## Safety Mechanism Tests

### Test 10: PR Prevention

**Objective:** Verify PR-related flags are rejected

```bash
# Try invalid flag
node dist/cli.js idea \
  --title "Test" \
  --description "Test" \
  --create-pr

# Expected: Error "SAFETY VIOLATION: Flag --create-pr not allowed"
```

**Validation:**
- [ ] Error message displayed
- [ ] Command exits with non-zero status
- [ ] No Issue created

---

### Test 11: Artifact Path Restrictions

**Objective:** Verify unsafe paths are blocked

```bash
# Try PR directory path
node dist/cli.js idea \
  --title "Test" \
  --description "Test" \
  --output artifacts/PR-123/spec.json \
  --dry-run

# Expected: Error "SAFETY VIOLATION: Cannot write to PR artifact directory"
```

**Validation:**
- [ ] Error message displayed
- [ ] Command exits with non-zero status
- [ ] No file created

---

### Test 12: Schema Validation

**Objective:** Verify invalid specs are rejected

```bash
# Create invalid spec (missing title)
cat > /tmp/invalid-spec.json << 'EOF'
{
  "schemaVersion": "0.1.0",
  "description": "Missing title"
}
EOF

# Try to use it
node dist/cli.js create-project \
  --spec /tmp/invalid-spec.json \
  --dry-run

# Expected: Error "Schema validation failed: title: Required"
```

**Validation:**
- [ ] Schema validation error displayed
- [ ] Detailed error message with field name
- [ ] Command exits with non-zero status

---

## End-to-End Workflow Tests

### Test 13: Complete Pipeline

**Objective:** Verify full workflow from idea to project

```bash
# Step 1: Capture idea
GITHUB_TOKEN=ghp_... node dist/cli.js idea \
  --title "E2E Test Feature" \
  --description "Testing end-to-end workflow"

# Note the output spec file path

# Step 2: Generate project
GITHUB_TOKEN=ghp_... node dist/cli.js create-project \
  --spec .smartergpt.local/deliverables/_session/idea-<timestamp>.json

# Expected:
# ✓ Idea Issue created
# ✓ Epic created
# ✓ 3 Sub-Issues created
# ✓ All Issues linked correctly
```

**Validation:**
- [ ] Idea Issue created with correct title
- [ ] Epic Issue created
- [ ] 3 Sub-Issues created and linked
- [ ] All artifacts saved locally
- [ ] No error messages

---

## Cleanup

After testing, clean up test Issues and artifacts:

```bash
# Remove local artifacts
rm -rf .smartergpt.local/deliverables/_session/idea-*.json
rm -rf .smartergpt.local/deliverables/_session/plan-*.json

# Close test Issues on GitHub
# (Manual step: close Issues via GitHub UI)
```

---

## Test Summary

After completing all tests, verify:

- [ ] All basic commands work (dry run mode)
- [ ] Interactive mode functions correctly
- [ ] GitHub Issue creation successful
- [ ] Idempotent updates work as expected
- [ ] Safety mechanisms block invalid operations
- [ ] Schema validation catches errors
- [ ] End-to-end workflow completes successfully
- [ ] Documentation matches actual behavior

---

## Notes

- Run tests in a test repository to avoid cluttering production repos
- Some tests require a valid `GITHUB_TOKEN` with appropriate permissions
- Dry run tests can be executed without a GitHub token
- Test Issues can be closed/deleted after validation
