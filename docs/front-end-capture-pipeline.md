# Front-End Capture Pipeline

This guide explains the front-end capture pipeline for lex-pr-runner, which enables rapid idea-to-project workflows using GitHub Issues (no PRs).

## Overview

The pipeline consists of two commands:
1. **`lex-pr idea`** - Capture ideas, generate Feature Spec v0, create Idea Issues
2. **`lex-pr create-project`** - Load Feature Spec v0, generate Execution Plan v1, create Epic + Sub-Issues

## Design Principles

- **Issues-only**: No PR creation or PR artifacts
- **Idempotent**: Fingerprinting prevents duplicate Issues
- **Deterministic**: Schema-validated inputs/outputs
- **Safe**: Guards prevent accidental PR creation and unsafe writes
- **Portable**: Artifacts stored in `.smartergpt.local/deliverables/_session/`

## Command Reference

### `lex-pr idea`

**Purpose:** Capture feature ideas and create Idea Issues

**Inputs:**
- Title, description, acceptance criteria (interactive or flags)
- Optional: technical context, constraints

**Outputs:**
- Feature Spec v0 JSON (validated)
- GitHub Idea Issue with fingerprint

**Fingerprinting:**
- Deterministic hash of title + description + acceptance criteria
- Embedded in Issue body as HTML comment: `<!-- lex-pr-idea-fingerprint: abc123... -->`
- Used for idempotent updates (only update if fingerprint changes)

**Example:**
```bash
lex-pr idea --title "Add webhooks" --description "Allow users to configure webhooks"
```

---

### `lex-pr create-project`

**Purpose:** Generate project structure from Feature Spec v0

**Inputs:**
- Feature Spec v0 JSON (from `lex-pr idea`)

**Outputs:**
- Execution Plan v1 JSON (validated)
- GitHub Epic Issue
- GitHub Sub-Issues (feature, testing, docs)

**Decomposition Strategy:**
- Epic: Top-level feature description
- Sub-Issue 1: Core implementation (type: `feature`)
- Sub-Issue 2: Tests (type: `testing`, depends on feature)
- Sub-Issue 3: Docs (type: `docs`, depends on feature)

**Example:**
```bash
lex-pr create-project --spec .smartergpt.local/deliverables/_session/idea-2025-11-09.json
```

---

## Workflow Patterns

### Pattern 1: Quick Idea Capture

```bash
# Interactive mode (prompts for all inputs)
lex-pr idea

# Generates:
# - .smartergpt.local/deliverables/_session/idea-2025-11-09T14-30-00.json
# - GitHub Issue #456 [IDEA] <title>
```

### Pattern 2: Batch Idea Processing

```bash
# Capture multiple ideas (dry run)
lex-pr idea --title "Feature 1" --description "Desc 1" --dry-run
lex-pr idea --title "Feature 2" --description "Desc 2" --dry-run
lex-pr idea --title "Feature 3" --description "Desc 3" --dry-run

# Review specs, then create Issues
lex-pr idea --title "Feature 1" --description "Desc 1"
lex-pr idea --title "Feature 2" --description "Desc 2"
lex-pr idea --title "Feature 3" --description "Desc 3"
```

### Pattern 3: Idea → Project Pipeline

```bash
# Step 1: Capture idea
lex-pr idea --title "Add webhooks" --description "Configure webhooks for events"

# Step 2: Generate project
lex-pr create-project --spec .smartergpt.local/deliverables/_session/idea-<timestamp>.json

# Result:
# - Epic Issue #457
# - Sub-Issue #458 (feature)
# - Sub-Issue #459 (testing)
# - Sub-Issue #460 (docs)
```

### Pattern 4: Idempotent Updates

```bash
# Create initial Issue
lex-pr idea --title "Add webhooks" --description "Configure webhooks" # Issue #456

# Update Issue (fingerprint changes)
lex-pr idea --title "Add webhooks (revised)" --description "Configure webhooks with filters" --update-issue 456

# No-op update (fingerprint unchanged)
lex-pr idea --title "Add webhooks (revised)" --description "Configure webhooks with filters" --update-issue 456
```

---

## Safety Mechanisms

### PR Prevention

**Guards:**
- `assertNoCreatePR()` - Detects PR creation in call stack
- `validateNoCreatePRFlags()` - Rejects PR-related flags

**Blocked operations:**
- `octokit.pulls.create()`
- `octokit.pulls.merge()`
- Flags: `--create-pr`, `--pr`, `--pull-request`, `--merge`

### Artifact Path Restrictions

