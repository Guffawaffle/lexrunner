# LexSona Behavioral Rules

**Status:** 🚧 Preparation for v0.5.0 (Currently Disabled)

## Overview

LexSona is a behavioral rule system that provides AI agents with architectural guidance, policy enforcement, and best practices. This module prepares the infrastructure for integrating LexSona rules from the `@smartergpt/lex` package.

## Current Status

- ✅ Infrastructure implemented and tested
- ✅ Package integration ready
- ⚠️ **Feature disabled by default** (will be enabled in v0.5.0)

## Architecture

### Rule Structure

```typescript
interface BehavioralRule {
  id: string;              // Unique identifier
  title: string;           // Human-readable name
  description: string;     // Rule description
  content: string;         // Rule content/guidance
  scope?: {               // Optional scope filtering
    environment?: string;  // e.g., "development", "production"
    project?: string;      // Project identifier
    agentFamily?: string;  // e.g., "copilot", "claude"
  };
  priority?: number;       // Higher = more important
}
```

### Precedence Chain (When Enabled)

1. **`LEX_RULES_DIR`** (environment variable) - Explicit override
2. **`.smartergpt.local/canon/rules/`** - Workspace overlay
3. **`@smartergpt/lex/rules/`** - Package defaults

## Usage (v0.5.0)

When the feature is enabled in v0.5.0:

```typescript
import { loadLexSonaRules, formatRulesForPrompt } from './config/rulesResolver.js';

// Load rules with scope filtering
const rules = await loadLexSonaRules({
  environment: 'development',
  project: 'lex-pr-runner',
  agentFamily: 'copilot'
}, true); // enabled = true

// Format for system prompt injection
const promptSection = formatRulesForPrompt(rules);
```

## Available Rules (Package)

The `@smartergpt/lex` package includes canonical rules:

- **escalation-response.json** - Guidance on escalating to human operators
- **operator-role-primacy.json** - Human operator authority and override protocols
- **plan-execute-transition.json** - Planning vs. execution phase transitions
- **tool-fallback-protocol.json** - Tool failure handling and fallback strategies

## Scope Metadata

Rules support scope filtering to provide context-appropriate guidance:

- **environment**: Target deployment environment
- **project**: Specific project or repository
- **agentFamily**: AI agent type (for agent-specific customization)

## Feature Flag

The LexSona infrastructure is controlled by the `enabled` parameter in `loadLexSonaRules()`:

```typescript
// Currently disabled (default)
await loadLexSonaRules(scope, false);  // Returns []

// Will be enabled in v0.5.0
await loadLexSonaRules(scope, true);   // Loads rules
```

## Testing

All infrastructure is tested and ready:

```bash
npm test -- tests/rulesResolver.spec.ts
```

Test coverage:
- ✅ Package availability detection
- ✅ Rule loading (enabled/disabled states)
- ✅ Scope filtering support
- ✅ Prompt formatting
- ✅ Priority-based sorting

## Roadmap

### v0.4.0 (Current)
- ✅ Infrastructure implemented
- ✅ Package integration ready
- ⚠️ Feature disabled

### v0.5.0 (Planned)
- 🔜 Enable LexSona rules
- 🔜 API integration for dynamic rule updates
- 🔜 Rule versioning and compatibility checks
- 🔜 Enhanced scope filtering
- 🔜 Rule override mechanisms

## See Also

- [Prompts Configuration](./prompts.md) - Prompts precedence chain
- [Lex Package Integration](./schemas.md) - Schema alignment
- [PROJECT_0.4.0_ALIGNMENT.md](../PROJECT_0.4.0_ALIGNMENT.md) - Release planning
