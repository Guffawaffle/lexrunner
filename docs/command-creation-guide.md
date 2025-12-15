# Command Creation Guide

This guide shows how to create new commands in the modular lexrunner CLI architecture.

## Overview

The lexrunner CLI uses a **modular command architecture** where:
- Each command lives in its own module under `src/commands/`
- Commands are registered in `src/cli.ts` using a standard pattern
- Shared utilities are in `src/cli/` (output, flags, exit handling)
- Business logic stays in `src/core/`

## Quick Start

### 1. Create Command Module

Create a new file in `src/commands/` following the naming convention:

```bash
# For single-word commands
src/commands/mycommand.ts

# For hyphenated commands (use camelCase for filename)
src/commands/myCommand.ts  # for "my-command"
```

### 2. Command Template

Use this template as your starting point:

```typescript
// src/commands/myCommand.ts
import { Command } from 'commander';
import { writeJsonOutput } from '../cli/output.js';
import { throwExit } from '../cli/exitHandler.js';

/**
 * Register the my-command command
 */
export function registerMyCommandCommand(program: Command): void {
  program
    .command('my-command')
    .description('Brief description of what this command does')
    .argument('<required-arg>', 'Description of required argument')
    .option('-o, --option <value>', 'Description of optional flag')
    .option('--json', 'Output as JSON')
    .action(async (requiredArg, options) => {
      try {
        const result = await executeMyCommand(requiredArg, options);

        if (options.json) {
          writeJsonOutput(result);
        } else {
          console.log(formatMyCommandOutput(result));
        }
      } catch (error) {
        throwExit(error, 1);
      }
    });
}

/**
 * Pure, testable business logic
 */
async function executeMyCommand(
  arg: string,
  options: { option?: string }
): Promise<MyCommandResult> {
  // Your implementation here
  return {
    success: true,
    data: `Processed ${arg} with option ${options.option}`
  };
}

/**
 * Format output for human consumption
 */
function formatMyCommandOutput(result: MyCommandResult): string {
  return `✅ ${result.data}`;
}

interface MyCommandResult {
  success: boolean;
  data: string;
}
```

### 3. Register in CLI

Add your command to `src/cli.ts`:

```typescript
// src/cli.ts
import { registerMyCommandCommand } from './commands/myCommand.js';

// ... existing imports ...

function registerCommands(program: Command): void {
  // ... existing registrations ...
  registerMyCommandCommand(program);
}
```

### 4. Add Tests

Create a test file in `tests/commands/`:

```typescript
// tests/commands/myCommand.spec.ts
import { describe, it, expect } from 'vitest';
import { registerMyCommandCommand } from '../../src/commands/myCommand.js';
import { Command } from 'commander';

describe('myCommand', () => {
  it('should register command with correct name', () => {
    const program = new Command();
    registerMyCommandCommand(program);

    const command = program.commands.find(cmd => cmd.name() === 'my-command');
    expect(command).toBeDefined();
  });

  it('should execute successfully', async () => {
    // Test your command logic
  });
});
```

## Best Practices

### Separation of Concerns

✅ **DO:**
```typescript
// Command handler (thin wrapper)
.action(async (args, options) => {
  const result = await executeMyCommand(args, options);
  handleOutput(result, options);
});

// Pure business logic (easily testable)
async function executeMyCommand(args, options) {
  // All logic here
}
```

❌ **DON'T:**
```typescript
// Business logic mixed with CLI handling
.action(async (args, options) => {
  // Complex logic inline - hard to test!
  const data = processData(args);
  if (options.json) {
    console.log(JSON.stringify(data));
  } else {
    console.log(formatData(data));
  }
});
```

### Output Handling

Always support both human and JSON output:

```typescript
if (options.json) {
  writeJsonOutput(result);  // Use helper from cli/output.js
} else {
  console.log(formatForHuman(result));
}
```

### Error Handling

Use `throwExit` for consistent error handling:

```typescript
import { throwExit } from '../cli/exitHandler.js';

try {
  const result = await riskyOperation();
} catch (error) {
  throwExit(error, 1);  // Exit with code 1
}
```

### Type Safety

Define interfaces for your results:

```typescript
interface MyCommandResult {
  success: boolean;
  items: string[];
  metadata?: Record<string, unknown>;
}
```

## Command Categories

### Simple Commands

**Characteristics:**
- No complex dependencies
- Minimal business logic
- Quick to execute

**Examples:** `completion`, `merge-order`, `status`

**Location:** `src/commands/simpleCommand.ts`

### Complex Commands

**Characteristics:**
- Orchestrate multiple operations
- May spawn subprocesses
- Require extensive error handling

**Examples:** `execute`, `merge`, `autopilot`

**Location:** `src/commands/complexCommand.ts`

### Command Groups

For related commands, use subdirectories:

```
src/commands/
├── orchestrate/
│   ├── fanout.ts
│   ├── merge.ts
│   └── status.ts
└── audit/
    ├── validate.ts
    └── export.ts
```

Register command groups:

```typescript
// src/commands/orchestrate/index.ts
import { Command } from 'commander';
import { registerFanoutCommand } from './fanout.js';
import { registerMergeCommand } from './merge.js';

export function registerOrchestrateCommands(program: Command): void {
  const orchestrate = program.command('orchestrate').description('Orchestration commands');

  registerFanoutCommand(orchestrate);
  registerMergeCommand(orchestrate);
}
```

