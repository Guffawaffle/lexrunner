# Autopilot Module

This module provides the automation level system for lexrunner's merge-weave execution.

## Overview

The autopilot system defines five levels of automation (0-4), allowing teams to incrementally adopt automation while maintaining safety and control.

## Files

- `types.ts` - Core types, enums, schemas, and validation logic
- `base.ts` - Base autopilot classes (Level 0)
- `level1.ts` - Artifact generation (Level 1)
- `level2.ts` - PR annotations (Level 2)
- `level3.ts` - Integration branches (Level 3)
- `level4.ts` - Full automation (Level 4)
- `artifacts.ts` - Artifact generation utilities
- `safety/` - Safety framework for rollback and validation
- `index.ts` - Module exports

## Usage

```typescript
import { AutopilotLevel, parseAutopilotConfig, hasCapability } from "./autopilot/index.js";

// Parse CLI options into config
const config = parseAutopilotConfig({
  maxLevel: 3,
  openPr: true,
  branchPrefix: "integration/",
});

// Check capabilities
if (hasCapability(config, "branches")) {
  // Create integration branches
}
```

## Key Concepts

### Autopilot Levels

All levels (0-4) are fully implemented:

- **Level 0**: Report only - safe for CI, no side effects
- **Level 1**: Artifact generation - creates detailed execution plans
- **Level 2**: PR annotations - posts status updates to PRs
- **Level 3**: Integration branches - creates branches and PRs
- **Level 4**: Full automation - end-to-end merge-weave with finalization

Each level builds upon the previous, executing all lower-level functionality first.

### Validation

The module enforces strict validation rules:

- Level must be 0-4 (integer)
- `--open-pr` requires level 3+
- `--close-superseded` requires level 4
- `--comment-template` requires level 2+

### Configuration

Configuration is parsed from CLI flags and validated for:

1. Schema compliance (via Zod)
2. Logical consistency (flag dependencies)
3. Safety boundaries

## Testing

Comprehensive test coverage for all levels:

- `tests/autopilot.spec.ts` - Config validation and parsing
- `tests/autopilot-level1.spec.ts` - Artifact generation tests
- `tests/autopilot-level2.spec.ts` - PR annotation tests
- `tests/autopilot-level3.spec.ts` - Integration branch tests
- `tests/autopilot-level4.spec.ts` - Full automation tests
- `tests/autopilot-integration.spec.ts` - End-to-end integration tests

Run tests:

```bash
npm test -- tests/autopilot
```

## Documentation

For detailed usage and examples:

- [Autopilot Levels](../../docs/autopilot-levels.md) - Complete user documentation
- [Autopilot Guide](../../docs/autopilot.md) - Implementation guide
- [Merge-Weave Analysis](../../docs/merge-weave-analysis.md) - Design and architecture

## Implementation Notes

### Level 4 Finalization

Level 4 adds the following finalization steps after Level 3's integration:

1. **Merge Integration Branch**: Merges the validated integration branch to the target
2. **Close Superseded PRs**: Optionally closes source PRs (with `--close-superseded`)
3. **Post Finalization Comments**: Adds completion comments with integration details
4. **Cleanup Integration Branch**: Removes integration branch after successful merge
5. **Rollback on Failure**: Reverts failed merge attempts and preserves integration branch

### Rollback Capabilities

All levels support graceful error handling:

- **Level 3**: Preserves failed integration branches for debugging
- **Level 4**: Rolls back failed merges and returns to clean state
- Failed operations never delete integration artifacts for post-mortem analysis
