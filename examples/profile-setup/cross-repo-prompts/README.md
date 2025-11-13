# Cross-Repository Prompts Examples

Examples for sharing prompts across repositories using lex-pr-runner's prompts precedence system.

## Overview

LexRunner supports three methods for cross-repository prompt sharing:

1. **Environment Variable** (`LEX_PROMPTS_DIR`)
2. **Symlink** (local overlay)
3. **Copy** (with customization)

## Scenario: LexRunner Using Lex Prompts

### Project Structure

```
/srv/lex-mcp/
├── lex/                              # Lex repository
│   └── .smartergpt/
│       └── prompts/                  # Source prompts
│           ├── merge-weave-main.md
│           ├── merge-weave-light.md
│           └── kickoff-examples.md
└── lex-pr-runner/                    # LexRunner repository
    └── .smartergpt.local/
        └── prompts/                  # Will point to Lex prompts
```

## Method 1: Environment Variable

**Best for:** CI/CD, testing, temporary overrides

```bash
# From lex-pr-runner directory
export LEX_PROMPTS_DIR=/srv/lex-mcp/lex/.smartergpt/prompts

# Verify resolution
lex-pr config show --prompts-dir
# Output: /srv/lex-mcp/lex/.smartergpt/prompts (from LEX_PROMPTS_DIR)

# Use normally
lex-pr plan --from-github
```

**Pros:**
- No file system changes
- Easy to switch between prompt sets
- Works in CI/CD

**Cons:**
- Must set environment variable each time
- Not persistent across sessions

### CI/CD Example

```yaml
# .github/workflows/merge-weave.yml
name: Merge Weave

env:
  LEX_PROMPTS_DIR: /opt/shared-prompts

jobs:
  weave:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup prompts
        run: |
          mkdir -p /opt/shared-prompts
          cp -r ../lex/.smartergpt/prompts/* /opt/shared-prompts/

      - name: Run merge-weave
        run: lex-pr plan --from-github
```

## Method 2: Symlink

**Best for:** Development, automatic updates

```bash
# From lex-pr-runner directory
cd .smartergpt.local

# Create symlink to Lex prompts
ln -s ../../lex/.smartergpt/prompts prompts

# Verify
ls -la prompts
# lrwxrwxrwx prompts -> ../../lex/.smartergpt/prompts

# Check resolution
cd ../..
lex-pr config show --prompts-dir
# Output: .smartergpt.local/prompts (symlink to Lex)
```

**Pros:**
- Automatic prompt updates from source
- No environment variable needed
- Persistent across sessions

**Cons:**
- Requires relative path to be stable
- Symlinks may not work on all platforms (Windows)

### Windows Alternative (Junction Point)

```powershell
# From lex-pr-runner\.smartergpt.local
mklink /J prompts ..\..\lex\.smartergpt\prompts
```

## Method 3: Copy and Customize

**Best for:** Customization, offline work, versioned snapshots

```bash
# From lex-pr-runner directory
mkdir -p .smartergpt.local/prompts

# Copy prompts
cp -r ../lex/.smartergpt/prompts/* .smartergpt.local/prompts/

# Customize as needed
vim .smartergpt.local/prompts/merge-weave-main.md

# Verify
lex-pr config show --prompts-dir
# Output: .smartergpt.local/prompts
```

**Pros:**
- Full control over prompts
- Can customize without affecting source
- Works offline

**Cons:**
- Manual updates required
- Takes disk space
- May drift from source

### Updating Copied Prompts

```bash
# Sync specific prompt
cp ../lex/.smartergpt/prompts/merge-weave-main.md .smartergpt.local/prompts/

# Or sync all (warning: overwrites local changes)
rsync -av ../lex/.smartergpt/prompts/ .smartergpt.local/prompts/
```

## Precedence Testing

### Test Resolution Order

```bash
# Method 1: Set env var (highest priority)
export LEX_PROMPTS_DIR=/srv/lex-mcp/lex/.smartergpt/prompts
lex-pr config show --prompts-dir
# Output: /srv/lex-mcp/lex/.smartergpt/prompts (from LEX_PROMPTS_DIR)

# Method 2: Unset env var, use symlink
unset LEX_PROMPTS_DIR
lex-pr config show --prompts-dir
# Output: .smartergpt.local/prompts (symlink or local)

# Method 3: Remove local, fall back to tracked
rm -rf .smartergpt.local/prompts
lex-pr config show --prompts-dir
# Output: .smartergpt/prompts (tracked canon)
```

## Token Expansion Example

**Source prompt in Lex** (`lex/.smartergpt/prompts/status.md`):
```markdown
---
name: status-report
version: 1.0.0
---

# Status Report — {{today}}

Repository: {{repo_root}}
Branch: {{branch}}
```

**Used in LexRunner:**
```bash
export LEX_PROMPTS_DIR=/srv/lex-mcp/lex/.smartergpt/prompts
lex-pr load-prompt status

# Tokens expanded based on LexRunner context:
# {{today}} → 2025-11-13
# {{repo_root}} → /srv/lex-mcp/lex-pr-runner
# {{branch}} → main (LexRunner's branch, not Lex's)
```

**Key point:** Tokens expand based on the **consumer's context** (LexRunner), not the source (Lex).

## Multi-Repository Setup

### Structure for Three Repos

```
/srv/lex-mcp/
├── shared-prompts/                   # Dedicated prompts repo
│   ├── merge-weave-main.md
│   ├── merge-weave-light.md
│   └── kickoff-examples.md
├── lex/
│   └── .smartergpt.local/
│       └── prompts/                  # Symlink to shared-prompts
│           -> ../../shared-prompts
└── lex-pr-runner/
    └── .smartergpt.local/
        └── prompts/                  # Symlink to shared-prompts
            -> ../../shared-prompts
```

**Setup:**
```bash
# In lex/
ln -s ../shared-prompts .smartergpt.local/prompts

# In lex-pr-runner/
ln -s ../shared-prompts .smartergpt.local/prompts

# Both repos now share the same prompts
```

## Troubleshooting

### Prompt Not Found

```bash
# Check resolution
lex-pr config show --prompts-dir

# List available prompts
ls -la $(lex-pr config show --prompts-dir | awk '{print $1}')

# Verify prompt exists
ls -la $(lex-pr config show --prompts-dir | awk '{print $1}')/merge-weave-main.md
```

### LEX_PROMPTS_DIR Not Found

```bash
# Check if path exists
ls -la $LEX_PROMPTS_DIR

# Try absolute path
export LEX_PROMPTS_DIR=/srv/lex-mcp/lex/.smartergpt/prompts
```

### Symlink Not Working (Windows)

```powershell
# Check if Developer Mode is enabled
# Or use junction point
mklink /J prompts ..\..\lex\.smartergpt\prompts

# Or copy instead
xcopy /E /I ..\..\lex\.smartergpt\prompts prompts
```

### Tokens Not Expanding

```bash
# Ensure using loadPrompt() API
# Tokens only expand when loading via the resolver

# Debug token expansion
export DEBUG=lex-pr:prompts
lex-pr load-prompt status
```

## Related Documentation

- [Prompts Configuration](../../../docs/prompts.md) - Complete prompts guide
- [Profile Resolution](../../../docs/profile-resolution.md) - Profile precedence
- [SmartGPT Structure](../../../docs/specs/smartergpt-structure-v1.md) - Full spec

## See Also

- `../README.md` - Profile setup examples
- `../../docs/prompts.md` - Token reference
