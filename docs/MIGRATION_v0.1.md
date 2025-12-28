# Migration Guide: Upgrading to v0.1

**Target Audience:** LexRunner users upgrading from pre-release versions to v0.1.0
**Release Date:** November 6, 2025
**Status:** Stable

> **Scope note (Doc Lockdown):** This guide describes **v0.1.x behavior**.
>
> - In v0.1, Frame emission (when enabled) writes JSON files under `.lexrunner/frames/`.
> - A future **v2** design may store Frames in **Lex** instead of local files; if/when that ships, this doc will be versioned accordingly.

---

## Overview

Version 0.1.0 marks the first official release of **LexRunner**, establishing clear product branding and laying the foundation for Lex memory system integration.

### What's New in v0.1

1. **Product Branding & Naming Clarity**
   - Clear separation between LexRunner (proprietary) and Lex (MIT OSS)
   - New release tag format: `lexrunner-v*.*.*`
   - Updated README and documentation with branding

2. **Architecture Decision Records (ADRs)**
   - ADR-000: Product Naming & Branding
   - ADR directory structure in `docs/adr/`

3. **Frame Emission Foundation**
   - Frame emitter utilities for workflow execution tracking
   - Optional Frame emission for merge-weave, gates, and executors
   - Storage to `.lexrunner/frames/` directory

4. **Release Process**
   - Deterministic release workflow
   - Signed git tags with `lexrunner-v*` pattern

---

## Breaking Changes

✅ **No breaking changes in v0.1.0**

This is the first stable release. All changes are additive and maintain backward compatibility.

---

## Migration Steps

### Step 1: Update Installation

If you installed from a pre-release version, update your installation:

```bash
# Via npm (if previously installed)
npm update -g lexrunner

# Or via git
cd /path/to/LexRunner
git fetch origin
git checkout lexrunner-v0.1.0
npm ci
npm run build
```

### Step 2: Verify Version

```bash
lex-pr --version
# Expected: 0.1.0 or higher
```

### Step 3: Update Documentation References

If your team documentation references the project, update terminology:

**Before:**

- "lexrunner" (ambiguous)
- "runner" (generic)

**After:**

- "LexRunner" (product name)
- "`lex-pr`" (CLI command)
- "Lex" when referring to MIT OSS core

### Step 4: Enable Frame Emission (Optional)

Frame emission is **disabled by default**. To enable it:

```bash
export LEX_PR_EMIT_FRAMES=true
```

Or add to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.):

```bash
# Enable LexRunner Frame emission
export LEX_PR_EMIT_FRAMES=true
```

---

## New Features Guide

### Frame Emission

Frames capture execution context for workflow runs, enabling memory and audit capabilities.

#### What Are Frames?

Frames are structured snapshots of workflow execution state, including:

- **Reference point**: Unique identifier for the execution
- **Summary caption**: Human-readable description
- **Module scope**: Affected components/modules
- **Outcome**: Success, partial, or failure
- **Next actions**: Suggested follow-up steps
- **Metadata**: Duration, artifacts, errors, etc.

#### Enabling Frame Emission

Frame emission is controlled by the `LEX_PR_EMIT_FRAMES` environment variable:

```bash
# Enable Frame emission
export LEX_PR_EMIT_FRAMES=true

# Disable Frame emission (default)
export LEX_PR_EMIT_FRAMES=false
# or
unset LEX_PR_EMIT_FRAMES
```

#### Where Frames Are Stored

Frames are stored in `.lexrunner/frames/` directory:

```bash
.lexrunner/
  frames/
    merge-weave-2025-11-06-abc123.json
    gate-test-item1-2025-11-06-def456.json
    executor-review-2025-11-06-ghi789.json
```

#### Frame Types

1. **Merge-Weave Frames** (`type: "merge-weave"`)
   - Emitted when merge-weave operations complete
   - Captures: merged PRs, conflicts resolved, gates passed/failed

2. **Gate Frames** (`type: "gate"`)
   - Emitted when gates execute
   - Captures: gate name, exit code, duration, artifacts

3. **Executor Frames** (`type: "execution"`)
   - Emitted when executors run
   - Captures: procedure name, module scope, artifacts

4. **Procedure Frames** (`type: "procedure"`)
   - Emitted when procedures execute
   - Captures: procedure name, plan hash, outcome

#### Example: Merge-Weave Frame

```json
{
  "type": "merge-weave",
  "reference_point": "merge-weave-2025-11-06-abc123",
  "summary_caption": "Merged 3 PRs (#123, #124, #125) into main",
  "module_scope": ["#123", "#124", "#125"],
  "keywords": ["merge-weave", "integration", "main"],
  "outcome": "success",
  "next_actions": ["Run e2e tests", "Deploy to staging", "Verify integration"],
  "metadata": {
    "duration_ms": 45000,
    "conflicts_resolved": 2,
    "gates_passed": ["lint", "test"],
    "gates_failed": [],
    "run_id": "run-2025-11-06-xyz",
    "plan_hash": "sha256:abc..."
  },
  "stored_at": "2025-11-06T14:32:10.123Z"
}
```

