# LexRunner Integration with Lex

This document describes how LexRunner integrates with the Lex memory system.

## Module Validation Context

When LexRunner encounters module validation errors:
- **In local dev**: Non-blocking warning, falls back to substring matching
- **In CI (strict mode)**: Build fails, must fix before merge

## Pattern: Handling Resolution Warnings

```typescript
async function lexrunnerValidateModules(modules: string[], policy: Policy) {
  const resolutions = await Promise.all(
    modules.map(id => resolveModuleId(id, policy))
  );

  const warnings = resolutions.filter(r => r.confidence < 1.0 && r.confidence > 0);
  const errors = resolutions.filter(r => r.confidence === 0);

  if (warnings.length > 0) {
    console.warn('⚠️  Low-confidence resolutions:');
    warnings.forEach(w => {
      console.warn(`  '${w.original}' → '${w.canonical}' (${w.source})`);
    });
  }

  if (errors.length > 0) {
    throw new Error(`Invalid modules: ${errors.map(e => e.original).join(', ')}`);
  }

  return resolutions.map(r => r.canonical);
}
```

## API Integration Example

LexRunner can use the Lex API to automatically capture Frames during development sessions:

```typescript
// LexRunner integration example
class LexRunnerIntegration {
  private apiUrl: string;
  private apiKey: string;

  constructor(apiUrl: string, apiKey: string) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  async captureFrame(context: RunContext) {
    const frame = {
      reference_point: context.referencePoint,
      summary_caption: context.summary,
      module_scope: context.touchedModules,
      status_snapshot: {
        next_action: context.nextAction,
        blockers: context.blockers,
      },
      branch: context.gitBranch,
      runId: context.runId,
      planHash: context.planHash,
    };

    const response = await fetch(`${this.apiUrl}/api/frames`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(frame),
    });

    return response.json();
  }
}
```

## Related Documentation

- [Lex API Documentation](https://github.com/Guffawaffle/lex/docs/API_USAGE.md)
- [Lex Frame Schema](https://github.com/Guffawaffle/lex/src/memory/frames/types.ts)
- [Module Aliasing](./ALIASING_FOR_RUNNER.md)
