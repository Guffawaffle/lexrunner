# SmartGPT Structure v1 — Specification

**Version:** 1.0.0
**Status:** Stable
**Last Updated:** 2025-11-13

## Overview

This document defines the canonical directory structure for lex-pr-runner workspaces, including profile resolution, prompts precedence, and configuration layering.

## Core Principles

1. **Two-Track Separation**: Tracked example profile (`.smartergpt/`) vs. local development profile (`.smartergpt.local/`)
2. **Config at Root**: Configuration files live at profile root, not in subdirectories
3. **Runner Working Directory**: `runner/` contains working artifacts (plan.json, cache, logs), not config
4. **Prompts Precedence**: Three-level resolution chain for cross-repository prompt sharing
5. **Write Protection**: Tracked profiles are read-only; writes go to local profiles only

## Directory Structure

### Tracked Profile (`.smartergpt/`)

```
.smartergpt/                          # Tracked example profile (read-only)
├── intent.md                         # Project intent (config)
├── scope.yml                         # PR discovery rules (config)
├── deps.yml                          # Dependency declarations (config)
├── gates.yml                         # Quality gates (config)
├── stack.yml                         # PR ordering hints (config)
├── merge-policy.yml                  # Merge rules (config)
├── pull-request-template.md          # PR template (config)
├── allowed-commands.json             # Security policy (config)
├── allowed-commands.strict.json      # Strict security policy (config)
├── prompts/                          # Canon prompts (tracked)
│   ├── create-project.md
│   ├── idea.md
│   └── [other prompts]
├── schemas/                          # JSON Schemas
│   ├── profile.schema.json
│   ├── gates.schema.json
│   ├── runner.stack.schema.json
│   └── runner.scope.schema.json
├── runner/                           # Working directory (gitignored)
│   ├── plan.json                     # Generated plan
│   ├── snapshot.md                   # State snapshot
│   ├── cache/                        # Ephemeral cache
│   ├── logs/                         # Execution logs
│   ├── bin/                          # Binaries
│   └── wt/                           # Work tree
├── deliverables/                     # Generated outputs
│   └── comments/                     # PR comments
└── cache/                            # Shared cache
```

### Local Profile (`.smartergpt.local/`)

```
.smartergpt.local/                    # Local development profile (gitignored)
├── profile.yml                       # Profile metadata (role, projectType)
├── intent.md                         # Local intent override
├── scope.yml                         # Local scope override
├── deps.yml                          # Local deps override
├── gates.yml                         # Local gates override
├── pull-request-template.md          # Local template override
├── *.md                              # Local documentation
├── prompts/                          # Prompt overlays (local)
│   ├── README.md
│   ├── merge-weave-main.md
│   ├── merge-weave-light.md
│   ├── kickoff-examples.md
│   └── [other custom prompts]
├── runner/                           # Working directory
│   ├── plan.json
│   ├── snapshot.md
│   └── [other working files]
└── deliverables/                     # Local deliverables
    └── weave-{timestamp}/
        ├── weave-report.md
        ├── execution-log.md
        └── [other artifacts]
```

## Precedence Chains

### Profile Resolution

Profiles are resolved in this order (highest to lowest priority):

1. **`--profile-dir` flag** - Explicit CLI override
2. **`LEX_PR_PROFILE_DIR` env variable** - Environment-based override
3. **`.smartergpt.local/`** - Local overlay (development)
4. **`.smartergpt/`** - Tracked example profile (repository default)

**Rule:** First existing profile directory wins.

### Prompts Resolution

Prompts are resolved independently with this precedence:

1. **`LEX_PROMPTS_DIR` env variable** - Cross-repository override
2. **`.smartergpt.local/prompts/`** - Local prompt overlay
3. **`.smartergpt/prompts/`** - Tracked canonical prompts

**Rule:** If `LEX_PROMPTS_DIR` is set but doesn't exist, resolution fails with error.

**See:** [docs/prompts.md](../prompts.md) for detailed prompts documentation.