#### Using Frames

**1. Audit Trail**

Frames provide a historical record of workflow executions:

```bash
# List all frames
ls -1 .lexrunner/frames/

# View a specific frame
cat .lexrunner/frames/merge-weave-2025-11-06-abc123.json | jq .

# Filter by outcome
jq 'select(.outcome == "failure")' .lexrunner/frames/*.json
```

**2. Debugging**

When a workflow fails, check the Frame for context:

```bash
# Find recent failures
find .lexrunner/frames -name "*.json" -mtime -1 | \
  xargs jq 'select(.outcome == "failure")'
```

**3. Integration with Lex**

Frames use the same schema as Lex memory system, enabling future integration:

```bash
# Future: Push frames to Lex memory API
# (Not yet implemented in v0.1)
```

---

## Before/After Examples

### Example 1: Running Merge-Weave

**Before v0.1 (Pre-release):**

```bash
# No frame emission
lex-pr merge plan.json --execute
# Merge completes, no audit trail
```

**After v0.1 (with Frame emission enabled):**

```bash
# Enable frames
export LEX_PR_EMIT_FRAMES=true

# Run merge-weave
lex-pr merge plan.json --execute

# Frame automatically created
ls .lexrunner/frames/
# merge-weave-2025-11-06-abc123.json
```

### Example 2: Product Naming

**Before v0.1:**

- Project referred to as "lexrunner" (inconsistent)
- Unclear distinction from Lex OSS core

**After v0.1:**

- **Product**: LexRunner (proprietary)
- **CLI**: `lex-pr` (unchanged)
- **OSS Core**: Lex (separate repository)
- Clear licensing: LexRunner (Proprietary), Lex (MIT)

### Example 3: Release Tags

**Before v0.1:**

```bash
# Old tag format
git tag v0.0.1  # Ambiguous
```

**After v0.1:**

```bash
# New tag format
git tag lexrunner-v0.1.0  # Clear product identity
```

---

## Configuration Changes

### New Environment Variables

| Variable             | Default | Description                   |
| -------------------- | ------- | ----------------------------- |
| `LEX_PR_EMIT_FRAMES` | `false` | Enable/disable Frame emission |

### Existing Variables (Unchanged)

All existing environment variables remain unchanged:

- `LEX_PR_PROFILE_DIR`
- `ALLOW_MUTATIONS`
- `LEX_GIT_MODE`
- `LEX_DEFAULT_BRANCH`

See [Environment Variables Guide](./environment-variables.md) for details.

---

## Deprecations

✅ **No deprecations in v0.1.0**

All pre-release features and APIs remain available.

---

## Troubleshooting

### Issue: Frames Not Being Created

**Symptom:**

```bash
lex-pr merge plan.json --execute
# Completes successfully, but no frames in .lexrunner/frames/
```

**Solution:**

1. **Check if Frame emission is enabled:**

   ```bash
   echo $LEX_PR_EMIT_FRAMES
   # Should output: true
   ```

2. **Enable Frame emission:**

   ```bash
   export LEX_PR_EMIT_FRAMES=true
   lex-pr merge plan.json --execute
   ```

3. **Check frames directory:**
   ```bash
   ls -la .lexrunner/frames/
   ```

### Issue: "Product Name Changed" Confusion

**Symptom:**

- Confused about "LexRunner" vs "lexrunner" vs "Lex"

**Clarification:**

| Term          | Meaning                                       |
| ------------- | --------------------------------------------- |
| **LexRunner** | Product name (proprietary paid product)       |
| **lexrunner** | Repository name (unchanged)                   |
| **lex-pr**    | CLI command (unchanged)                       |
| **Lex**       | OSS core library (MIT license, separate repo) |

**What stays the same:**

- CLI command: `lex-pr`
- npm package name: `lexrunner`
- Repository URL: `Guffawaffle/LexRunner`

**What changed:**

- Product branding: Now called "LexRunner"
- Release tags: Now use `lexrunner-v*` format
- Documentation: Clarifies LexRunner (paid) vs Lex (OSS)

### Issue: Old Tag Format

**Symptom:**

```bash
git tag v0.0.1  # Old format
```

**Solution:**

Use new tag format for future releases:

```bash
git tag lexrunner-v0.1.0  # New format
```

Old tags remain for backward compatibility.

### Issue: Frame Storage Permissions

**Symptom:**

```bash
Error: EACCES: permission denied, mkdir '.lexrunner/frames'
```

**Solution:**

1. **Check directory permissions:**

   ```bash
   ls -ld .lexrunner
   ```

