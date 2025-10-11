# Dependency Parser

The dependency parser extracts structured information from PR descriptions to enable automatic dependency resolution and plan generation.

## Features

### Dependency Extraction

The parser supports multiple dependency formats:

- **Depends-on**: `Depends-on: #123, #456`
- **Depends**: `Depends: PR-123, PR-456`
- **Requires**: `Requires: #123`
- **GitHub Keywords**: `Closes: #100`, `Fixes: #200`, `Resolves: #300`
- **Cross-repo**: `owner/repo#123`, `repo#456`

### Automatic Dependency Discovery (Heuristics)

In addition to explicit dependencies in PR descriptions, the system can automatically suggest dependencies using multiple heuristics:

#### 1. Shared File Modifications
Detects when multiple PRs modify the same files.

- **Confidence**: 0.6 - 1.0
- **Logic**: Both PRs modify identical files
- **Higher confidence** when both modify (vs. one adds, one modifies)
- **Example**: PR-101 and PR-102 both modify `src/core.ts`

#### 2. Directory Proximity  
Identifies PRs working in the same area of the codebase.

- **Confidence**: 0.3 - 0.8
- **Logic**: Calculate overlap of directory paths
- **Formula**: `min(commonDirs / totalDirs, 0.8)`
- **Example**: PR-201 modifies `src/planner/core.ts`, PR-202 modifies `src/planner/utils.ts`

#### 3. Test Overlap
Finds PRs that test the same modules or share test files.

- **Confidence**: 0.5 - 0.85
- **Logic**: 
  - Shared test files: 0.7 - 0.85 confidence
  - Same module tested (different test files): 0.5 - 0.65 confidence
- **Example**: PR-301 modifies `tests/core.spec.ts`, PR-302 modifies `tests/core.test.ts` (both test "core" module)

#### Heuristic Output

Use `discover --suggest` to generate suggestions:

```bash
lex-pr discover --suggest
```

**Table Output:**
```
📊 Dependency Suggestions (3 found):

| From   | To     | Confidence | Heuristic          | Reason                              |
|--------|--------|------------|--------------------|-------------------------------------|
| PR-101 | PR-102 | 95%        | shared-files       | shared file modifications           |
| PR-201 | PR-202 | 50%        | directory-proximity| both modify files in 1 common directory |
| PR-301 | PR-302 | 65%        | test-overlap       | tests for same module               |
```

**JSON Output:**
```bash
lex-pr discover --suggest --json
```

```json
{
  "suggestions": [
    {
      "from": "PR-101",
      "to": "PR-102",
      "reason": "shared file modifications",
      "confidence": 0.95,
      "sharedFiles": ["src/core.ts"],
      "heuristic": "shared-files"
    },
    {
      "from": "PR-201",
      "to": "PR-202",
      "reason": "both modify files in 1 common directory",
      "confidence": 0.50,
      "sharedFiles": ["src/planner"],
      "heuristic": "directory-proximity"
    },
    {
      "from": "PR-301",
      "to": "PR-302",
      "reason": "tests for same module",
      "confidence": 0.65,
      "sharedFiles": ["core"],
      "heuristic": "test-overlap"
    }
  ]
}
```

#### Deterministic Ordering

Suggestions are sorted with stable, deterministic ordering:

1. **Primary**: Confidence (descending) - highest confidence first
2. **Secondary**: From PR (ascending) - alphabetical order
3. **Tertiary**: To PR (ascending) - alphabetical order

#### Deduplication

When multiple heuristics detect the same PR pair, only the highest confidence suggestion is kept.

### Gate Overrides

Extract gate configuration from PR body:

```markdown
Skip: e2e-tests, slow-tests
Required: security-scan, performance-test
```

Alternative syntax:
```markdown
Skip-gates: test1, test2
Required-gates: gate1, gate2
```

### Metadata Extraction

#### From PR Body
- **Priority**: `Priority: high`
- **Labels**: `Labels: feature, breaking, api-change`

#### From YAML Front-Matter
```yaml
---
priority: high
epic: B1-diffgraph-planner
story_points: 8
assignee: developer1
---
```

