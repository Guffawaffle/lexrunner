# Prompts Configuration

Complete guide to prompts directory resolution, precedence rules, and token expansion in lex-pr-runner.

> **📖 See Also**: 
> - [Profile Resolution](./profile-resolution.md) - Profile directory resolution
> - [Configuration Management](./config.md) - Configuration layering

## Overview

The lex-pr-runner supports flexible prompt loading with a precedence chain that allows:
- Cross-repository prompt sharing (e.g., using Lex prompts from LexRunner)
- Local prompt customization without modifying tracked files
- Tracked canonical prompts in the repository
- Dynamic token expansion in prompt content

## Prompts Directory Precedence

Prompts are resolved using the following precedence chain (highest to lowest):

1. **`LEX_PROMPTS_DIR`** (environment variable) - Explicit override
2. **`.smartergpt.local/prompts/`** - Local overlay (not tracked)
3. **`.smartergpt/prompts/`** - Tracked canonical prompts
4. **`@smartergpt/lex` package** - Fallback defaults from Lex package

### Precedence Rules

- If `LEX_PROMPTS_DIR` is set, it takes precedence over all other sources
- If `LEX_PROMPTS_DIR` is set but doesn't exist, an error is thrown
- If `.smartergpt.local/prompts/` exists, it takes precedence over `.smartergpt/prompts/`
- If `.smartergpt/prompts/` exists, it takes precedence over package prompts
- If no prompts directory is found (including package), an error is thrown with helpful message
- Package prompts provide a fallback when no local prompts are configured

### Error Messages

When no prompts directory is found, the error message lists all checked locations:

```
PromptsResolverError: Prompts directory not found. Expected one of:
  - LEX_PROMPTS_DIR (env var)
  - /path/to/project/.smartergpt.local/prompts
  - /path/to/project/.smartergpt/prompts
  - @smartergpt/lex package (not installed or prompts not available)
```

## Lex Package Integration

### Package Fallback (New in v0.4.0)

LexRunner now integrates with the `@smartergpt/lex` npm package to provide canonical prompt templates as a fallback. This ensures that projects always have access to standard prompts even without local configuration.

**How it works:**
- If no local prompts are configured, LexRunner attempts to load from `@smartergpt/lex/prompts/`
- Package prompts are automatically available when `@smartergpt/lex` is installed as a dependency
- Local prompts always take precedence over package prompts

**Benefits:**
- **Zero configuration:** New projects get prompts automatically
- **Canonical defaults:** Shared prompt templates across the ecosystem
- **Easy updates:** Update prompts by upgrading the Lex package
- **Customization preserved:** Local overrides still work as expected

**Package vs. Local Prompts:**

| Aspect | Package Prompts | Local Prompts |
|--------|----------------|---------------|
| **Location** | `node_modules/@smartergpt/lex/prompts/` | `.smartergpt/prompts/` |
| **Updates** | Via `npm update @smartergpt/lex` | Manual edit |
| **Customization** | Not recommended (overwritten on update) | Fully customizable |
| **Precedence** | Lowest (fallback only) | Higher (after env and local overlay) |
| **Version Control** | Not tracked (in node_modules) | Tracked in repo |

**Example: Using package prompts**

```bash
# Install lex-pr-runner (includes @smartergpt/lex)
npm install lex-pr-runner

# Prompts are automatically available - no setup needed
lex-pr plan --from-github

# To customize: copy package prompt to local directory
mkdir -p .smartergpt/prompts
cp node_modules/@smartergpt/lex/prompts/idea.md .smartergpt/prompts/
# Edit .smartergpt/prompts/idea.md as needed
```

## Cross-Repository Prompts Usage

### Scenario 1: Explicit Path to Lex Prompts

Use `LEX_PROMPTS_DIR` to point to another repository's prompts:

```bash
# From LexRunner repo, point to Lex prompts
export LEX_PROMPTS_DIR=/srv/lex-mcp/lex/.smartergpt/prompts
lex-pr plan --from-github
```

**When to use:**
- Sharing prompts across multiple repositories
- Testing prompt changes before committing
- CI/CD environments with pre-configured prompt locations

### Scenario 2: Symlink to Lex Prompts

Create a symlink in the local overlay:

```bash
# From LexRunner repo root
ln -s ../../lex/.smartergpt/prompts .smartergpt.local/prompts
```

**When to use:**
- Development environments with side-by-side repositories
- Automatic tracking of prompt updates from source repository
- No need to set environment variables

### Scenario 3: Copy Lex Prompts

Copy prompts to local overlay for customization:

```bash
# Copy Lex prompts to LexRunner
cp -r ../lex/.smartergpt/prompts .smartergpt.local/
```

**When to use:**
- Customizing prompts while keeping original as base
- Offline development
- Snapshot of specific prompt versions

## Token Expansion

Prompts support dynamic token expansion for context-aware content.

### Supported Tokens

| Token | Description | Example Output |
|-------|-------------|----------------|
| `{{today}}` | Current date (YYYY-MM-DD) | `2025-11-13` |
| `{{now}}` | ISO timestamp without colons | `2025-11-13T07-24-17-072` |
| `{{repo_root}}` | Git repository root path | `/path/to/repo` |
| `{{workspace_root}}` | Workspace root path | `/path/to/workspace` |
| `{{branch}}` | Current git branch | `main` |
| `{{commit}}` | Current commit SHA | `a1b2c3d4...` |

### Token Expansion Examples

#### Example 1: Date-Stamped Prompt

```markdown
# Project Status Report

Generated: {{today}}
Branch: {{branch}}
Commit: {{commit}}

## Changes Since Last Review
...
```

