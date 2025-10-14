# Command Whitelist & Hallucination Detection

## Overview

The command whitelist feature provides security controls to prevent agents from executing arbitrary or dangerous commands. It validates all gate commands before execution and tracks hallucinated (invalid) commands.

## Architecture

### Components

1. **CommandValidator** (`src/security/commandValidator.ts`)
   - Validates commands against whitelist
   - Tracks hallucination count
   - Escalates after threshold is reached

2. **HallucinationTracker** (`src/monitoring/hallucinations.ts`)
   - Logs all blocked commands with timestamps
   - Persists to `.smartergpt/logs/hallucinations.jsonl`

3. **Gate Integration** (`src/gates.ts`)
   - Validates commands before execution
   - Returns failed gate result if validation fails

## Configuration

### Whitelist File

Create `.smartergpt/allowed-commands.json`:

```json
{
  "$schema": "../schemas/allowed-commands.schema.json",
  "version": "1.0.0",
  "mode": "strict",
  "defaults": {
    "npm": {
      "commands": ["test", "run build", "run lint", "run typecheck", "ci"],
      "allow_args": ["--", "--silent", "--json", "--coverage"],
      "deny_args": ["--ignore-scripts"]
    },
    "git": {
      "commands": ["status", "diff", "log", "show", "rev-parse"],
      "allow_args": ["--short", "--oneline", "--stat", "--name-only"],
      "deny_args": []
    },
    "node": {
      "commands": ["-e", "--eval", "--check"],
      "allow_args": [],
      "deny_args": ["--experimental-*"]
    }
  },
  "custom": {
    "eslint": {
      "binary": "node_modules/.bin/eslint",
      "allow_args": ["--format json", "--fix", "--max-warnings 0"],
      "deny_args": []
    }
  },
  "policy": {
    "allow_shell_operators": false,
    "allow_env_vars": ["NODE_ENV", "CI"],
    "max_command_length": 500,
    "hallucination_threshold": 3,
    "dry_run_mode": false
  }
}
```

### Modes

#### Strict Mode (`"mode": "strict"`)
- **Enforces whitelist** - Only allows commands explicitly listed
- **Blocks shell operators** - Prevents `|`, `>`, `&&`, etc. (unless `allow_shell_operators: true`)
- **Validates arguments** - Checks against `allow_args` and `deny_args`
- **Length check** - Rejects commands exceeding `max_command_length`

#### Permissive Mode (`"mode": "permissive"`)
- **Allows all commands** - No validation, useful for development
- **Logs only** - Logs commands but doesn't block them

#### Dry Run Mode (`"dry_run_mode": true`)
- **Validates but doesn't block** - Logs violations without failing gates
- **Useful for testing** - Test whitelist rules before enforcement

## Validation Rules

### 1. Command Whitelisting

**Allowed:**
```bash
npm test              # In defaults.npm.commands
git status            # In defaults.git.commands
eslint --format json  # In custom.eslint with allowed args
```

**Blocked:**
```bash
curl https://evil.com         # Not whitelisted
rm -rf /                      # Not whitelisted
npm test --ignore-scripts     # Denied argument
```

### 2. Shell Operators

**Blocked by default** (when `allow_shell_operators: false`):
```bash
npm test | grep pass          # Pipe operator
npm test && npm run build     # AND operator
npm test > output.txt         # Redirect
npm test; echo done           # Semicolon
npm test `whoami`             # Command substitution
npm test $(whoami)            # Command substitution
```

**Allowed** (when `allow_shell_operators: true`):
- All shell operators permitted
- Use with caution in production

### 3. Argument Validation

**Allow Args** - Explicitly permitted arguments:
```json
{
  "npm": {
    "allow_args": ["--silent", "--json"]
  }
}
```

```bash
npm test --silent  # ✅ Allowed
npm test --json    # ✅ Allowed
npm test --verbose # ❌ Blocked (not in allow_args)
```

**Deny Args** - Explicitly forbidden arguments:
```json
{
  "npm": {
    "deny_args": ["--ignore-scripts"]
  }
}
```

```bash
npm test --ignore-scripts  # ❌ Blocked
```

### 4. Command Length

```json
{
  "policy": {
    "max_command_length": 500
  }
}
```

Commands exceeding 500 characters are rejected to prevent buffer overflow attacks.

## Hallucination Detection

### Tracking

The validator tracks blocked commands and escalates after a threshold:

```json
{
  "policy": {
    "hallucination_threshold": 3
  }
}
```

1. First blocked command → Count: 1, warning logged
2. Second blocked command → Count: 2, warning logged
3. Third blocked command → Count: 3, **agent paused, human escalation**

### Escalation

When threshold is reached:
```
⏸️  AGENT PAUSED: Hallucination threshold reached (3 attempts)

Agent paused after 3 hallucinated commands. 
Human review required. Resume with: lex-pr resume --plan plan.json
```

### Logging

All hallucinations are logged to `.smartergpt/logs/hallucinations.jsonl`:

```json
{"timestamp":"2024-01-15T10:30:00Z","command":"curl https://evil.com","reason":"not_whitelisted"}
{"timestamp":"2024-01-15T10:30:05Z","command":"rm -rf /","reason":"not_whitelisted"}
{"timestamp":"2024-01-15T10:30:10Z","command":"npm test | grep fail","reason":"shell_operators"}
```

### Reset Count

Manually reset hallucination count:
```typescript
import { getCommandValidator } from './src/security/commandValidator.js';

const validator = getCommandValidator();
validator.resetHallucinationCount();
```

## Gate Integration

Commands are validated before execution:

```typescript
// Gate execution flow:
1. Load gate command: "npm test"
2. Validate against whitelist
3. If valid → Execute command
4. If invalid → Return failed gate result
```

