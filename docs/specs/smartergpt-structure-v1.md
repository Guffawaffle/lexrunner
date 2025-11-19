<<<<<<< HEAD
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
||||||| 0c946b1
=======
# SmartGPT Structure v1 Specification

**Version:** 1.0.0  
**Status:** Stable  
**Last Updated:** 2025-11-13

## Overview

This document specifies the canonical directory structure for lex-pr-runner profiles, including configuration file placement, working directories, prompts resolution, and write protection rules.

## Table of Contents

- [Directory Structure](#directory-structure)
- [Precedence Chains](#precedence-chains)
- [File Descriptions](#file-descriptions)
- [Prompts System](#prompts-system)
- [Write Protection](#write-protection)
- [Platform Considerations](#platform-considerations)
- [Migration Guide](#migration-guide)
- [Examples](#examples)

## Directory Structure

### Tracked Profile (`.smartergpt/`)

The tracked profile serves as the canonical example configuration for the repository. It should be read-only in practice to prevent accidental commits of generated content.

```
.smartergpt/                          # Tracked example profile
├── intent.md                         # Project goals and scope (config)
├── scope.yml                         # PR discovery rules (config)
├── deps.yml                          # Dependency relationships (config)
├── gates.yml                         # Quality gates configuration (config)
├── stack.yml                         # PR ordering configuration (config)
├── merge-policy.yml                  # Merge rules (config)
├── pull-request-template.md          # PR template with dependency syntax (config)
├── allowed-commands.json             # Security policy - permissive (config)
├── allowed-commands.strict.json      # Security policy - strict (config)
├── prompts/                          # Canon prompts directory (tracked)
│   ├── create-project.md             # Project creation prompt
│   ├── idea.md                       # Idea generation prompt
│   └── [other prompts]               # Additional tracked prompts
├── schemas/                          # JSON Schemas for validation
│   ├── execution-plan-v1.json
│   ├── gates.schema.json
│   ├── runner.scope.schema.json
│   └── [other schemas]
├── runner/                           # Working directory (gitignored)
│   ├── plan.json                     # Generated execution plan
│   ├── snapshot.md                   # State snapshot
│   ├── cache/                        # Ephemeral cache data
│   ├── logs/                         # Execution logs
│   ├── bin/                          # Temporary binaries
│   └── wt/                           # Work tree
└── deliverables/                     # Generated outputs (may be tracked)
    └── comments/                     # PR comment drafts
```

**Key Characteristics:**
- **Role:** `example` (defined in `profile.yml` if present, or implied)
- **Write Protection:** Runner refuses to write artifacts to this profile
- **Configuration Location:** Config files are at profile root, NOT in a subdirectory
- **Working Directory:** `runner/` contains only working artifacts, not configuration

### Local Profile (`.smartergpt.local/`)

The local profile is for development and customization. It overrides the tracked profile and allows write operations.

```
.smartergpt.local/                    # Local development profile (gitignored)
├── profile.yml                       # Profile metadata (REQUIRED)
│                                     #   role: development
│                                     #   projectType: typescript (auto-detected)
├── intent.md                         # Local intent override
├── scope.yml                         # Local scope override
├── deps.yml                          # Local deps override
├── gates.yml                         # Local gates override
├── stack.yml                         # Local stack override
├── merge-policy.yml                  # Local merge policy override
├── pull-request-template.md          # Local PR template override
├── allowed-commands.json             # Local security policy
├── *.md                              # Local documentation files
│   ├── CROSS_REPO_DEPENDENCIES.md
│   ├── IMPLEMENTATION_STRATEGY.md
│   └── MEMORY_RETRIEVAL_GUIDE.md
├── prompts/                          # Prompt overlays (local, gitignored)
│   ├── README.md                     # Local prompts documentation
│   ├── merge-weave-main.md           # Custom merge prompts
│   ├── merge-weave-light.md
│   ├── kickoff-examples.md
│   └── [other custom prompts]
├── runner/                           # Working directory (gitignored)
│   ├── plan.json                     # Generated execution plan
│   ├── snapshot.md                   # State snapshot
│   ├── cache/                        # Ephemeral cache data
│   ├── logs/                         # Execution logs
│   └── [other working files]
└── deliverables/                     # Local deliverables (gitignored)
    └── weave-{timestamp}/            # Timestamped deliverable sets
        ├── analysis.json
        ├── weave-report.md
        └── execution-log.md
```

**Key Characteristics:**
- **Role:** `development` (defined in `profile.yml`, REQUIRED)
- **Write Protection:** Runner can write artifacts to this profile
- **Configuration Location:** Config files at profile root override tracked profile
- **Working Directory:** `runner/` contains working artifacts
- **Gitignored:** Entire `.smartergpt.local/` should be in `.gitignore`

### Custom Profile (Arbitrary Location)

Custom profiles can be created at any location for testing or CI/CD.

```
/path/to/custom-profile/
├── profile.yml                       # REQUIRED: role: local
├── [config files]                    # Same as other profiles
├── prompts/                          # Optional prompts directory
├── runner/                           # Working directory
└── deliverables/                     # Deliverables directory
```

## Precedence Chains

### Profile Resolution Precedence

The runner resolves the active profile using the following precedence chain (highest to lowest):

1. **`--profile-dir` CLI flag** - Explicit override
2. **`LEX_PR_PROFILE_DIR` environment variable** - Environment-based override
3. **`.smartergpt.local/`** - Local overlay (development)
4. **`.smartergpt/`** - Tracked example profile (repository default)

**Resolution Rules:**
- First existing directory in the chain is selected
- If no profile found, runner exits with error
- Profile must contain valid `profile.yml` (except `.smartergpt/` which defaults to `role: example`)

### Prompts Resolution Precedence

Prompts are resolved using a separate precedence chain (highest to lowest):

1. **`LEX_PROMPTS_DIR` environment variable** - Explicit override for cross-repo usage
2. **`.smartergpt.local/prompts/`** - Local overlay (not tracked)
3. **`.smartergpt/prompts/`** - Tracked canonical prompts

**Resolution Rules:**
- If `LEX_PROMPTS_DIR` is set but doesn't exist, an error is thrown
- First existing directory in the chain is used
- If no prompts directory found, error with helpful message listing all checked locations
- Prompts resolution is independent of profile resolution

### Configuration File Overlay

Configuration files use file-level overlay behavior:

```
Example: scope.yml resolution
1. Check .smartergpt.local/scope.yml (if using .smartergpt.local profile)
2. If not found, use .smartergpt/scope.yml
3. No merging - entire file is replaced if override exists
```

## File Descriptions

### Configuration Files (Profile Root)

These files live at the **profile root**, not in a `runner/` subdirectory:

| File | Purpose | Required | Schema |
|------|---------|----------|--------|
| `profile.yml` | Profile metadata (role, type) | Yes (except `.smartergpt/`) | Custom |
| `intent.md` | Project goals and scope | Recommended | Markdown |
| `scope.yml` | PR discovery rules | Required for planning | `runner.scope.schema.json` |
| `deps.yml` | Dependency relationships | Optional | Custom YAML |
| `gates.yml` | Quality gates configuration | Required for gates | `gates.schema.json` |
| `stack.yml` | PR ordering configuration | Optional | `runner.stack.schema.json` |
| `merge-policy.yml` | Merge rules and policies | Optional | Custom YAML |
| `pull-request-template.md` | PR template | Recommended | Markdown |
| `allowed-commands.json` | Security policy (permissive) | Optional | JSON array |
| `allowed-commands.strict.json` | Security policy (strict) | Optional | JSON array |

### Working Directory (`runner/`)

The `runner/` directory contains **working artifacts only**, not configuration:

| Item | Purpose | Tracked |
|------|---------|---------|
| `plan.json` | Generated execution plan | No (gitignored) |
| `snapshot.md` | Current state snapshot | No (gitignored) |
| `cache/` | Ephemeral cache data | No (gitignored) |
| `logs/` | Execution logs | No (gitignored) |
| `bin/` | Temporary binaries | No (gitignored) |
| `wt/` | Work tree | No (gitignored) |

**Important:** Config files do NOT belong in `runner/`. The `runner/` directory is purely for ephemeral working artifacts.

### Prompts Directory (`prompts/`)

The `prompts/` directory contains prompt templates with optional frontmatter and token expansion:

| File | Purpose | Tracked in `.smartergpt/` | Tracked in `.smartergpt.local/` |
|------|---------|----------------------------|----------------------------------|
| `create-project.md` | Project creation prompt | Yes | No |
| `idea.md` | Idea generation prompt | Yes | No |
| `[custom].md` | Custom prompts | Yes (if canonical) | No (local overlays) |
| `README.md` | Prompts documentation | Optional | Recommended |

### Deliverables Directory (`deliverables/`)

Placement strategy varies by profile:

- **`.smartergpt/deliverables/`**: May be tracked for example outputs (use sparingly)
- **`.smartergpt.local/deliverables/`**: Always gitignored, contains timestamped deliverable sets

## Prompts System

### Prompts Directory Resolution

See [Prompts Resolution Precedence](#prompts-resolution-precedence) above.

### Token Expansion

Prompts support dynamic token expansion for context-aware content:

| Token | Description | Example Output |
|-------|-------------|----------------|
| `{{today}}` | Current date (YYYY-MM-DD) | `2025-11-13` |
| `{{now}}` | ISO timestamp without colons | `2025-11-13T14-30-45-123` |
| `{{repo_root}}` | Git repository root path | `/path/to/repo` |
| `{{workspace_root}}` | Workspace root path | `/path/to/workspace` |
| `{{branch}}` | Current git branch | `main` |
| `{{commit}}` | Current commit SHA | `a1b2c3d4...` |

**Usage Example:**
```markdown
# Project Status Report

Generated: {{today}}
Branch: {{branch}}
Commit: {{commit}}

## Analysis
...
```

**Expanded Output:**
```markdown
# Project Status Report

Generated: 2025-11-13
Branch: feature/new-feature
Commit: cc2ff2c8a1b2c3d4e5f6...

## Analysis
...
```

### Frontmatter Metadata

Prompts support optional YAML frontmatter:

```markdown
---
name: custom-prompt
version: 1.2.0
schemaVersion: 2.0.0
description: A custom prompt for code review
---

# Prompt Content

Your actual prompt content here with {{token}} expansion...
```

### Cross-Repository Prompts Usage

Three methods for sharing prompts across repositories:

#### 1. Environment Variable (`LEX_PROMPTS_DIR`)

```bash
# From LexRunner repo, point to Lex prompts
export LEX_PROMPTS_DIR=/srv/lex-mcp/lex/.smartergpt/prompts
lex-pr plan --from-github
```

**When to use:** CI/CD environments, explicit testing, cross-repo workflows

#### 2. Symlink

```bash
# From LexRunner repo root
ln -s ../../lex/.smartergpt/prompts .smartergpt.local/prompts
```

**When to use:** Development environments, automatic tracking of source updates

#### 3. Copy

```bash
# Copy Lex prompts to LexRunner
cp -r ../lex/.smartergpt/prompts .smartergpt.local/
```

**When to use:** Customization, offline development, snapshot of specific versions

### API Usage

```typescript
import { loadPrompt, resolvePromptsDir, expandPromptTokens } from "./config/promptsResolver.js";

// Load prompt with automatic token expansion
const prompt = loadPrompt("create-project");
console.log(prompt.content);   // Expanded content
console.log(prompt.metadata);  // { name: "create-project", ... }
console.log(prompt.path);      // Absolute path

// Resolve prompts directory
const resolved = resolvePromptsDir();
console.log(resolved.path);    // Absolute path
console.log(resolved.source);  // "LEX_PROMPTS_DIR" | ".smartergpt.local/prompts" | ".smartergpt/prompts"

// Manual token expansion
const expanded = expandPromptTokens("Today: {{today}}", process.cwd());
```

**See also:** [docs/prompts.md](../prompts.md) for complete prompts documentation.

## Write Protection

### Profile Roles

Each profile has a `role` that determines write permissions:

| Role | Description | Write Allowed | Typical Location |
|------|-------------|---------------|------------------|
| `example` | Read-only tracked profile | ❌ No | `.smartergpt/` |
| `development` | Local development profile | ✅ Yes | `.smartergpt.local/` |
| `local` | Custom local profile | ✅ Yes | Custom path |

### Write Protection Rules

1. **Config Files:** Runner never writes to config files (intent.md, scope.yml, etc.)
2. **Working Artifacts:** Runner writes to `runner/` only if profile role allows
3. **Deliverables:** Runner writes to `deliverables/` only if profile role allows
4. **Example Profile:** Runner refuses all write operations to `role: example` profiles

### Validation

The runner validates write operations before executing:

```typescript
import { validateWriteOperation } from "./config/profileResolver.js";

try {
  validateWriteOperation(profilePath, role, "write deliverables");
  // Proceed with write
} catch (WriteProtectionError) {
  console.error("Cannot write to example profile");
}
```

### Error Messages

When write protection is violated:

```
WriteProtectionError: Cannot write to profile with role=example
Operation: write deliverables
Profile: /path/to/.smartergpt
Suggestion: Use .smartergpt.local/ or set LEX_PR_PROFILE_DIR
```

## Platform Considerations

### Windows

**Path Separators:**
- Use forward slashes (`/`) in documentation
- Runner handles path normalization automatically
- Symlinks require administrator privileges or Developer Mode

**Environment Variables:**
```powershell
# PowerShell
$env:LEX_PR_PROFILE_DIR = "C:\path\to\profile"
$env:LEX_PROMPTS_DIR = "C:\path\to\prompts"

# CMD
set LEX_PR_PROFILE_DIR=C:\path\to\profile
set LEX_PROMPTS_DIR=C:\path\to\prompts
```

**Symlinks:**
```powershell
# Requires admin or Developer Mode
New-Item -ItemType SymbolicLink -Path ".smartergpt.local\prompts" -Target "..\..\lex\.smartergpt\prompts"
```

### Linux/macOS

**Environment Variables:**
```bash
export LEX_PR_PROFILE_DIR=/path/to/profile
export LEX_PROMPTS_DIR=/path/to/prompts
```

**Symlinks:**
```bash
ln -s ../../lex/.smartergpt/prompts .smartergpt.local/prompts
```

**Permissions:**
- Ensure read permissions on tracked profile
- Ensure write permissions on local profile

### Cross-Platform Best Practices

1. **Use forward slashes** in documentation and examples
2. **Test symlinks** on target platform before relying on them
3. **Use environment variables** when symlinks are problematic
4. **Copy prompts** for maximum portability

## Migration Guide

### From Pre-v1 Structure

**Old Structure (Incorrect):**
```
.smartergpt/
└── runner/                    # ❌ Config in subdirectory
    ├── intent.md
    ├── scope.yml
    └── gates.yml
```

**New Structure (Correct):**
```
.smartergpt/
├── intent.md                  # ✅ Config at root
├── scope.yml
├── gates.yml
└── runner/                    # ✅ Working artifacts only
    ├── plan.json
    └── cache/
```

### Migration Steps

1. **Move config files to profile root:**
   ```bash
   cd .smartergpt
   mv runner/intent.md .
   mv runner/scope.yml .
   mv runner/gates.yml .
   mv runner/deps.yml .
   # ... move other config files
   ```

2. **Update `.gitignore`:**
   ```gitignore
   # Ignore local profile
   .smartergpt.local/
   
   # Ignore working directories
   .smartergpt/runner/
   .smartergpt/cache/
   
   # Optionally ignore deliverables
   .smartergpt/deliverables/
   ```

3. **Create `profile.yml` in `.smartergpt/` (optional):**
   ```yaml
   role: example
   name: my-project
   version: 1.0.0
   ```

4. **Initialize local profile:**
   ```bash
   lex-pr init-local
   ```

5. **Verify resolution:**
   ```bash
   lex-pr doctor
   # Should show: "using profile: /abs/path/.smartergpt.local (role: development)"
   ```

### From Hardcoded `.smartergpt/`

If your code hardcodes `.smartergpt/` path:

**Before:**
```typescript
const profilePath = path.join(process.cwd(), ".smartergpt");
const scopePath = path.join(profilePath, "scope.yml");
```

**After:**
```typescript
import { resolveProfile } from "./config/profileResolver.js";

const resolved = resolveProfile();
const profilePath = resolved.path;  // May be .smartergpt.local or custom
const scopePath = path.join(profilePath, "scope.yml");
```

## Examples

### Example 1: Basic Development Setup

```bash
# Clone repository
git clone https://github.com/Guffawaffle/lex-pr-runner.git
cd lex-pr-runner

# Initialize local overlay
npm run cli -- init-local

# Verify setup
npm run cli -- doctor
# Output: using profile: /abs/path/.smartergpt.local (role: development)

# Work normally
npm run cli -- plan --from-github
# Artifacts go to .smartergpt.local/runner/
```

### Example 2: Cross-Repository Prompts (Environment Variable)

```bash
# From LexRunner repository, use Lex prompts
export LEX_PROMPTS_DIR=/srv/lex-mcp/lex/.smartergpt/prompts

# Run plan with Lex prompts
lex-pr plan --from-github

# Verify prompts source
lex-pr doctor
# Output includes: "prompts: /srv/lex-mcp/lex/.smartergpt/prompts (source: LEX_PROMPTS_DIR)"
```

### Example 3: Cross-Repository Prompts (Symlink)

```bash
# From LexRunner repository
cd .smartergpt.local

# Create symlink to Lex prompts
ln -s ../../../lex/.smartergpt/prompts prompts

# Verify symlink
ls -la prompts
# Output: prompts -> ../../../lex/.smartergpt/prompts

cd ..
lex-pr plan --from-github
# Automatically uses symlinked prompts
```

### Example 4: CI/CD Profile

```yaml
# .github/workflows/merge-weave.yml
name: Merge Weave

on:
  workflow_dispatch:
    inputs:
      scope:
        description: 'PR scope query'
        required: true

jobs:
  weave:
    runs-on: ubuntu-latest
    env:
      LEX_PR_PROFILE_DIR: /tmp/ci-profile
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Setup CI profile
        run: |
          mkdir -p $LEX_PR_PROFILE_DIR
          cp -r .smartergpt/* $LEX_PR_PROFILE_DIR/
          cat > $LEX_PR_PROFILE_DIR/profile.yml << EOF
          role: local
          name: ci-merge-weave
          projectType: typescript
          EOF

      - name: Generate plan
        run: npm run cli -- plan --from-github "${{ github.event.inputs.scope }}"

      - name: Execute gates
        run: npm run cli -- execute $LEX_PR_PROFILE_DIR/runner/plan.json

      - name: Upload artifacts
        uses: actions/upload-artifact@v3
        with:
          name: gate-results
          path: ${{ env.LEX_PR_PROFILE_DIR }}/runner/
```

### Example 5: Custom Prompt with Tokens

`.smartergpt.local/prompts/weekly-report.md`:
```markdown
---
name: weekly-report
version: 1.0.0
description: Generate weekly status report
---

# Weekly Status Report

**Date:** {{today}}
**Branch:** {{branch}}
**Repository:** {{repo_root}}

## Summary

Generate a summary of changes made this week in the {{branch}} branch.

## Commits Since Last Week

[List commits here]

## Open PRs

[List open PRs]

## Next Week Goals

[List goals]
```

Usage:
```typescript
import { loadPrompt } from "./config/promptsResolver.js";

const prompt = loadPrompt("weekly-report");
console.log(prompt.content);
// Tokens are automatically expanded
```

## Related Documentation

- [Profile Resolution](../profile-resolution.md) - Profile resolution mechanics
- [Prompts Configuration](../prompts.md) - Complete prompts system documentation
- [Quickstart Guide](../quickstart.md) - Getting started guide
- [CLI Reference](../cli.md) - Command-line interface
- [AGENTS.md](../../AGENTS.md) - Two-track separation and portable workspace
- [TERMS.md](../TERMS.md) - Canonical terminology

## Changelog

### v1.0.0 (2025-11-13)
- Initial specification
- Documented actual structure (config at root, not in runner/)
- Added prompts precedence system from PR #387
- Added token expansion reference
- Added cross-repository usage patterns
- Added platform-specific considerations
- Added migration guide
>>>>>>> pr-395