## Usage

### Basic Parsing

```typescript
import { parsePRDescription } from "./planner/index.js";

const result = parsePRDescription(101, prBodyText);

console.log(result);
// {
//   prId: "PR-101",
//   dependencies: ["#123", "#456"],
//   gates: { skip: ["e2e-tests"], required: ["security-scan"] },
//   metadata: { priority: "high", labels: ["feature", "breaking"] }
// }
```

### With Options

```typescript
const result = parsePRDescription(101, prBodyText, {
  repository: "owner/repo",
  partialExtraction: true  // Continue on errors
});
```

### Validation

```typescript
import { validateDependencies } from "./planner/index.js";

const prs = [
  { prId: "PR-1", dependencies: ["#2"] },
  { prId: "PR-2", dependencies: ["#3"] },
  { prId: "PR-3", dependencies: [] }
];

validateDependencies(prs); // Throws on circular dependencies
```

### Normalization

```typescript
import { normalizeDependencyRef } from "./planner/index.js";

// Normalize to full format
normalizeDependencyRef("#123", "owner/repo");  // "owner/repo#123"
normalizeDependencyRef("PR-456", "owner/repo"); // "owner/repo#456"
```

## Output Format

The parser produces a structured output ready for plan generation:

```json
{
  "prId": "PR-101",
  "dependencies": ["#123", "#456"],
  "gates": {
    "skip": ["e2e-tests"],
    "required": ["security-scan"]
  },
  "metadata": {
    "priority": "high",
    "labels": ["feature", "breaking"]
  }
}
```

### Output Guarantees

- All arrays are **sorted deterministically**
- Dependencies are **deduplicated**
- Empty fields are **omitted** from output
- Consistent **stable ordering** across runs

## Examples

### Stack-based Workflow PR

```markdown
**Stack Position**: 3/5

Depends-on: #101, #102

**Changes**:
- Feature implementation
- Tests added

Required: lint, typecheck, test
Skip: deploy
```

Output:
```json
{
  "prId": "PR-103",
  "dependencies": ["#101", "#102"],
  "gates": {
    "skip": ["deploy"],
    "required": ["lint", "test", "typecheck"]
  }
}
```

### Comprehensive Template

```markdown
---
priority: high
epic: B1-diffgraph-planner
story_points: 5
---

## Dependencies
Depends-on: #75
Requires: #80

## Gates Override
Skip: e2e-tests
Required: security-scan, performance-test

## Description
Implementation details...

Labels: feature, breaking-change
```

Output:
```json
{
  "prId": "PR-101",
  "dependencies": ["#75", "#80"],
  "gates": {
    "skip": ["e2e-tests"],
    "required": ["performance-test", "security-scan"]
  },
  "metadata": {
    "priority": "high",
    "epic": "B1-diffgraph-planner",
    "story_points": 5,
    "labels": ["breaking-change", "feature"]
  }
}
```

## Integration with GitHub Client

The parser is integrated with the GitHub client for automatic dependency extraction:

```typescript
import { createGitHubClient } from "./github/client.js";

const client = await createGitHubClient({ token: process.env.GITHUB_TOKEN });
const prDetails = await client.getPRDetails(123);

console.log(prDetails.dependencies);  // Parsed from PR body
console.log(prDetails.metadata);      // Extracted metadata
console.log(prDetails.gateOverrides); // Gate configuration
```

## Error Handling

### Partial Extraction Mode

When `partialExtraction: true`, the parser returns successfully parsed data even if some parts fail:

```typescript
const result = parsePRDescription(101, prBody, { partialExtraction: true });
// Returns valid data, skips invalid parts
```

### Circular Dependency Detection

```typescript
try {
  validateDependencies(prs);
} catch (error) {
  console.error(error.message); // "Circular dependency detected involving PR-1"
}
```

## Testing

The parser has comprehensive test coverage:

- 34 core parser tests
- 13 GitHub integration tests
- Edge cases and error handling
- Real-world PR templates

Run tests:
```bash
npm test -- dependencyParser
```
