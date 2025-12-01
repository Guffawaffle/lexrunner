# Senior Dev Executor

> **Status:** Canonical  
> **Version:** 1.0.0  
> **Manifest:** [`executor-manifest.yaml`](./executor-manifest.yaml)

## Overview

The Senior Dev executor provides structured code review with mentorship feedback and Lex memory integration. It follows the Jordan-mode protocol: deterministic prep, single stochastic call, frame emission.

## Quick Links

| Document | Purpose |
|----------|---------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Design, phases, integration points |
| [QUICK_START.md](./QUICK_START.md) | Getting started in 5 minutes |
| [MEMORY_INTEGRATION.md](./MEMORY_INTEGRATION.md) | Lex frame patterns and recall |
| [executor-manifest.yaml](./executor-manifest.yaml) | Contract definition |

## Modes

| Mode | Use Case |
|------|----------|
| `triage` | Quick PR assessment |
| `deep_review` | Detailed code analysis |
| `pattern_mining` | Find recurring issues |
| `mentorship` | Developer growth tracking |

## Core Functions

```typescript
import {
  prepareReviewContext,
  recallSeniorDevContext,
  captureSeniorDevFrame,
} from "@lex-pr-runner/executors/seniorDev";
```

### `prepareReviewContext(input)`

Gathers artifacts for code review: lint, typecheck, tests, diff, PR metadata.

### `recallSeniorDevContext(input)`

Queries Lex memory for related frames based on module, developer, pattern, or PR.

### `captureSeniorDevFrame(input)`

Writes review session to Lex memory as a frame receipt.

## Prompts

| Prompt | Mode | Purpose |
|--------|------|---------|
| [`code-review.prompt.md`](./prompts/code-review.prompt.md) | `deep_review` | Detailed code analysis |
| [`pr-analysis.prompt.md`](./prompts/pr-analysis.prompt.md) | `triage` | Quick assessment |
| [`pattern-recognition.prompt.md`](./prompts/pattern-recognition.prompt.md) | `pattern_mining` | Pattern discovery |
| [`mentorship-feedback.prompt.md`](./prompts/mentorship-feedback.prompt.md) | `mentorship` | Growth tracking |

## Scripts

| Script | Purpose |
|--------|---------|
| [`prepare-review-context.sh`](./scripts/prepare-review-context.sh) | Run prep phase |
| [`recall-context.sh`](./scripts/recall-context.sh) | Query Lex memory |
| [`capture-review-frame.sh`](./scripts/capture-review-frame.sh) | Write frame receipt |

## Examples

- [Sample Review Session](./examples/sample-review-session.md) — Complete workflow walkthrough

## Related

- [Executor Authoring Guide](../../docs/executor-authoring.md)
- [Executor Decoupling](../../docs/executor-decoupling.md)
- TypeScript Implementation: [`src/executors/seniorDev/`](../../src/executors/seniorDev/)
