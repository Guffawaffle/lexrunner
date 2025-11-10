# Context Diet: Minimal Context Packaging

The context diet feature provides minimal AI context by sending only diff hunks (20-40 lines), symbol maps, and filtered PR metadata.

## Overview

When processing pull requests for AI analysis, sending full file contents can be expensive in terms of tokens. The context diet feature minimizes AI context by:

1. **Diff Hunks**: Extracting only 20-40 line windows around changes
2. **Symbol Maps**: Building lightweight symbol maps of functions/classes/types
3. **PR Metadata Filtering**: Including PR titles and labels by default, with bodies gated by `needs-context` label

## Components

### 1. Diff Hunk Extraction

Located in `src/github/diffHunks.ts`, this module:

- Parses unified diff format
- Extracts hunks with 20-40 line windows
- Automatically optimizes hunk sizes
- Tracks additions/deletions per file
- Calculates context size metrics

```typescript
import { extractDiffHunks, optimizeHunkSize } from './github/diffHunks.js';

const diff = await getPRDiff(prNumber);
const hunks = extractDiffHunks(diff);
const optimized = optimizeHunkSize(hunks);
```

### 2. Symbol Map Generation

Located in `src/github/symbolMap.ts`, this module:

- Extracts functions, classes, interfaces, and types
- Parses imports and exports
- Tracks line locations for each symbol
- Supports JSDoc comment extraction
- Works with TypeScript and JavaScript

```typescript
import { extractSymbolMap } from './github/symbolMap.js';

const symbolMap = extractSymbolMap('src/file.ts', sourceCode);
console.log(symbolMap.symbols); // Array of symbols with locations
```

### 3. PR Metadata Filtering

Located in `src/github/minimalContext.ts`, this module:

- Filters PR metadata to essentials (title, labels, branch info)
- Body included only when `needs-context` label is present
- Calculates size reduction metrics
- Formats as compact text

```typescript
import { filterPRMetadata } from './github/minimalContext.js';

const minimal = filterPRMetadata(pr);
// Body is undefined unless PR has 'needs-context' label
```

### 4. Complete Integration

Located in `src/github/contextDiet.ts`, this module:

- Combines all components
- Tracks overall context metrics
- Formats complete context for AI consumption
- Exports metrics for monitoring

```typescript
import { buildMinimalContext } from './github/contextDiet.js';

const context = await buildMinimalContext(prs, {
  diff: prDiff,
  files: sourceFiles
});

console.log(context.metrics);
// { totalSize, reductionPercent, hunkCount, symbolCount, ... }
```

## Usage

### Basic Usage - Single PR

```typescript
import { getPRMinimalContext } from './github/minimalContextClient.js';

// Get minimal context for a single PR
const context = await getPRMinimalContext(client, 123, {
  includeDiff: true,
  includeSymbols: true
});

console.log(`Reduction: ${context.metrics.reductionPercent.toFixed(1)}%`);
```

### Multiple PRs

```typescript
import { getOpenPRsMinimalContext } from './github/minimalContextClient.js';

// Get minimal context for all open PRs
const context = await getOpenPRsMinimalContext(client, {
  labels: ['stack:feature'],
  excludeDrafts: true
});
```

### Custom Processing

```typescript
import { 
  extractDiffHunks,
  buildSymbolMaps,
  filterPRsWithMetrics 
} from './github/index.js';

// Manual processing for custom workflows
const prs = await client.listOpenPRs();
const filtered = filterPRsWithMetrics(prs);
const diff = await client.getPRDiff(123);
const hunks = extractDiffHunks(diff);
```

## Labels

### Context Control Labels

- `needs-context` - Include full PR body in context
- `needs-body` - Alias for needs-context
- `full-context` - Include full context for this PR

Add these labels to PRs that require additional context beyond title and labels.

## Metrics

The context diet feature tracks several metrics:

- `totalSize` - Total context size in characters
- `reductionPercent` - Percentage reduction from original
- `prCount` - Number of PRs
- `prWithBodyCount` - Number of PRs with body included
- `fileCount` - Number of files in diff
- `hunkCount` - Number of diff hunks
- `symbolCount` - Number of symbols extracted

Example output:

```json
{
  "totalSize": 2431,
  "prMetadataSize": 1847,
  "diffSize": 584,
  "symbolMapSize": 421,
  "estimatedOriginalSize": 12456,
  "reductionPercent": 80.5,
  "prCount": 3,
  "prWithBodyCount": 1,
  "fileCount": 2,
  "hunkCount": 4,
  "symbolCount": 12
}
```

## Formatting

The context diet feature provides text formatting for AI consumption:

```typescript
import { formatCompleteContext } from './github/contextDiet.js';

const formatted = formatCompleteContext(context);
console.log(formatted);
```

Output structure:
```
# Minimal Context Package

## Metrics
- Total size: 2431 chars
- Reduction: 80.5%
- PRs: 3 (1 with body)
- Files: 2
- Hunks: 4
- Symbols: 12

# Pull Requests (3 total, 1 with body)
...

# Diff Context (2 files, 4 hunks, 584 chars)
...

# Symbol Maps (2 files, 12 symbols)
...
```

## Best Practices

1. **Use labels strategically**: Only add `needs-context` when the body contains essential information
2. **Limit file count**: Symbol extraction is limited to 20 files per PR to avoid rate limits
3. **TypeScript/JavaScript only**: Symbol maps only work for .ts, .tsx, .js, .jsx files
4. **Monitor metrics**: Track reduction percentage to ensure context minimization is effective
5. **Combine with caching**: Cache symbol maps to avoid re-parsing unchanged files

## Testing

The feature includes comprehensive test coverage:

- `tests/github-diff-hunks.spec.ts` - 15 tests for diff extraction
- `tests/github-symbol-map.spec.ts` - 20 tests for symbol parsing
- `tests/github-minimal-context.spec.ts` - 28 tests for metadata filtering
- `tests/github-context-diet.spec.ts` - 23 tests for integration

Run tests:
```bash
npm test -- tests/github-diff-hunks.spec.ts
npm test -- tests/github-symbol-map.spec.ts
npm test -- tests/github-minimal-context.spec.ts
npm test -- tests/github-context-diet.spec.ts
```

## Performance

Typical reduction percentages:

- **PRs without bodies**: 70-90% reduction (filtering bodies)
- **PRs with diffs**: 40-60% reduction (diff hunks vs full files)
- **Combined**: 60-85% total reduction

Example savings for 5 PRs:
- Original: ~50KB (full PR data + full file contents)
- Minimal: ~10KB (filtered metadata + diff hunks + symbol maps)
- Savings: ~40KB (80% reduction)

## API Reference

See source files for detailed API documentation:
- `src/github/diffHunks.ts` - Diff hunk extraction
- `src/github/symbolMap.ts` - Symbol map generation
- `src/github/minimalContext.ts` - PR metadata filtering
- `src/github/contextDiet.ts` - Complete integration
- `src/github/minimalContextClient.ts` - Client convenience methods