## Testing Patterns

### Unit Tests

Test your business logic functions directly:

```typescript
describe('executeMyCommand', () => {
  it('should process valid input', async () => {
    const result = await executeMyCommand('test', { option: 'value' });
    expect(result.success).toBe(true);
  });

  it('should handle errors gracefully', async () => {
    await expect(executeMyCommand('', {})).rejects.toThrow();
  });
});
```

### Integration Tests

Test the full command flow:

```typescript
import { executeCommand } from '../helpers/cli-test-utils.js';

describe('my-command integration', () => {
  it('should execute via CLI', async () => {
    const output = await executeCommand('my-command arg --option value');
    expect(output).toContain('✅');
  });

  it('should support JSON output', async () => {
    const output = await executeCommand('my-command arg --json');
    const result = JSON.parse(output);
    expect(result.success).toBe(true);
  });
});
```

## Common Utilities

### Output (`src/cli/output.js`)

```typescript
import { writeJsonOutput } from '../cli/output.js';

// Write JSON to stdout
writeJsonOutput({ success: true, data: [] });
```

### Exit Handling (`src/cli/exitHandler.js`)

```typescript
import { throwExit, CLIExitSignal } from '../cli/exitHandler.js';

// Graceful exit with error message
throwExit(new Error('Operation failed'), 1);

// Exit with signal
throw new CLIExitSignal(0, 'Success message');
```

### Global Flags (`src/cli/flags.js`)

```typescript
import { parseGlobalFlags } from '../cli/flags.js';

// Parse global flags if needed in your command
const globalOpts = parseGlobalFlags(process.argv);
```

## Documentation Requirements

When adding a new command:

1. **Update `docs/cli.md`** - Add command reference
2. **Add JSDoc comments** - Document exported functions
3. **Update CHANGELOG.md** - Note the new command
4. **Add examples** - Include in `docs/tutorials/` if complex

Example JSDoc:

```typescript
/**
 * Register the my-command command
 *
 * @param program - Commander program instance
 *
 * @example
 * ```typescript
 * import { Command } from 'commander';
 * import { registerMyCommandCommand } from './commands/myCommand.js';
 *
 * const program = new Command();
 * registerMyCommandCommand(program);
 * ```
 */
export function registerMyCommandCommand(program: Command): void {
  // ...
}
```

## Checklist

Before submitting a PR with a new command:

- [ ] Created command module in `src/commands/`
- [ ] Registered command in `src/cli.ts`
- [ ] Added unit tests in `tests/commands/`
- [ ] Added integration test (if applicable)
- [ ] Updated `docs/cli.md` with command reference
- [ ] Added JSDoc comments to exported functions
- [ ] Tested with `--json` flag
- [ ] Tested error handling (invalid inputs, missing files, etc.)
- [ ] Verified all gates pass (`npm run lint`, `npm run typecheck`, `npm test`)
- [ ] Updated CHANGELOG.md

## Examples

See these existing commands for reference:

### Simple Command Example
**File:** `src/commands/completion.ts`
- Minimal dependencies
- Pure output generation
- ~50 lines of code

### Medium Command Example
**File:** `src/commands/discover.ts`
- GitHub API integration
- Option parsing
- JSON/human output
- ~150 lines of code

### Complex Command Example
**File:** `src/commands/execute.ts`
- Multi-stage orchestration
- Subprocess management
- Progress reporting
- Error recovery
- ~300+ lines of code

## Common Pitfalls

### ❌ Avoid Inline Business Logic

```typescript
// BAD: Logic in action handler
.action(async (args, options) => {
  const data = await fetchData();
  const filtered = data.filter(x => x.active);
  const sorted = filtered.sort((a, b) => a.name.localeCompare(b.name));
  console.log(sorted);
});
```

```typescript
// GOOD: Separate business logic
.action(async (args, options) => {
  const result = await executeMyCommand(args, options);
  handleOutput(result, options);
});

async function executeMyCommand(args, options) {
  const data = await fetchData();
  return processData(data);
}
```

### ❌ Avoid Console.log for Errors

```typescript
// BAD
catch (error) {
  console.log('Error:', error.message);
  process.exit(1);
}
```

```typescript
// GOOD
catch (error) {
  throwExit(error, 1);
}
```

### ❌ Don't Mix Output Formats

```typescript
// BAD: JSON polluted with human messages
if (options.json) {
  console.log('Processing...');  // ❌ Non-JSON output
  writeJsonOutput(result);
}
```

```typescript
// GOOD: Clean JSON output
if (options.json) {
  writeJsonOutput(result);
} else {
  console.log('Processing...');
  console.log(formatResult(result));
}
```

## Need Help?

- Check existing commands in `src/commands/` for patterns
- Review tests in `tests/commands/` for examples
- Ask in GitHub Discussions
- Read the [CLI Architecture](../docs/architecture.md) doc

## Related Documentation

- [CLI Reference](../docs/cli.md) - Full command documentation
- [Architecture](../docs/architecture.md) - Overall system design
- [Testing Guide](../docs/testing.md) - Testing patterns and tools
- [CONTRIBUTING.md](../CONTRIBUTING.md) - General contribution guidelines
