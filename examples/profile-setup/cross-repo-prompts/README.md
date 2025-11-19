<<<<<<< HEAD
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
||||||| 0c946b1
=======
# Cross-Repository Prompts Guide

Complete guide for sharing prompts across multiple repositories with lex-pr-runner.

## Overview

The prompts precedence system allows you to share prompts across repositories, enabling:
- Consistent prompts across related projects
- Centralized prompt management
- Easy prompt testing and iteration
- Cross-project prompt reuse

## Precedence Chain

Prompts are resolved in this order (highest to lowest priority):

1. **`LEX_PROMPTS_DIR`** (environment variable) - Explicit override
2. **`.smartergpt.local/prompts/`** - Local overlay (not tracked)
3. **`.smartergpt/prompts/`** - Tracked canonical prompts

## Three Usage Methods

### Method 1: Environment Variable (LEX_PROMPTS_DIR)

**Use when:** CI/CD environments, explicit testing, temporary overrides

**Setup:**
```bash
# Point to another repository's prompts
export LEX_PROMPTS_DIR=/path/to/lex/.smartergpt/prompts

# Run commands normally
lex-pr plan --from-github
lex-pr autopilot plan.json --level 1
```

**Pros:**
- ✅ Explicit and clear
- ✅ Easy to switch between prompt sources
- ✅ Works in CI/CD
- ✅ No file system modifications

**Cons:**
- ❌ Must set environment variable each session
- ❌ Easy to forget to set

**Example: CI/CD Workflow**
```yaml
# .github/workflows/merge-weave.yml
name: Merge Weave

on: workflow_dispatch

jobs:
  weave:
    runs-on: ubuntu-latest
    env:
      # Use Lex prompts from checked-out repo
      LEX_PROMPTS_DIR: ${{ github.workspace }}/lex/.smartergpt/prompts

    steps:
      - name: Checkout LexRunner
        uses: actions/checkout@v3
        with:
          path: lex-pr-runner

      - name: Checkout Lex (for prompts)
        uses: actions/checkout@v3
        with:
          repository: Guffawaffle/lex
          path: lex

      - name: Generate plan
        working-directory: lex-pr-runner
        run: npm run cli -- plan --from-github "is:open label:ready"
        # Uses LEX_PROMPTS_DIR automatically
```

### Method 2: Symlink

**Use when:** Development environments, automatic tracking of source updates

**Setup:**
```bash
# From LexRunner repository root
cd .smartergpt.local

# Create symlink to Lex prompts
ln -s ../../lex/.smartergpt/prompts prompts

# Verify
ls -la prompts
# Output: prompts -> ../../lex/.smartergpt/prompts

# Run commands normally
cd ..
lex-pr plan --from-github
# Automatically uses symlinked prompts
```

**Directory structure:**
```
projects/
├── lex/
│   └── .smartergpt/
│       └── prompts/          # Source prompts
│           ├── create-project.md
│           └── idea.md
└── lex-pr-runner/
    └── .smartergpt.local/
        └── prompts/          # Symlink -> ../../lex/.smartergpt/prompts
```

**Pros:**
- ✅ Automatic tracking of prompt updates
- ✅ No manual sync needed
- ✅ One-time setup
- ✅ Clear source of truth

**Cons:**
- ❌ Requires file system symlink support
- ❌ May not work on Windows without Developer Mode
- ❌ Can be confusing if source repo moves

**Windows Setup:**
```powershell
# Requires Administrator privileges or Developer Mode
# Settings > Update & Security > For Developers > Developer Mode

cd .smartergpt.local
New-Item -ItemType SymbolicLink -Path "prompts" -Target "..\..\lex\.smartergpt\prompts"

# Verify
Get-Item prompts | Select-Object Target
```

### Method 3: Copy

**Use when:** Customizing prompts, offline development, snapshot of specific versions

**Setup:**
```bash
# From LexRunner repository root
mkdir -p .smartergpt.local

# Copy Lex prompts
cp -r ../lex/.smartergpt/prompts .smartergpt.local/

# Customize as needed
vim .smartergpt.local/prompts/create-project.md

# Run commands
lex-pr plan --from-github
# Uses local copy of prompts
```

**Pros:**
- ✅ Full control over prompts
- ✅ Can customize without affecting source
- ✅ Works offline
- ✅ No symlink issues on Windows

**Cons:**
- ❌ Manual sync needed for updates
- ❌ Can diverge from source
- ❌ Higher maintenance burden

**Update workflow:**
```bash
# Pull latest prompts from source
cp -r ../lex/.smartergpt/prompts .smartergpt.local/prompts.new

# Review changes
diff -r .smartergpt.local/prompts .smartergpt.local/prompts.new

# Merge if acceptable
rm -rf .smartergpt.local/prompts
mv .smartergpt.local/prompts.new .smartergpt.local/prompts
```

## Usage Scenarios

### Scenario 1: LexRunner Using Lex Prompts

**Context:** LexRunner is developing new features and wants to use the same prompts as Lex for consistency.

**Recommended Method:** Symlink (development) or Environment Variable (CI/CD)