**Allowed paths:**
- `.smartergpt.local/deliverables/_session/`
- `.smartergpt.local/runner/logs/`

**Blocked paths:**
- `/PR-<number>/`
- `/artifacts/PR-*/`
- `/pr-<number>/`

**Validation:**
```typescript
isSafeArtifactPath('/path/to/output.json') // throws if unsafe
```

### Schema Validation

**Pre-flight checks:**
- Feature Spec v0 validated before Issue creation
- Execution Plan v1 validated before Issue creation
- Detailed error messages with line numbers

**Example error:**
```
Schema validation failed (Feature Spec v0):
  1. title: Required
  2. acceptanceCriteria: Array must contain at least 1 element(s)
```

---

## Troubleshooting

### Error: GITHUB_TOKEN required

**Cause:** `GITHUB_TOKEN` environment variable not set

**Solution:**
```bash
export GITHUB_TOKEN=ghp_...
lex-pr idea --title "Test"
```

### Error: SAFETY VIOLATION - Cannot write to PR artifact directory

**Cause:** Output path targets PR directory

**Solution:**
```bash
# ❌ WRONG
lex-pr idea --output artifacts/PR-123/spec.json

# ✅ CORRECT
lex-pr idea --output .smartergpt.local/deliverables/_session/spec.json
```

### Error: Schema validation failed

**Cause:** Input data does not conform to schema

**Solution:**
1. Check schema version in JSON file
2. Review error messages for missing/invalid fields
3. Validate JSON syntax (use `jq` or JSON linter)

---

## Cross-Platform Notes

**Windows:**
- Paths use backslashes (`\`) but are normalized to forward slashes (`/`) internally
- WSL paths (`/mnt/c/...`) automatically converted

**Linux/macOS:**
- Native forward slashes (`/`)
- Tilde expansion (`~`) supported

**Git context:**
- Repository auto-detected from `git remote get-url origin`
- Branch name extracted from `git rev-parse --abbrev-ref HEAD`

---

## Schema Locations

Schemas are provided by the `Lex` repo (Guffawaffle/lex):

- Feature Spec v0: `.smartergpt/schemas/feature-spec-v0.json`
- Execution Plan v1: `.smartergpt/schemas/execution-plan-v1.json`
- Idea Prompt Template: `.smartergpt/prompts/idea.md`
- Create-Project Prompt Template: `.smartergpt/prompts/create-project.md`

See: [Guffawaffle/lex#191](https://github.com/Guffawaffle/lex/issues/191) for schema definitions.

---

## Command Options Reference

### `lex-pr idea`

| Option | Type | Description |
|--------|------|-------------|
| `--title <string>` | String | Idea title (interactive if omitted) |
| `--description <string>` | String | Brief description (interactive if omitted) |
| `--interactive` | Boolean | Force interactive mode |
| `--dry-run` | Boolean | Generate spec without creating Issue |
| `--output <path>` | String | Output path for Feature Spec v0 |
| `--repo <owner/repo>` | String | Target repository (default: auto-detect) |
| `--label <label>` | String | Additional labels (repeatable) |
| `--update-issue <num>` | Number | Update existing Issue (idempotent) |

**Default output path:**
`.smartergpt.local/deliverables/_session/idea-{timestamp}.json`

### `lex-pr create-project`

| Option | Type | Description |
|--------|------|-------------|
| `--spec <path>` | String | Feature Spec v0 file (required) |
| `--dry-run` | Boolean | Generate plan without creating Issues |
| `--output <path>` | String | Output path for Execution Plan v1 |
| `--repo <owner/repo>` | String | Target repository (default: from spec) |
| `--project <name/num>` | String | Link Issues to GitHub Project |
| `--epic-labels <labels>` | String | Additional Epic labels (comma-separated) |
| `--issue-labels <labels>` | String | Additional sub-issue labels (comma-separated) |
| `--no-link` | Boolean | Skip sub-issue linking |

**Default output path:**
`.smartergpt.local/deliverables/_session/plan-{timestamp}.json`

---

## Examples

See the [examples/front-end-capture-pipeline/](../examples/front-end-capture-pipeline/) directory for:

- Working shell scripts demonstrating both commands
- Example JSON files (Feature Spec v0, Execution Plan v1)
- Manual test checklist for validation
- Complete workflow examples

---

## Related Documentation

- [CLI Reference](cli.md) - Complete command documentation
- [Architecture](architecture.md) - System design & philosophy
- [Troubleshooting](troubleshooting.md) - Common issues & solutions
- [Quickstart Guide](quickstart.md) - 5-minute onboarding