**Expanded output:**
```markdown
# Project Status Report

Generated: 2025-11-13
Branch: feature/add-prompts
Commit: cc2ff2c8a1b2c3d4e5f6...

## Changes Since Last Review
...
```

#### Example 2: Path-Aware Prompt

```markdown
# Code Review Prompt

Repository: {{repo_root}}
Workspace: {{workspace_root}}

Please review changes in the following files:
...
```

**Expanded output:**
```markdown
# Code Review Prompt

Repository: /home/user/projects/lex-pr-runner
Workspace: /home/user/projects/lex-pr-runner

Please review changes in the following files:
...
```

#### Example 3: Timestamped Output

```markdown
# Analysis Report

Timestamp: {{now}}

This report was generated automatically.
Save as: analysis-{{now}}.md
```

**Expanded output:**
```markdown
# Analysis Report

Timestamp: 2025-11-13T14-30-45-123

This report was generated automatically.
Save as: analysis-2025-11-13T14-30-45-123.md
```

## Prompt Metadata (Frontmatter)

Prompts support optional YAML frontmatter for metadata:

```markdown
---
name: custom-prompt
version: 1.2.3
schemaVersion: 2.0.0
description: A custom prompt for code review
---

# Prompt Content

Your actual prompt content here...
```

### Metadata Fields

| Field | Description | Required |
|-------|-------------|----------|
| `name` | Prompt identifier | No (defaults to filename) |
| `version` | Prompt version | No |
| `schemaVersion` | Schema version for compatibility | No |
| `description` | Human-readable description | No |

## API Usage

### Loading a Prompt

```typescript
import { loadPrompt } from "./config/promptsResolver.js";

// Load prompt from resolved directory
const prompt = loadPrompt("create-project");

console.log(prompt.content);   // Expanded prompt content
console.log(prompt.metadata);  // { name: "create-project", ... }
console.log(prompt.path);      // Absolute path to prompt file
```

### Resolving Prompts Directory

```typescript
import { resolvePromptsDir } from "./config/promptsResolver.js";

const resolved = resolvePromptsDir();

console.log(resolved.path);   // Absolute path to prompts directory
console.log(resolved.source); // "LEX_PROMPTS_DIR" | ".smartergpt.local/prompts" | ".smartergpt/prompts"
```

### Expanding Tokens Manually

```typescript
import { expandPromptTokens } from "./config/promptsResolver.js";

const content = "Today: {{today}}, Branch: {{branch}}";
const expanded = expandPromptTokens(content, process.cwd());

console.log(expanded); // "Today: 2025-11-13, Branch: main"
```

## Best Practices

### 1. Use Local Overlay for Customizations

Don't modify `.smartergpt/prompts/` directly. Instead, copy prompts to `.smartergpt.local/prompts/` for customization:

```bash
# Copy prompt to local overlay
mkdir -p .smartergpt.local/prompts
cp .smartergpt/prompts/create-project.md .smartergpt.local/prompts/

# Now edit .smartergpt.local/prompts/create-project.md
```

### 2. Use Environment Variables in CI/CD

Set `LEX_PROMPTS_DIR` in CI/CD environments for consistent prompt locations:

```yaml
# .github/workflows/ci.yml
env:
  LEX_PROMPTS_DIR: /opt/shared-prompts
```

### 3. Document Custom Tokens

If adding custom tokens to prompts, document them in prompt frontmatter:

```markdown
---
name: custom-prompt
description: Prompt with custom tokens
customTokens:
  - "{{project_name}}"
  - "{{author}}"
---

# Prompt for {{project_name}}

Author: {{author}}
...
```

### 4. Version Your Prompts

Use semantic versioning in frontmatter to track changes:

```markdown
---
name: code-review
version: 2.1.0
schemaVersion: 1.0.0
---
```

### 5. Test Token Expansion

Always test prompts with token expansion before using in production:

```typescript
import { loadPrompt } from "./config/promptsResolver.js";

const prompt = loadPrompt("my-prompt");
console.log(prompt.content); // Verify tokens are expanded correctly
```

## Troubleshooting

### Prompt Not Found

**Error:**
```
PromptsResolverError: Prompt not found: my-prompt in /path/to/.smartergpt/prompts
Source: .smartergpt/prompts
```

**Solutions:**
1. Check that the prompt file exists: `.smartergpt/prompts/my-prompt.md`
2. Verify you're loading the correct prompt name (without `.md` extension)
3. Check precedence - prompt might be in different directory

### LEX_PROMPTS_DIR Not Found

**Error:**
```
PromptsResolverError: LEX_PROMPTS_DIR not found: /invalid/path
```

**Solutions:**
1. Verify the path in `LEX_PROMPTS_DIR` exists
2. Check that the path points to a directory (not a file)
3. Ensure you have read permissions on the directory

### Tokens Not Expanding

**Issue:** Tokens like `{{today}}` appear literally in output

**Solutions:**
1. Verify you're using `loadPrompt()` which automatically expands tokens
2. Check token syntax - must be exactly `{{token}}` (no spaces)
3. Ensure token name is supported (see Supported Tokens table)

### Git Context Not Available

**Issue:** `{{branch}}` and `{{commit}}` are empty

**Solutions:**
1. Verify you're in a git repository
2. Check that git is installed and in PATH
3. Ensure current directory is within the repository
4. Create an initial commit if repository is empty

## Related Documentation

- [Profile Resolution](./profile-resolution.md) - Understanding profile precedence
- [Configuration Management](./config.md) - Configuration file layering
- [CLI Reference](./cli.md) - Command-line interface

## Examples

See example prompts in:
- `.smartergpt/prompts/` - Canonical example prompts
- `docs/sample-prompts/` - Documentation examples
