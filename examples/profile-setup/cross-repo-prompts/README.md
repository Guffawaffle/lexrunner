# Cross-Repository Prompts Guide

Complete guide for sharing prompts across multiple repositories with lexrunner.

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
          path: lexrunner

      - name: Checkout Lex (for prompts)
        uses: actions/checkout@v3
        with:
          repository: Guffawaffle/lex
          path: lex

      - name: Generate plan
        working-directory: lexrunner
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
└── lexrunner/
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
cd lexrunner/.smartergpt.local
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
cd lexrunner
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

**Repository:** /srv/lexrunner
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
