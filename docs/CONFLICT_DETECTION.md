# Conflict Detection and Resolution Guidance

This document describes the inter-PR conflict detection and resolution guidance feature added to the merge-weave system.

## Overview

During merge-weave execution, the system now detects when multiple PRs modify the same files and provides guidance on how to resolve potential conflicts. This addresses the issue encountered in Wave 2 where PRs #650 and #651 both modified `src/memory/store/tsconfig.json`, causing a merge conflict.

## Features

### 1. Inter-PR Conflict Detection

The preflight conflict detection system now analyzes file changes across all PRs in the plan to identify overlapping modifications:

- **File overlap detection**: Identifies when multiple PRs modify the same files
- **Severity assessment**: Categorizes conflicts as "likely", "possible", or "unlikely" based on file types
- **Pairwise analysis**: Checks every pair of PRs for potential conflicts

### 2. Resolution Guidance

Provides intelligent guidance for common conflict patterns:

#### Auto-Merge Safe Patterns

**TypeScript Config Files (`tsconfig.json`)**

- **Severity**: Possible
- **Strategy**: Merge both
- **Guidance**: TypeScript config files typically have additive changes (includes, compiler options). Merge both additions when possible.
- **Example**: If PR #650 adds `"src/memory/**/*"` to includes and PR #651 adds `"src/store/**/*"`, both can be merged.

**Package.json**

- **Severity**: Possible
- **Strategy**: Merge both
- **Guidance**: Package.json conflicts often involve dependencies or scripts. Review both changes and merge additive changes.
- **Warning**: If both PRs modify the same dependency version differently, manual review required.

**Lock Files**

- **Severity**: Likely
- **Strategy**: Manual (regenerate)
- **Guidance**: Lock files should be regenerated after merge.
- **Commands**:
  - `package-lock.json`: `npm install`
  - `yarn.lock`: `yarn install`
  - `pnpm-lock.yaml`: `pnpm install`
  - `Gemfile.lock`: `bundle install`
  - `Cargo.lock`: `cargo update`
  - `composer.lock`: `composer update`

#### Manual Review Required

**Config Files** (`.eslintrc`, `.prettierrc`, etc.)

- **Severity**: Possible
- **Strategy**: Manual
- **Guidance**: Configuration file conflicts require review to ensure consistency.

**Source Files**

- **Severity**: Likely
- **Strategy**: Manual
- **Guidance**: Manual review recommended after the first PR merges.

## Output Format

### Dry-Run Output

When running `lex-pr merge --dry-run`, the output now includes an "Inter-PR Conflicts" section:

```
## Inter-PR Conflicts (File Overlap)

⚠️  2 potential conflict(s) between PRs detected

### PR-650 ↔ PR-651
- **Severity:** possible
- **Overlapping files:** src/memory/store/tsconfig.json

**Resolution Guidance:**
- Type: auto-merge-safe
- Strategy: merge-both
- Confidence: 85%
- TypeScript config files typically have additive changes (includes, compiler options). Merge both additions when possible.
- **Safe merge:** Combine array entries from both sides, remove duplicates

**Recommendation:** Merge PRs in dependency order and resolve conflicts as they arise.
```

## API

### Types

```typescript
interface InterPRConflict {
  /** First item involved */
  item1: string;
  /** Second item involved */
  item2: string;
  /** Conflicted file paths */
  files: string[];
  /** Severity: how likely this will cause a merge conflict */
  severity: "likely" | "possible" | "unlikely";
  /** Resolution guidance */
  guidance?: ConflictResolutionGuidance;
}

interface ConflictResolutionGuidance {
  /** Type of guidance */
  type: "auto-merge-safe" | "manual-review" | "dependency-order";
  /** Human-readable guidance message */
  message: string;
  /** Confidence level (0-1) */
  confidence: number;
  /** Suggested resolution strategy */
  strategy?: "merge-both" | "accept-first" | "accept-last" | "manual";
  /** Additional context */
  context?: Record<string, unknown>;
}
```

### Functions

```typescript
// Generate resolution guidance for a file
function generateResolutionGuidance(filePath: string): ConflictResolutionGuidance | undefined;

// Determine conflict severity
function determineConflictSeverity(
  file: string,
  item1Changes: string[],
  item2Changes: string[]
): "likely" | "possible" | "unlikely";

// Detect preflight conflicts (enhanced)
async function detectPreflightConflicts(plan: Plan, workingDir?: string): Promise<PreflightResults>;
```

## Implementation Details

### Inter-PR Conflict Detection Algorithm

1. **Get changed files**: For each PR, use `git diff --name-only` to get the list of files changed compared to the target branch
2. **Pairwise comparison**: Compare every pair of PRs to find overlapping files
3. **Severity assessment**: For each overlapping file, determine severity based on:
   - Lock files → "likely"
   - Config files (tsconfig, package.json) → "possible"
   - Other files → "likely"
4. **Generate guidance**: Apply pattern-based rules to provide resolution hints

### Resolution Guidance Patterns

The system recognizes the following file patterns:

- **TypeScript configs**: `/tsconfig\.json$/i`
- **Package manifests**: `/package\.json$/i`
- **ESLint configs**: `/\.eslintrc(\.json)?$/i`
- **Prettier configs**: `/\.prettierrc(\.json)?$/i`
- **Jest configs**: `/jest\.config\.(js|ts)$/i`
- **Vitest configs**: `/vitest\.config\.(js|ts)$/i`
- **Lock files**: Various lock file patterns

## Testing

The feature includes comprehensive test coverage:

- **Resolution guidance tests** (`tests/resolutionGuidance.spec.ts`): 17 tests validating guidance generation for different file types
- **Inter-PR conflict tests** (`tests/interPRConflicts.spec.ts`): Git-based integration tests (requires `LEX_GIT_MODE=live`)

Run tests:

```bash
# Unit tests (no git required)
npm test tests/resolutionGuidance.spec.ts

# Integration tests (requires git)
LEX_GIT_MODE=live npm test tests/interPRConflicts.spec.ts
```

## Future Enhancements

Potential improvements for this feature:

1. **Automatic conflict resolution**: For very safe patterns (e.g., non-overlapping tsconfig includes), automatically generate merged files
2. **Dependency inference**: Automatically create dependencies when conflicts are detected (e.g., PR-651 depends on PR-650)
3. **AI-powered guidance**: Use existing AI conflict resolution system for more complex cases
4. **Pre-merge conflict simulation**: Run actual merge simulations to predict exact conflict locations

## Related

- Original issue: Wave 2 merge-weave conflict between PR #650 and #651
- Conflicted file: `src/memory/store/tsconfig.json`
- Related modules:
  - `src/weave/preflightConflicts.ts`
  - `src/weave/resolutionGuidance.ts`
  - `src/weave/types.ts`
  - `src/weave/mergeHelpers.ts`