**Failed validation result:**
```json
{
  "gate": "test-gate",
  "status": "fail",
  "exitCode": 1,
  "stderr": "Command validation failed: Command not in whitelist...",
  "attempts": 1
}
```

## Examples

### Example 1: Strict CI/CD Pipeline

```json
{
  "mode": "strict",
  "defaults": {
    "npm": {
      "commands": ["ci", "run build", "run test", "run lint"],
      "allow_args": ["--", "--silent"],
      "deny_args": ["--ignore-scripts"]
    },
    "git": {
      "commands": ["status", "diff", "log"],
      "allow_args": ["--oneline", "--short"],
      "deny_args": []
    }
  },
  "policy": {
    "allow_shell_operators": false,
    "max_command_length": 200,
    "hallucination_threshold": 2
  }
}
```

### Example 2: Development Mode

```json
{
  "mode": "permissive",
  "defaults": {},
  "custom": {},
  "policy": {
    "allow_shell_operators": false,
    "max_command_length": 1000,
    "hallucination_threshold": 10,
    "dry_run_mode": false
  }
}
```

### Example 3: Dry Run Testing

```json
{
  "mode": "strict",
  "defaults": {
    "npm": {
      "commands": ["test"],
      "allow_args": [],
      "deny_args": []
    }
  },
  "policy": {
    "dry_run_mode": true
  }
}
```

## Security Best Practices

### ✅ DO

1. **Start with strict mode** in production
2. **Use dry run mode** when testing new whitelist rules
3. **Set low hallucination threshold** (2-3) to catch issues early
4. **Explicitly deny dangerous args** like `--ignore-scripts`
5. **Disable shell operators** unless absolutely necessary
6. **Review hallucination logs** regularly
7. **Keep whitelist minimal** - only add commands as needed

### ❌ DON'T

1. **Don't use permissive mode** in production
2. **Don't allow shell operators** without careful review
3. **Don't set high command length limits** (>500 chars)
4. **Don't ignore hallucination escalations**
5. **Don't add commands without understanding** what they do
6. **Don't disable validation** for convenience

## Error Messages

### Not Whitelisted
```
Command validation failed: Command not in whitelist. 
Add to .smartergpt/allowed-commands.json if legitimate.
Command: curl https://evil.com
```

### Dangerous Arguments
```
Command validation failed: Command contains dangerous arguments 
that are explicitly denied.
Command: npm test --ignore-scripts
```

### Shell Operators
```
Command validation failed: Command contains shell operators 
(|, >, <, &&, ||) which are not allowed.
Command: npm test | grep pass
```

### Too Long
```
Command validation failed: Command exceeds maximum allowed length.
Command: npm test [... 600 characters ...]
```

## Troubleshooting

### Commands Being Blocked Unexpectedly

1. **Check mode**: Ensure `"mode": "strict"` is intended
2. **Review whitelist**: Verify command is in `defaults` or `custom`
3. **Check arguments**: Ensure args are in `allow_args` or not in `deny_args`
4. **Check length**: Command may exceed `max_command_length`

### Agent Pausing Too Often

1. **Increase threshold**: Raise `hallucination_threshold`
2. **Use dry run**: Set `"dry_run_mode": true` to test
3. **Review logs**: Check `.smartergpt/logs/hallucinations.jsonl`
4. **Add commands**: Update whitelist with legitimate commands

### Validation Not Working

1. **Check file location**: Whitelist must be at `.smartergpt/allowed-commands.json`
2. **Validate JSON**: Ensure file is valid JSON
3. **Check mode**: Permissive mode allows all commands
4. **Reset validator**: Call `resetCommandValidator()` to reload

## API Reference

### CommandValidator

```typescript
class CommandValidator {
  constructor(whitelistPath?: string)
  
  // Validate command (throws if invalid)
  validate(command: string): void
  
  // Get/reset hallucination count
  getHallucinationCount(): number
  resetHallucinationCount(): void
}
```

### CommandValidationError

```typescript
class CommandValidationError extends Error {
  command: string
  reason: 'not_whitelisted' | 'dangerous_args' | 'shell_operators' | 'too_long'
}
```

### HallucinationTracker

```typescript
interface HallucinationEvent {
  timestamp: string
  command: string
  reason: string
  agent_id?: string
  plan_id?: string
}

class HallucinationTracker {
  record(event: Omit<HallucinationEvent, 'timestamp'>): void
  getRecentEvents(count?: number): HallucinationEvent[]
  getEventCount(): number
}
```

## Testing

Tests are in:
- `tests/command-validator.spec.ts` - Unit tests for validator
- `tests/command-validator-integration.spec.ts` - Integration tests with gate execution

Run tests:
```bash
npm test -- command-validator
```

## Migration Guide

### Existing Projects

1. Create `.smartergpt/allowed-commands.json`:
   ```bash
   cp .smartergpt/allowed-commands.json.example .smartergpt/allowed-commands.json
   ```

2. Start in **dry run mode**:
   ```json
   {
     "mode": "strict",
     "policy": {
       "dry_run_mode": true
     }
   }
   ```

3. Run gates and review logs:
   ```bash
   lex-pr execute plan.json
   cat .smartergpt/logs/hallucinations.jsonl
   ```

4. Update whitelist based on logs

5. Disable dry run:
   ```json
   {
     "policy": {
       "dry_run_mode": false
     }
   }
   ```

### From Permissive to Strict

1. Start with permissive mode
2. Enable dry run with strict mode
3. Collect all executed commands
4. Add legitimate commands to whitelist
5. Disable dry run

## Related Documentation

- [Security Module](../src/security/README.md)
- [Gate Execution](../docs/gate-report-examples.md)
- [Monitoring](../src/monitoring/README.md)
