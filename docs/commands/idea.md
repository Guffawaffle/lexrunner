# lex-pr idea - Feature Idea Capture

The `lex-pr idea` command provides an interactive workflow for capturing feature ideas, generating Feature Spec v0 documents, and creating/updating GitHub Idea Issues with idempotent fingerprinting.

## Overview

This command is part of the front-end capture pipeline that helps teams:
1. Quickly capture feature ideas with structured metadata
2. Generate machine-readable Feature Spec v0 JSON documents
3. Create GitHub Issues with the `[IDEA]` prefix and `idea`, `needs-triage` labels
4. Update existing Issues idempotently using content fingerprinting

## Usage

### Interactive Mode (Default)

```bash
lex-pr idea
```

Prompts for:
- Feature title (required)
- Brief description (required)
- Acceptance criteria (one per line, optional)
- Technical context (optional)
- Constraints (optional)

### Non-Interactive Mode

```bash
lex-pr idea \
  --title "Add dark mode support" \
  --description "Implement dark mode theme switcher" \
  --repo "owner/repo"
```

### Dry Run (Generate Spec Without Creating Issue)

```bash
lex-pr idea \
  --title "Feature title" \
  --description "Feature description" \
  --repo "owner/repo" \
  --dry-run
```

### Update Existing Issue

```bash
# Updates Issue #123 only if content fingerprint changed
lex-pr idea \
  --title "Updated feature title" \
  --description "Updated description" \
  --repo "owner/repo" \
  --update-issue 123
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--title <string>` | Idea title | Interactive prompt |
| `--description <string>` | Brief description | Interactive prompt |
| `--interactive` | Force interactive mode | `true` if no title/description |
| `--dry-run` | Generate spec without creating Issue | `false` |
| `--template <path>` | Custom prompt template path | (future enhancement) |
| `--output <path>` | Output path for Feature Spec v0 | `.smartergpt.local/deliverables/_session/idea-{timestamp}.json` |
| `--repo <owner/repo>` | Target repository | Auto-detected from git remote |
| `--label <label>` | Additional labels (repeatable) | `[]` |
| `--update-issue <num>` | Update existing Issue instead of creating | (none) |

## Feature Spec v0 Schema

Generated JSON documents conform to the Feature Spec v0 schema:

```json
{
  "schemaVersion": "0.1.0",
  "title": "Add dark mode support",
  "description": "Implement dark mode theme switcher",
  "acceptanceCriteria": [
    "User can toggle between light and dark themes",
    "Theme preference persists across sessions",
    "All UI components respect theme setting"
  ],
  "technicalContext": "Uses CSS variables for theming",
  "constraints": "Must work in all supported browsers",
  "repo": "Guffawaffle/lex-pr-runner",
  "createdAt": "2025-11-09T21:26:56.362Z"
}
```

## Fingerprinting for Idempotency

The command generates a deterministic SHA-256 fingerprint from:
- Title
- Description
- Acceptance criteria

The fingerprint is injected as a hidden HTML comment in the Issue body:

```markdown
<!-- fingerprint:d158c1280857f3a5 -->
```

When updating an Issue with `--update-issue`, the command:
1. Fetches the existing Issue
2. Extracts its fingerprint
3. Compares with the new fingerprint
4. Updates only if fingerprints differ

This prevents unnecessary API calls and Issue edit history noise.

## Issue Format

Created Issues have:
- Title: `[IDEA] {feature title}`
- Labels: `idea`, `needs-triage`, plus any from `--label`
- Body sections:
  - Description
  - Acceptance Criteria (if provided)
  - Technical Context (if provided)
  - Constraints (if provided)
  - Metadata (repo, created date, schema version)
  - Hidden fingerprint comment

## Environment Variables

- `GITHUB_TOKEN` - Required for Issue creation/updates (not needed for `--dry-run`)

## Examples

### Basic Interactive Usage

```bash
$ lex-pr idea
🎯 Feature Idea Capture

Feature title: Add dark mode support
Brief description: Implement theme switcher
Acceptance criteria (enter one per line, empty line to finish):
  1. User can toggle themes
  2. Theme persists
  3. 
Technical context (optional, press Enter to skip): CSS variables
Constraints (optional, press Enter to skip): 

Fingerprint: d158c1280857f3a5
✓ Feature Spec v0 written to: .smartergpt.local/deliverables/_session/idea-2025-11-09T21-26-56-365Z.json
✓ Idea Issue created: https://github.com/owner/repo/issues/42
  Issue #42
```

### Generate Spec Without Creating Issue

```bash
$ lex-pr idea \
  --title "Add API rate limiting" \
  --description "Implement rate limiting middleware" \
  --repo "owner/api-server" \
  --dry-run

Fingerprint: abc123def4567890
✓ Feature Spec v0 written to: .smartergpt.local/deliverables/_session/idea-2025-11-09T21-30-00-000Z.json

Dry run: Issue not created/updated
```

### Update Existing Issue

```bash
$ lex-pr idea \
  --title "Add API rate limiting (updated)" \
  --description "Implement rate limiting with Redis backend" \
  --update-issue 42

Fingerprint: xyz789abc1234567
Updating Issue #42 (fingerprint changed)
✓ Issue #42 updated
```

## Output Paths

By default, Feature Spec v0 files are written to:

```
.smartergpt.local/deliverables/_session/idea-{timestamp}.json
```

You can customize with `--output`:

```bash
lex-pr idea \
  --title "..." \
  --description "..." \
  --output /tmp/my-idea.json \
  --dry-run
```

**Security Note:** The command rejects writes to PR artifact directories (e.g., `.smartergpt/deliverables/pr-*`) to prevent accidental overwrites.

## Error Handling

### Missing GITHUB_TOKEN

```bash
$ lex-pr idea --title "..." --description "..."
Error: GITHUB_TOKEN environment variable required
Set GITHUB_TOKEN or use --dry-run to generate spec only
```

### Unsafe Output Path

```bash
$ lex-pr idea --title "..." --description "..." --output .smartergpt/deliverables/pr-123/idea.json
Error: Cannot write to PR artifact directories
```

### Not a Git Repository

```bash
$ lex-pr idea --title "..." --description "..."
Error: Not a git repository or no origin remote configured. Use --repo flag to specify repository.
```

## Integration with Workflow

The idea command fits into the broader lex-pr-runner workflow:

1. **Ideate**: `lex-pr idea` - Capture feature ideas as GitHub Issues
2. **Discover**: `lex-pr discover` - Find open PRs matching scope
3. **Plan**: `lex-pr plan --from-github` - Generate merge plan
4. **Review**: `lex-pr plan-review plan.json` - Review and edit
5. **Execute**: `lex-pr execute plan.json` - Run quality gates
6. **Report**: `lex-pr report artifacts` - Generate reports

## Future Enhancements

- Custom prompt templates (via `--template` flag)
- AI-powered acceptance criteria generation
- Integration with `lex-pr create-project` for converting ideas to projects
- Batch idea import from various sources

## See Also

- [Feature Spec v0 Schema](../../src/schemas/feature-spec-v0.ts)
- [Fingerprint Utilities](../../src/utils/fingerprint.ts)
- [GitHub Integration](../../src/github/client.ts)
