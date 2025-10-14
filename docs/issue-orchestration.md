# Issue Orchestration & Analysis

## Overview

The `orchestrate:analyze` command analyzes GitHub issues to identify parallelizable work, compute overlap scores, and extract metadata for batch planning.

## Command

```bash
lex-pr orchestrate analyze [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--repo <owner/repo>` | Repository to analyze (format: owner/repo). If not specified, auto-detects from git remote. |
| `--labels <labels>` | Filter issues by labels (comma-separated). Example: `--labels type:enhancement,priority:P1` |
| `--json` | Output results in JSON format |

## Features

### 1. Issue Metadata Extraction

The analyzer extracts comprehensive metadata from each issue:

- **Affected Files/Directories**: Parsed from issue description
- **Dependencies**: Extracted from "Depends-on: #123" footers
- **Complexity Signals**: File count, line estimates
- **Labels, Assignees, Created Date**
- **GitHub Copilot Agent Assignment**: Detects if @copilot is assigned
- **Duration Estimate**: Based on complexity heuristics

### 2. Overlap Score Computation

For each pair of issues, the analyzer computes an overlap score (0-1):

- **File Overlap**: Jaccard index of affected files (40% weight)
- **Directory Overlap**: Jaccard index of affected directories (30% weight)
- **Label Overlap**: Jaccard index of labels (20% weight)
- **Author Overlap**: Same author = 1, different = 0 (10% weight)

### 3. Parallel Work Identification

Issues with low overlap (< 30% by default) are identified as candidates for parallel execution.

## Examples

### Basic Analysis

```bash
# Analyze all open issues in current repository
lex-pr orchestrate analyze

# Analyze issues with specific labels
lex-pr orchestrate analyze --labels priority:P1,type:enhancement

# Analyze a specific repository
lex-pr orchestrate analyze --repo owner/repo
```

### JSON Output

```bash
# Get JSON output for programmatic processing
lex-pr orchestrate analyze --json > issues-analysis.json

# Filter by labels and output JSON
lex-pr orchestrate analyze --labels stack:auth-refactor --json
```

## Output Format

### Human-Readable Table

```
Issue Analysis Results
================================================================================

Issues:
--------------------------------------------------------------------------------
#      Title                                    Files  Complexity Duration  
--------------------------------------------------------------------------------
#171   Feature 1: Issue Analyzer                5      6.5        13h (high)
#172   Feature 2: Batch Planner                 3      4.2        8h (medium)
#173   Feature 3: Conflict Resolver             4      5.8        12h (high)

High Overlap Pairs (>30%):
--------------------------------------------------------------------------------
Issue 1    Issue 2    Score      Files      Dirs       Labels    
--------------------------------------------------------------------------------
#171       #172       0.456      0.333      0.500      0.667     

Parallel Work Groups:
--------------------------------------------------------------------------------
Group 1: #171, #173 (avg overlap: 15%)

Recommendations:
--------------------------------------------------------------------------------
• Found 1 parallel work groups covering 2 issues
• Group of 2 issues (#171, #173) can be worked on in parallel
```

### JSON Output

```json
{
  "metadata": [
    {
      "number": 171,
      "title": "Feature 1: Issue Analyzer",
      "labels": ["type:enhancement", "priority:P1"],
      "assignees": ["copilot"],
      "author": "developer",
      "affectedFiles": ["src/orchestrate/analyzer.ts", "src/orchestrate/types.ts"],
      "affectedDirectories": ["src", "src/orchestrate"],
      "dependencies": ["#170"],
      "complexity": {
        "estimatedFiles": 5,
        "estimatedLines": 500,
        "score": 6.5
      },
      "copilotAgent": {
        "assigned": true,
        "agent": "code-editor"
      },
      "durationEstimate": {
        "hours": 13,
        "confidence": "high"
      }
    }
  ],
  "overlapMatrix": [
    {
      "issue1": 171,
      "issue2": 172,
      "score": 0.456,
      "fileOverlap": 0.333,
      "directoryOverlap": 0.500,
      "labelOverlap": 0.667,
      "authorOverlap": 1
    }
  ],
  "parallelGroups": [
    {
      "issues": [171, 173],
      "avgOverlap": 0.15,
      "reason": "Low overlap (avg: 15%)"
    }
  ],
  "recommendations": [
    "Found 1 parallel work groups covering 2 issues",
    "Group of 2 issues (#171, #173) can be worked on in parallel"
  ]
}
```

## Use Cases

### 1. Batch PR Planning

Use the analysis to create batches of issues that can be worked on in parallel:

```bash
# Analyze issues
lex-pr orchestrate analyze --labels sprint:current --json > analysis.json

# Extract parallel groups and create PRs
# (Use jq or similar to process the JSON)
```

### 2. Conflict Prediction

Identify issues that might conflict with each other:

```bash
# Find high-overlap pairs
lex-pr orchestrate analyze --json | jq '.overlapMatrix[] | select(.score > 0.7)'
```

### 3. Workload Distribution

Use complexity and duration estimates to distribute work across team members:

```bash
# Get complexity metrics
lex-pr orchestrate analyze --json | jq '.metadata[] | {number, complexity, duration}'
```

## Metadata Extraction Details

### File Path Detection

The analyzer recognizes file paths in multiple formats:

- Direct paths: `src/path/to/file.ts`
- Markdown lists: `- src/file.ts` or `* src/file.ts`
- Code blocks with file annotations:
  ````markdown
  ```typescript
  File: src/component.tsx
  ```
  ````

### Dependency Formats

Supported dependency declaration formats:

- `Depends-on: #123, #456`
- `Depends: #123`
- `Requires: #123`
- `Blocks: #456`
- `Blocked by: #789`

### Complexity Heuristics

Complexity score (0-10) is computed from:

- **File Count**: Explicit mentions or detected files (up to 5 points)
- **Line Count**: Explicit mentions or estimated from files (up to 5 points)

### Duration Estimation

Duration is estimated with confidence levels:

- **High confidence**: Explicit time mentions (e.g., "8 hours", "2 days")
- **Medium confidence**: Derived from complexity score (> 5)
- **Low confidence**: Default estimation from complexity

## Integration with Plan Generation

The issue analysis can be used to inform plan generation:

```bash
# 1. Analyze issues
lex-pr orchestrate analyze --labels priority:P1 --json > analysis.json

# 2. Create PRs for parallel groups
# (manual or scripted based on analysis)

# 3. Generate execution plan
lex-pr plan --from-github --labels priority:P1 --json > plan.json
```

## Limitations

- File path extraction relies on common patterns and may miss non-standard formats
- Complexity estimation is heuristic-based and may not reflect actual effort
- Overlap scores are weighted combinations and may need tuning for specific workflows
- Requires GitHub API access (GITHUB_TOKEN environment variable)

## See Also

- [Plan Generation Guide](./plan-generation.md)
- [Dependency Parser](./dependency-parser.md)
- [CLI Reference](./cli.md)
