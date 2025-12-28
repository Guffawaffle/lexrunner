# Token Usage Tracking

This module provides measurement-only token usage tracking to help analyze context consumption before making optimization decisions.

## Overview

Token tracking uses a simple character-based heuristic (chars/4) to estimate token counts. This is intentionally rough - we need directional data, not precision.

## Components

### Token Estimator (`src/util/tokenEstimator.ts`)

Provides functions to estimate token counts:

```typescript
import { estimateTokens, estimateTokensFromFile } from "./util/tokenEstimator.js";

// Estimate from text
const tokens = estimateTokens("hello world"); // ~3 tokens

// Estimate from file
const fileTokens = estimateTokensFromFile("/path/to/file.txt", fs);
```

### Token Logger (`src/monitoring/tokenLogger.ts`)

Writes structured JSONL logs to `.smartergpt.local/runner/logs/token-usage.jsonl`:

```typescript
import { createTokenLogger } from "./monitoring/tokenLogger.js";

const logger = createTokenLogger({ profileDir: "/path/to/profile" });

// Log text content
logger.logText("load-instruction", "AGENTS.md", fileContent);

// Log from file path
logger.logFile("load-persona", "/path/to/persona.md");

// Log with metadata
logger.log("cli-operation", "merge-weave", 250, {
  operation: "merge",
  prCount: 5,
});

await logger.close();
```

### Token Report Command

Analyze token usage:

```bash
# Human-readable summary
lex-pr token-report

# JSON output
lex-pr token-report --json

# Specify profile directory
lex-pr token-report --profile-dir /custom/path
```

## Usage Example

```typescript
import { createTokenLogger } from "./monitoring/tokenLogger.js";
import * as fs from "fs";

async function trackInstructionLoading(profileDir: string) {
  const logger = createTokenLogger({ profileDir });

  // Track instruction file loading
  const instructionFiles = ["AGENTS.md", ".github/copilot-instructions.md", "CLAUDE.md"];

  for (const file of instructionFiles) {
    if (fs.existsSync(file)) {
      logger.logFile("load-instruction", file, { type: "instruction" });
    }
  }

  // Track persona loading
  const personaFiles = [".smartergpt/personas/senior-dev.md", ".smartergpt/personas/eager-pm.md"];

  for (const file of personaFiles) {
    if (fs.existsSync(file)) {
      logger.logFile("load-persona", file, { type: "persona" });
    }
  }

  await logger.close();
}
```

## Log Format

JSONL format (one JSON object per line):

```jsonl
{"timestamp":"2025-12-15T00:00:00.000Z","operation":"load-instruction","source":"AGENTS.md","estimatedTokens":500,"metadata":{"type":"instruction"}}
{"timestamp":"2025-12-15T00:00:01.000Z","operation":"load-persona","source":"senior-dev.md","estimatedTokens":200,"metadata":{"type":"persona"}}
```

## Report Output

Human-readable:

```
Token Usage Report
============================================================

Total Tokens: 1,250
Total Entries: 5
Log File: /path/to/token-usage.jsonl

By Source:
------------------------------------------------------------
  AGENTS.md
    Tokens: 500 (40.0%)
    Entries: 1
  copilot-instructions.md
    Tokens: 300 (24.0%)
    Entries: 1

By Operation:
------------------------------------------------------------
  load-instruction: 800 (64.0%)
  load-persona: 200 (16.0%)
```

JSON format is also available via `--json` flag for programmatic analysis.

## Design Principles

1. **Measurement-only**: No behavior changes to existing logic
2. **Opt-in**: Token logging is enabled by default but can be disabled
3. **Structured output**: JSONL format for easy parsing and analysis
4. **Deterministic**: Stable, sortable output for diffing
5. **Lightweight**: No heavy dependencies, simple heuristic

## Future Instrumentation Points

Potential areas to add token tracking:

- Instruction file loading (AGENTS.md, copilot-instructions.md)
- Persona file loading (.smartergpt/personas/\*.md)
- Major CLI operations (merge-weave, fanout, etc.)
- Tool call responses (if metadata available)
- Context window checkpoints

## Testing

```bash
npm test -- tests/token-usage.spec.ts
```

## Notes

- Token estimation is approximate (chars/4 heuristic)
- Logs accumulate over time - consider log rotation policies
- Log file location: `<profile-dir>/runner/logs/token-usage.jsonl`
- Designed for analysis, not production metrics