**Setup:**
```bash
# Development (symlink)
cd lex-pr-runner/.smartergpt.local
ln -s ../../lex/.smartergpt/prompts prompts

# CI/CD (environment variable)
export LEX_PROMPTS_DIR=/srv/lex/.smartergpt/prompts
```

**Validation:**
```bash
# Verify prompts source
lex-pr doctor | grep prompts
# Output: ✓ Prompts: /path/to/lex/.smartergpt/prompts (source: .smartergpt.local/prompts)
```

### Scenario 2: Testing New Prompts Before Committing

**Context:** You're developing a new prompt and want to test it across multiple repositories before committing.

**Recommended Method:** Environment Variable

**Setup:**
```bash
# Create test prompts directory
mkdir -p /tmp/test-prompts
cp .smartergpt/prompts/* /tmp/test-prompts/

# Edit test prompt
vim /tmp/test-prompts/create-project.md

# Test in multiple repos
cd lex-pr-runner
export LEX_PROMPTS_DIR=/tmp/test-prompts
lex-pr plan --from-github

cd ../lex
export LEX_PROMPTS_DIR=/tmp/test-prompts
lex-pr plan --from-github

# If tests pass, commit to source
cp /tmp/test-prompts/create-project.md lex/.smartergpt/prompts/
cd lex
git add .smartergpt/prompts/create-project.md
git commit -m "Update create-project prompt"
```

### Scenario 3: Repository-Specific Prompt Customization

**Context:** You want to use base prompts from Lex but customize specific prompts for LexRunner.

**Recommended Method:** Copy + Edit

**Setup:**
```bash
# Copy base prompts
cp -r ../lex/.smartergpt/prompts .smartergpt.local/

# Customize specific prompt
cat >> .smartergpt.local/prompts/create-project.md << 'EOF'

## LexRunner-Specific Instructions

- Ensure TypeScript compilation
- Add vitest tests
- Update docs/
EOF

# Use customized prompts
lex-pr plan --from-github
```

**Tracking Updates:**
```bash
# Periodically sync non-customized prompts
for file in ../lex/.smartergpt/prompts/*.md; do
  base=$(basename "$file")
  if [ "$base" != "create-project.md" ]; then
    cp "$file" .smartergpt.local/prompts/
  fi
done
```

### Scenario 4: Multi-Repository Organization

**Context:** Organization with 5+ repositories that should share prompts.

**Recommended Method:** Environment Variable + Shared Location

**Setup:**
```bash
# Create shared prompts repo
git clone https://github.com/org/shared-prompts.git /opt/shared-prompts

# Each developer adds to shell profile (~/.bashrc, ~/.zshrc)
echo 'export LEX_PROMPTS_DIR=/opt/shared-prompts/prompts' >> ~/.bashrc
source ~/.bashrc

# All repositories automatically use shared prompts
cd repo-a && lex-pr plan --from-github
cd repo-b && lex-pr plan --from-github
```

**CI/CD:**
```yaml
# Shared workflow config
env:
  LEX_PROMPTS_DIR: /opt/shared-prompts/prompts

steps:
  - name: Checkout shared prompts
    uses: actions/checkout@v3
    with:
      repository: org/shared-prompts
      path: /opt/shared-prompts
```

## Token Expansion

Prompts support dynamic token expansion regardless of source:

### Available Tokens

| Token | Description | Example |
|-------|-------------|---------|
| `{{today}}` | Current date (YYYY-MM-DD) | `2025-11-13` |
| `{{now}}` | ISO timestamp without colons | `2025-11-13T14-30-45-123` |
| `{{repo_root}}` | Git repository root path | `/path/to/repo` |
| `{{workspace_root}}` | Workspace root path | `/path/to/workspace` |
| `{{branch}}` | Current git branch | `main` |
| `{{commit}}` | Current commit SHA | `a1b2c3d4...` |

### Example: Date-Stamped Prompt

`prompts/weekly-report.md`:
```markdown
---
name: weekly-report
version: 1.0.0
---

# Weekly Report - {{today}}

**Repository:** {{repo_root}}
**Branch:** {{branch}}
**Commit:** {{commit}}

## Summary
...
```

**Expanded Output:**
```markdown
# Weekly Report - 2025-11-13

**Repository:** /srv/lex-pr-runner
**Branch:** feature/new-feature
**Commit:** cc2ff2c8a1b2c3d4e5f6...

## Summary
...
```

## Verification & Debugging

### Check Prompts Source

```bash
# Run doctor command
lex-pr doctor

# Look for prompts section:
# ✓ Prompts: /path/to/prompts (source: LEX_PROMPTS_DIR)
# or
# ✓ Prompts: /path/to/.smartergpt.local/prompts (source: .smartergpt.local/prompts)
# or
# ✓ Prompts: /path/to/.smartergpt/prompts (source: .smartergpt/prompts)
```

### Test Prompt Loading