### Config File Overlay

When both tracked and local profiles exist, config files overlay:

1. Check `.smartergpt.local/{file}` first
2. Fall back to `.smartergpt/{file}`
3. Use built-in defaults if neither exists

**Example:** If both `.smartergpt/gates.yml` and `.smartergpt.local/gates.yml` exist, the local version is used.

## File Categories

### Configuration Files (at profile root)

These define runner behavior and live at the **profile root**:

| File | Purpose | Schema |
|------|---------|--------|
| `intent.md` | Project goals and scope | Markdown |
| `scope.yml` | PR discovery rules | `runner.scope.schema.json` |
| `deps.yml` | Dependency declarations | YAML |
| `gates.yml` | Quality gates configuration | `gates.schema.json` |
| `stack.yml` | PR ordering hints | `runner.stack.schema.json` |
| `merge-policy.yml` | Merge rules | YAML |
| `pull-request-template.md` | PR template | Markdown |
| `allowed-commands.json` | Security policy | JSON |

### Working Artifacts (in `runner/`)

These are generated during execution and live in `runner/`:

| File/Dir | Purpose | Persistence |
|----------|---------|-------------|
| `plan.json` | Resolved merge plan | Ephemeral |
| `snapshot.md` | State snapshot | Ephemeral |
| `cache/` | Ephemeral cache | Temporary |
| `logs/` | Execution logs | Retained |
| `bin/` | Binary artifacts | Ephemeral |
| `wt/` | Work tree | Temporary |

### Profile Metadata (local only)

`profile.yml` exists only in `.smartergpt.local/`:

```yaml
role: development
projectType: nodejs
```

**Fields:**
- `role`: `example` | `development` | `local`
- `projectType`: Auto-detected project type

## Token Expansion

Prompts and some config files support token expansion:

| Token | Expands To | Example |
|-------|------------|---------|
| `{{today}}` | YYYY-MM-DD | `2025-11-13` |
| `{{now}}` | ISO timestamp (no colons) | `2025-11-13T14-30-45-123` |
| `{{repo_root}}` | Repository root path | `/srv/lex-mcp/lex-pr-runner` |
| `{{workspace_root}}` | Workspace root path | `/srv/lex-mcp/lex-pr-runner` |
| `{{branch}}` | Current git branch | `main` |
| `{{commit}}` | Current commit SHA | `a1b2c3d4...` |

**Usage in prompts:**
```markdown
# Status Report — {{today}}

Repository: {{repo_root}}
Branch: {{branch}}
Commit: {{commit}}
```

## Write Protection

The runner enforces write protection based on profile role:

| Role | Can Write Artifacts? | Can Modify Config? |
|------|---------------------|-------------------|
| `example` | ❌ No | ❌ No |
| `development` | ✅ Yes | ✅ Yes |
| `local` | ✅ Yes | ✅ Yes |

**Enforcement:**
- `role: example` profiles reject writes to `runner/`, `deliverables/`, `cache/`
- Use `.smartergpt.local/` (auto-created with `role: development`) for all development work

## Cross-Repository Prompts

### Pattern 1: Environment Variable

```bash
# Point to another repo's prompts
export LEX_PROMPTS_DIR=/srv/lex-mcp/lex/.smartergpt/prompts
lex-pr plan --from-github
```

**When to use:**
- Sharing prompts across multiple repositories
- CI/CD with centralized prompts
- Testing prompt changes

### Pattern 2: Symlink

```bash
# Create symlink in local overlay
ln -s ../../lex/.smartergpt/prompts .smartergpt.local/prompts
```

**When to use:**
- Development with side-by-side repositories
- Automatic tracking of prompt updates
- No environment variable setup needed

### Pattern 3: Copy

```bash
# Copy prompts to local overlay
cp -r ../lex/.smartergpt/prompts .smartergpt.local/
```

**When to use:**
- Customizing prompts while keeping base
- Offline development
- Snapshot of specific prompt versions