2. **Create directory with correct permissions:**

   ```bash
   mkdir -p .lexrunner/frames
   chmod 755 .lexrunner/frames
   ```

3. **Check parent directory:**
   ```bash
   # Ensure current directory is writable
   touch .lexrunner/test
   rm .lexrunner/test
   ```

### Issue: Frame Validation Errors

**Symptom:**

```bash
Error: Frame validation failed: missing required field 'reference_point'
```

**Solution:**

This is an internal error. File a bug report with:

1. LexRunner version: `lex-pr --version`
2. Command that triggered the error
3. Full error message
4. Relevant logs

---

## Module Aliasing (Lex Integration)

LexRunner v0.1 lays the groundwork for Lex module aliasing integration.

### What is Module Aliasing?

Module aliasing allows you to use shorthand names for modules in Frame tagging:

```bash
# Instead of: "src/cli/commands/fanout"
# Use: "cli-core"
```

### Current Status (v0.1)

- **Frame emission**: Available (opt-in via `LEX_PR_EMIT_FRAMES`)
- **Module aliasing**: Not yet implemented (planned for v0.2+)
- **Lex API integration**: Not yet implemented (planned for v0.2+)

### Related Documentation

- [Aliasing for LexRunner](./ALIASING_FOR_LEXRUNNER.md) - Full alias guide (future)
- [Lex Integration](./LEX_INTEGRATION.md) - Integration patterns

---

## CI/CD Integration

Frame emission works in CI/CD environments:

### GitHub Actions

```yaml
name: Merge Automation

on:
  workflow_dispatch:

jobs:
  merge-prs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "20"

      - name: Run merge-weave with Frame emission
        env:
          LEX_PR_EMIT_FRAMES: true # Enable frames
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          npm install -g lexrunner
          lex-pr plan --from-github
          lex-pr execute plan.json
          lex-pr merge plan.json --execute

      - name: Upload Frame artifacts
        uses: actions/upload-artifact@v3
        with:
          name: execution-frames
          path: .lexrunner/frames/*.json
```

### Jenkins

```groovy
pipeline {
  agent any

  environment {
    LEX_PR_EMIT_FRAMES = 'true'
  }

  stages {
    stage('Merge') {
      steps {
        sh 'lex-pr plan --from-github'
        sh 'lex-pr execute plan.json'
        sh 'lex-pr merge plan.json --execute'
      }
    }

    stage('Archive Frames') {
      steps {
        archiveArtifacts artifacts: '.lexrunner/frames/*.json'
      }
    }
  }
}
```

---

## Related Documentation

### Core Guides

- [README](../README.md) - Project overview and quickstart
- [CHANGELOG](../CHANGELOG.md) - Version history
- [Architecture](./architecture.md) - System design

### ADRs (Architecture Decision Records)

- [ADR-000: Product Naming & Branding](./adr/ADR-000-product-naming-and-branding.md)
- [ADR Index](./adr/README.md) - All ADRs

### Lex Integration

- [Lex Integration Guide](./LEX_INTEGRATION.md) - API integration examples
- [Aliasing for LexRunner](./ALIASING_FOR_LEXRUNNER.md) - Module aliasing
- [Lex OSS Repository](https://github.com/Guffawaffle/lex) - MIT core

### Developer Guides

- [Environment Variables](./environment-variables.md) - Configuration reference
- [Release Process](./release-process.md) - How releases work
- [Migration Guide](./migration-guide.md) - General migration patterns

---

## Getting Help

### Issues or Questions?

1. **Check existing documentation:** See [docs/](./) directory
2. **Search issues:** [GitHub Issues](https://github.com/Guffawaffle/LexRunner/issues)
3. **File a bug report:** [New Issue](https://github.com/Guffawaffle/LexRunner/issues/new)

### Support Channels

- **Documentation:** [docs/README.md](./README.md)
- **GitHub Issues:** Bug reports and feature requests
- **Discussions:** Q&A and community support (if enabled)

---

## Next Steps

After upgrading to v0.1:

1. ✅ **Verify installation:** `lex-pr --version`
2. ✅ **Update documentation:** Use new product names
3. ✅ **Enable Frame emission:** `export LEX_PR_EMIT_FRAMES=true` (optional)
4. ✅ **Review ADRs:** Understand architectural decisions
5. ✅ **Plan for v0.2:** Follow roadmap for upcoming features

---

## Version History

| Version     | Date              | Key Changes                                                       |
| ----------- | ----------------- | ----------------------------------------------------------------- |
| **0.1.0**   | 2025-11-06        | Initial stable release, branding, ADRs, Frame emission foundation |
| Pre-release | Before 2025-11-06 | Development versions (no formal release)                          |

See [CHANGELOG.md](../CHANGELOG.md) for complete version history.

---

**Document Version:** 1.0.0
**Last Updated:** 2025-11-06
**Maintainers:** LexRunner Team
