# File-Change Analysis Engine

The file-change analysis engine detects implicit dependencies between PRs by analyzing file modifications, additions, deletions, and renames.

## Features

- **File Intersection Detection**: Identify PRs that modify the same files
- **Change Type Classification**: Track additions, deletions, modifications, and renames
- **Conflict Prediction**: Detect potential merge conflicts before attempting to merge
- **Dependency Scoring**: Confidence levels (0.0-1.0) for inferred relationships
- **Smart Caching**: Cache file analysis results for performance
- **Scope Validation**: Static analysis to validate agent edit scope (NEW)

## Modules

### File Analysis (`fileAnalysis.ts`)
Analyzes file changes across PRs to detect dependencies and conflicts.

### Scope Validation (`scopeValidator.ts`)
**NEW**: Validates that agent edits match declared scope to prevent unintended modifications.

See [Scope Validation Documentation](../../docs/scope-validation.md) for details.

**Key capabilities:**
- Detects global variable writes (`window.*`, `global.*`)
- Validates function/class modifications match declarations
- Identifies side effects (module-level vs. global)
- Supports ESM, CommonJS, AMD, UMD module systems
- AST-based analysis for JavaScript/TypeScript

**Quick example:**
```typescript
import { validateEditScope } from "./planner/scopeValidator.js";

const declaredPlan = {
  functions_modified: ['processPayment'],
  side_effects: 'none',
  globals_written: []
};

await validateEditScope('/path/to/file.js', declaredPlan);
// Throws ScopeValidationError if actual changes don't match
```

## Usage

### Basic Usage with GitHub Client

```typescript
import { createGitHubClient } from "./github/client.js";
import { analyzeGitHubPRFiles } from "./core/githubPlan.js";

// Create GitHub client
const client = await createGitHubClient({
  token: process.env.GITHUB_TOKEN,
  owner: "your-org",
  repo: "your-repo"
});

// Get PR details
const prs = await client.listOpenPRs();
const prDetails = await Promise.all(
  prs.map(pr => client.getPRDetails(pr.number))
);

// Analyze file changes
const analysis = await analyzeGitHubPRFiles(client, prDetails);

// Review results
console.log("File Intersections:", analysis.fileIntersections);
console.log("Dependency Suggestions:", analysis.suggestions);
console.log("Potential Conflicts:", analysis.conflicts);
```

### Direct FileAnalyzer Usage

```typescript
import { createFileAnalyzer } from "./planner/fileAnalysis.js";
import { Octokit } from "@octokit/rest";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const analyzer = createFileAnalyzer(octokit, "owner", "repo");

// Analyze specific PRs
const result = await analyzer.analyzeFiles([
  { number: 101, name: "PR-101", sha: "abc123" },
  { number: 102, name: "PR-102", sha: "def456" }
]);
```

## Output Format

### File Intersections

```json
{
  "fileIntersections": [
    {
      "prs": ["PR-101", "PR-102"],
      "files": ["src/core.ts", "src/utils.ts"],
      "confidence": 0.9
    }
  ]
}
```

### Dependency Suggestions

```json
{
  "suggestions": [
    {
      "from": "PR-101",
      "to": "PR-102",
      "reason": "shared file modifications",
      "confidence": 0.85,
      "sharedFiles": ["src/core.ts"]
    }
  ]
}
```

### Conflict Predictions

```json
{
  "conflicts": [
    {
      "prs": ["PR-101", "PR-102"],
      "files": ["src/core.ts"],
      "severity": "high",
      "reason": "Both modify src/core.ts"
    }
  ]
}
```

## Confidence Scoring

The confidence score (0.0-1.0) is calculated based on:

- **1.0**: Both PRs modify the same file (highest confidence)
- **0.6**: Mixed modifications (rename, delete)
- **0.5**: One PR deletes what another modifies
- **0.3**: Both PRs add the same new file (lower confidence)

## Conflict Severity

- **high**: Both PRs substantially modify the same file (>10 lines), or one deletes what another modifies
- **medium**: Both PRs modify the same file with small changes (<10 lines)
- **low**: Minimal overlap (not reported)

## Caching

The file analyzer caches file changes per PR to avoid redundant API calls:

```typescript
// Get cache statistics
const stats = analyzer.getCacheStats();
console.log(`Cache size: ${stats.size}`);
console.log(`Cached entries: ${stats.entries}`);

// Clear cache if needed
analyzer.clearCache();
```

## Integration with Plan Generation

The file analysis integrates with GitHub-based plan generation to suggest additional dependencies:

```typescript
import { generatePlanFromGitHub } from "./core/githubPlan.js";

const plan = await generatePlanFromGitHub(client, {
  labels: ["stack:feature"],
  target: "main"
});

// Optionally analyze file changes to suggest additional dependencies
const analysis = await analyzeGitHubPRFiles(client, prDetails);
```

## API Reference

### `FileAnalyzer`

- `getPRFileChanges(prNumber, sha?)`: Fetch file changes for a PR
- `buildIntersectionMatrix(prs)`: Build file intersection matrix
- `predictConflicts(prs)`: Predict potential conflicts
- `suggestDependencies(prs)`: Generate dependency suggestions
- `analyzeFiles(prs)`: Perform complete analysis
- `clearCache()`: Clear the cache
- `getCacheStats()`: Get cache statistics

### `analyzeGitHubPRFiles(client, prs)`

Convenience function to analyze file changes using a GitHubClient instance.

## Testing

The file analysis engine includes comprehensive test coverage:

```bash
npm test -- tests/fileAnalysis.spec.ts
```

Tests cover:
- File change fetching and caching
- Intersection matrix calculation
- Conflict prediction with severity levels
- Dependency suggestion with confidence scoring
- Cache management