```bash
# Create test script
cat > test-prompts.mjs << 'EOF'
import { loadPrompt, resolvePromptsDir } from "./dist/config/promptsResolver.js";

const resolved = resolvePromptsDir();
console.log("Prompts directory:", resolved.path);
console.log("Source:", resolved.source);

try {
  const prompt = loadPrompt("create-project");
  console.log("\nPrompt loaded successfully:");
  console.log("- Path:", prompt.path);
  console.log("- Metadata:", prompt.metadata);
  console.log("- Content length:", prompt.content.length);
} catch (err) {
  console.error("Failed to load prompt:", err.message);
}
EOF

# Run test
node test-prompts.mjs
```

### Debug Resolution

```typescript
// Add debug logging
import { resolvePromptsDir } from "./config/promptsResolver.js";

const resolved = resolvePromptsDir();
console.log("Resolution result:", {
  path: resolved.path,
  source: resolved.source,
  exists: fs.existsSync(resolved.path)
});
```

## Best Practices

### 1. Document Prompt Source

Add a comment to README or docs:

```markdown
## Prompts

This project uses prompts from [Lex](https://github.com/Guffawaffle/lex).

**Setup:**
```bash
export LEX_PROMPTS_DIR=../lex/.smartergpt/prompts
```

Or symlink:
```bash
ln -s ../lex/.smartergpt/prompts .smartergpt.local/prompts
```
```

### 2. Version Your Prompts

Use frontmatter to track prompt versions:

```markdown
---
name: create-project
version: 2.1.0
schemaVersion: 1.0.0
changelog:
  - 2.1.0: Added TypeScript support
  - 2.0.0: Rewrote for clarity
  - 1.0.0: Initial version
---

# Create Project Prompt
...
```

### 3. Test Prompts in Isolation

Before sharing prompts, test in a clean environment:

```bash
# Create test environment
export LEX_PROMPTS_DIR=/tmp/test-prompts
mkdir -p $LEX_PROMPTS_DIR
cp my-new-prompt.md $LEX_PROMPTS_DIR/

# Test
lex-pr plan --from-github

# Cleanup
unset LEX_PROMPTS_DIR
```

### 4. Use Environment Variables in CI/CD

Always use `LEX_PROMPTS_DIR` in CI/CD for explicit control:

```yaml
env:
  LEX_PROMPTS_DIR: ${{ github.workspace }}/shared-prompts
```

### 5. Avoid Nested Symlinks

Don't create symlinks to symlinks:

```bash
# ❌ BAD: Symlink to symlink
ln -s ../lex/.smartergpt.local/prompts .smartergpt.local/prompts

# ✅ GOOD: Symlink to actual directory
ln -s ../lex/.smartergpt/prompts .smartergpt.local/prompts
```

## Troubleshooting

### Problem: "LEX_PROMPTS_DIR not found"

**Error:**
```
PromptsResolverError: LEX_PROMPTS_DIR not found: /invalid/path
```

**Solutions:**
1. Verify path exists: `ls -la $LEX_PROMPTS_DIR`
2. Use absolute path: `export LEX_PROMPTS_DIR=/absolute/path/to/prompts`
3. Check permissions: `test -r $LEX_PROMPTS_DIR && echo "readable"`

### Problem: Symlink broken on Windows

**Error:**
```
Error: ENOENT: no such file or directory
```

**Solutions:**
1. Enable Developer Mode (Windows 10+)
2. Use environment variable instead:
   ```powershell
   $env:LEX_PROMPTS_DIR = "C:\path\to\lex\.smartergpt\prompts"
   ```
3. Copy prompts instead:
   ```powershell
   Copy-Item -Recurse ..\lex\.smartergpt\prompts .smartergpt.local\prompts
   ```

### Problem: Prompts not updating

**Symptom:** Changes to source prompts don't appear in consumer repo

**Solutions:**

**For Symlink:**
```bash
# Verify symlink is correct
ls -la .smartergpt.local/prompts
# Should show: prompts -> ../../lex/.smartergpt/prompts

# Check source
ls ../lex/.smartergpt/prompts/
```

**For Environment Variable:**
```bash
# Verify variable is set
echo $LEX_PROMPTS_DIR

# Verify path exists
ls $LEX_PROMPTS_DIR
```

**For Copy:**
```bash
# Re-copy to get updates
cp -r ../lex/.smartergpt/prompts .smartergpt.local/
```

### Problem: Token not expanding

**Symptom:** `{{today}}` appears literally in output

**Solutions:**
1. Verify you're using `loadPrompt()` API (auto-expands tokens)
2. Check token syntax: must be `{{token}}` (no spaces)
3. Ensure token is supported (see [Token Expansion](#token-expansion))

## Related Documentation

- [SmartGPT Structure v1 Spec](../../../docs/specs/smartergpt-structure-v1.md) - Complete specification
- [Prompts Configuration](../../../docs/prompts.md) - Prompts system documentation
- [Profile Setup Guide](../README.md) - Profile setup examples
- [Environment Variables](../../../docs/environment-variables.md) - Environment configuration

## Examples

See main [Profile Setup Guide](../README.md) for additional examples.
>>>>>>> pr-395
