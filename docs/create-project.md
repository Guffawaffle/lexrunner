# Create Project Command

The `lex-pr create-project` command generates an Execution Plan v1 from a Feature Spec v0 and optionally creates GitHub Epic and Sub-Issues.

## Synopsis

```bash
lex-pr create-project --spec <path> [OPTIONS]
```

## Description

This command implements the front-end capture pipeline for feature planning:

1. **Loads** Feature Spec v0 from a JSON file
2. **Generates** Execution Plan v1 with Epic and Sub-Issues
3. **Creates** GitHub Epic and Sub-Issues (unless --dry-run is specified)
4. **Links** Sub-Issues to the parent Epic
5. **Outputs** the Execution Plan to a file

The decomposition is a fixed implementation/tests/docs template for review, not an
approved work plan or worker dispatch. Optional `technicalContext` and `constraints`
from idea capture are retained in `sourceSpec` and included in every generated issue
description. They remain supplied requirements, not enforced runtime policy or
permission to execute. Older specs without those fields remain supported.

Idea capture may precede defining success. Before planning, add at least one acceptance
criterion to the input spec's `acceptanceCriteria` array. The command rejects an empty
array before writing a plan or creating issues. `--dry-run` writes the local plan;
it does not create GitHub issues.

## Options

| Option                    | Description                                   | Default                                                         |
| ------------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| `--spec <path>`           | Feature Spec v0 file path (required)          | -                                                               |
| `--dry-run`               | Generate plan without creating Issues         | `false`                                                         |
| `--output <path>`         | Output path for Execution Plan v1             | `.smartergpt.local/deliverables/_session/plan-{timestamp}.json` |
| `--repo <owner/repo>`     | Target repository                             | Auto-detect from spec                                           |
| `--project <name/num>`    | Link Issues to GitHub Project                 | -                                                               |
| `--epic-labels <labels>`  | Additional Epic labels (comma-separated)      | `[]`                                                            |
| `--issue-labels <labels>` | Additional sub-issue labels (comma-separated) | `[]`                                                            |
| `--no-link`               | Skip sub-issue linking to Epic                | `false`                                                         |

## Feature Spec v0 Format

A Feature Spec v0 file is a JSON document with the following structure:

```json
{
  "title": "Feature Title",
  "description": "Detailed feature description",
  "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
  "repo": "owner/repo",
  "labels": ["enhancement", "priority-high"],
  "priority": "high",
  "estimatedComplexity": "complex"
}
```

### Required Fields

- `title` (string): Feature title
- `description` (string): Detailed description
- `acceptanceCriteria` (string[]): Array of acceptance criteria (at least one required)
- `repo` (string): Target repository in format `owner/repo`

### Optional Fields

- `labels` (string[]): Labels to apply (default: `[]`)
- `priority` ("low" | "medium" | "high" | "critical"): Priority level (default: `"medium"`)
- `estimatedComplexity` ("simple" | "moderate" | "complex"): Complexity estimate
- `schemaVersion` (string): Schema version (default: `"0.1.0"`)

## Execution Plan v1 Format

The generated Execution Plan v1 contains:

```json
{
  "schemaVersion": "1.0.0",
  "sourceSpec": {/* Feature Spec v0 */},
  "epic": {
    "title": "Epic Title",
    "description": "Epic description",
    "acceptanceCriteria": ["..."]
  },
  "subIssues": [
    {
      "id": "feature-impl",
      "title": "Implement Feature",
      "description": "Core implementation",
      "type": "feature",
      "acceptanceCriteria": ["..."],
      "dependsOn": []
    },
    {
      "id": "tests",
      "title": "Add tests",
      "type": "testing",
      "acceptanceCriteria": ["..."],
      "dependsOn": ["feature-impl"]
    },
    {
      "id": "docs",
      "title": "Document feature",
      "type": "docs",
      "acceptanceCriteria": ["..."],
      "dependsOn": ["feature-impl"]
    }
  ],
  "createdAt": "2025-11-09T12:00:00.000Z"
}
```

## Examples

### Dry Run (Generate Plan Only)

```bash
lex-pr create-project \
  --spec ./feature-spec.json \
  --dry-run
```

This validates the Feature Spec and generates an Execution Plan without creating GitHub Issues.

### Create Epic and Sub-Issues

```bash
export GITHUB_TOKEN=ghp_...
lex-pr create-project \
  --spec ./feature-spec.json \
  --repo "owner/repo" \
  --epic-labels "phase-1,priority-high" \
  --issue-labels "sprint-3"
```

### Custom Output Path

```bash
lex-pr create-project \
  --spec ./feature-spec.json \
  --dry-run \
  --output /tmp/execution-plan.json
```

### Without Sub-Issue Linking

```bash
export GITHUB_TOKEN=ghp_...
lex-pr create-project \
  --spec ./feature-spec.json \
  --no-link
```

## Workflow

1. **Create Feature Spec v0**:

   ```bash
   cat > feature-spec.json << EOF
   {
     "title": "Add User Authentication",
     "description": "Implement JWT-based authentication",
     "acceptanceCriteria": [
       "Users can register",
       "Users can log in",
       "Tokens are validated"
     ],
     "repo": "owner/repo"
   }
   EOF
   ```

2. **Generate and Review Plan** (dry run):

   ```bash
   lex-pr create-project --spec feature-spec.json --dry-run
   ```

3. **Create GitHub Issues**:
   ```bash
   export GITHUB_TOKEN=ghp_...
   lex-pr create-project --spec feature-spec.json
   ```

## Error Handling

The command performs comprehensive validation:

- **Missing GITHUB_TOKEN**: If not in dry-run mode and `GITHUB_TOKEN` is not set, exits with error
- **Invalid Feature Spec**: Validates against Feature Spec v0 schema, shows detailed validation errors
- **Invalid Output Path**: Rejects writes to PR artifact directories (e.g., `/path/pr-123/`)
- **Invalid Repository Format**: Ensures `repo` field matches `owner/repo` format

## Dependencies

This command depends on:

- Feature Spec v0 schema (from `@guffawaffle/lex` or local definitions)
- Execution Plan v1 schema (from `@guffawaffle/lex` or local definitions)
- GitHub API access via `@octokit/rest`

## Security

- Never commits the generated Execution Plan to version control by default (uses `.smartergpt.local/`)
- Requires `GITHUB_TOKEN` with appropriate permissions to create issues
- Validates paths to prevent writing to protected directories

## Exit Codes

- `0`: Success
- `1`: Error (validation failure, missing token, invalid path, etc.)

## See Also

- [CLI Documentation](./cli.md)
- [Feature Spec v0 Schema](../src/schemas/project.ts)
- [Execution Plan v1 Schema](../src/schemas/project.ts)