## Platform-Specific Considerations

### Windows

**Symlinks:**
- Require admin privileges or Developer Mode
- Fall back to copying if symlink creation fails
- Use junction points for directory symlinks

**Paths:**
- Use forward slashes in config files
- Runner normalizes paths automatically

### Linux/macOS

**Symlinks:**
- Work without special privileges
- Preferred method for cross-repo prompts

**Permissions:**
- Ensure `runner/` and `deliverables/` are writable
- Check `.gitignore` includes local directories

## Migration Guide

### From Flat Structure (Pre-v1)

If your workspace has config files in `runner/` subdirectory:

**Before:**
```
.smartergpt.local/
└── runner/
    ├── intent.md          # Config in runner/
    ├── scope.yml
    └── gates.yml
```

**After:**
```
.smartergpt.local/
├── intent.md              # Config at root
├── scope.yml
├── gates.yml
└── runner/                # Only working artifacts
    ├── plan.json
    └── cache/
```

**Migration steps:**
1. Run `lex-pr doctor` to check current structure
2. Move config files from `runner/` to profile root
3. Verify with `lex-pr doctor` again

### From Legacy Prompts Structure

If prompts are not using precedence system:

**Before:**
```
.smartergpt/
└── prompts/
    └── my-prompt.md       # No cross-repo support
```

**After:**
```
# Use LEX_PROMPTS_DIR for cross-repo
export LEX_PROMPTS_DIR=/path/to/shared/prompts

# Or symlink
ln -s /path/to/shared/prompts .smartergpt.local/prompts
```

## Validation

### Check Current Structure

```bash
# Run doctor command
lex-pr doctor

# Expected output includes:
# ✓ .smartergpt.local: all expected files present
# ✓ Profile role: development
# ✓ Prompts resolved from: .smartergpt.local/prompts
```

### Verify Config Files

```bash
# List resolved config
lex-pr config list

# Show effective configuration
lex-pr config show scope.yml
```

### Test Prompts Resolution

```bash
# Show prompts directory
export DEBUG=lex-pr:prompts
lex-pr plan --from-github

# Check which prompts directory is being used
```

## Examples

### Minimal Local Profile

```
.smartergpt.local/
├── profile.yml            # role: development
├── intent.md              # Project goals
├── scope.yml              # PR discovery
└── gates.yml              # Quality gates
```

### Full-Featured Profile

```
.smartergpt.local/
├── profile.yml
├── intent.md
├── scope.yml
├── deps.yml
├── gates.yml
├── stack.yml
├── merge-policy.yml
├── pull-request-template.md
├── prompts/               # Custom prompts
│   ├── README.md
│   └── custom-weave.md
├── runner/                # Working directory
│   ├── plan.json
│   └── logs/
└── deliverables/          # Generated outputs
    └── weave-20251113/
```

### Cross-Repo Setup (LexRunner using Lex prompts)

```
# LexRunner workspace
/srv/lex-mcp/lex-pr-runner/
├── .smartergpt/           # Tracked example
└── .smartergpt.local/
    └── prompts/           # Symlink to Lex prompts
        -> ../../lex/.smartergpt/prompts

# Lex workspace
/srv/lex-mcp/lex/
└── .smartergpt/
    └── prompts/           # Source of truth
        ├── merge-weave-main.md
        └── kickoff-examples.md
```

## Related Documentation

- [Profile Resolution](../profile-resolution.md) - Profile directory resolution details
- [Prompts Configuration](../prompts.md) - Comprehensive prompts guide
- [Configuration Management](../config.md) - Config file layering
- [Quickstart Guide](../quickstart.md) - Getting started
- [FAQ](../../FAQ.md) - Common questions

## Schema Versioning

This specification is version **1.0.0** (stable).

**Breaking changes require:**
- Major version bump (2.0.0)
- Migration guide
- Deprecation notice for old structure

**Non-breaking additions:**
- Minor version bump (1.1.0)
- Optional features only
- Backward compatible
