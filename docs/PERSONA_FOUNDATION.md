# Persona Foundation

This directory contains the persona schema foundation imported from Lex.

## Overview

Personas are explicit, noun-y, human-initiated operational modes for AI agents. The foundation provides:

1. **Schema validation** — `src/schemas/persona.ts` defines the canonical structure
2. **Hello-world example** — `.smartergpt/personas/example.md` demonstrates basic usage
3. **Production personas** — `.smartergpt/personas/senior-dev.md` and `eager-pm.md`

## Schema Structure

```yaml
---
name: Persona Name
version: 1.0.0
triggers:
  - "activation phrase 1"
  - "activation phrase 2"
role:
  title: Job Title
  scope: Brief scope description
  repo: /optional/repo/path
ritual: ACTIVATION-MESSAGE
duties:
  must_do:
    - Required action 1
    - Required action 2
  must_not_do:
    - Forbidden action 1
    - Forbidden action 2
gates:
  - lint
  - typecheck
  - test
---
# Persona Markdown Body

Detailed guidance, examples, and context...
```

## Usage

### Validating a Persona

```typescript
import { parsePersona, validatePersona } from "./src/schemas/persona.js";
import { parse as parseYaml } from "yaml";
import fs from "fs";

// Load persona file
const content = fs.readFileSync(".smartergpt/personas/example.md", "utf-8");
const [, frontmatter] = content.split("---\n");
const metadata = parseYaml(frontmatter);

// Validate
const result = validatePersona(metadata);
if (result.success) {
  console.log(`✓ ${result.data.name} validated`);
} else {
  console.error("Validation errors:", result.errors);
}
```

### Creating a New Persona

1. Copy `.smartergpt/personas/example.md` as a template
2. Update the YAML frontmatter with your persona details
3. Write the markdown body with detailed guidance
4. Validate against the schema before use

## Relationship to Lex

This foundation is based on Lex PR #505 (Persona Foundation in Lex).

**Current State:**

- Lex v2.0.2 contains `PersonaSchema` but doesn't export it publicly
- LexRunner re-implements the schema matching the Lex structure
- When Lex publishes `@smartergpt/lex/schemas/persona`, replace the re-implementation

**Migration Path:**

```typescript
// Current (re-implementation)
import { PersonaSchema } from "./src/schemas/persona.js";

// Future (once Lex exports it)
import { PersonaSchema } from "@smartergpt/lex/schemas/persona";
```

## Files

```
src/schemas/persona.ts           — Schema definition (Zod)
tests/schemas/persona.spec.ts    — Unit tests
tests/schemas/persona-integration.spec.ts — Integration tests
.smartergpt/personas/example.md  — Hello-world example
.smartergpt/personas/senior-dev.md — Production persona
.smartergpt/personas/eager-pm.md — Production persona
```

## Tests

```bash
# Run persona schema tests
npm test -- tests/schemas/persona.spec.ts

# Run persona integration tests
npm test -- tests/schemas/persona-integration.spec.ts
```

## Next Steps

This foundation enables:

- **Advanced persona workflows** — Activation, validation, switching
- **Dynamic persona loading** — Runtime discovery and validation
- **Persona-aware orchestration** — Tool-grounded decision-making
- **Cross-repo persona sharing** — Import personas from Lex

See the issue tracker for planned enhancements to the persona system.
