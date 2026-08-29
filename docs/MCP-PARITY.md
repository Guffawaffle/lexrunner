# MCP/CLI Parity Audit

**Status:** Complete  
**Issue:** AX-004  
**AX Principle:** Structured Over Conversational

This document establishes parity between the CLI interface and MCP server tools for LexRunner 1.0.0.

## Parity Matrix

### Core Commands

| CLI Command   | MCP Tool      | Parity  | Notes                                                     |
| ------------- | ------------- | ------- | --------------------------------------------------------- |
| `plan`        | `plan.create` | ✅ Full | Both support GitHub auto-discovery, labels, gates, target |
| `execute`     | `gates.run`   | ✅ Full | MCP accepts external planFile or internal state           |
| `merge`       | `merge.apply` | ✅ Full | MCP enforces ALLOW_MUTATIONS for safety                   |
| `discover`    | `discover`    | ✅ Full | Added in AX-004 audit                                     |
| `status`      | `status`      | ✅ Full | Added in AX-004 audit                                     |
| `doctor`      | `doctor`      | ✅ Full | Added in AX-004 audit                                     |
| `health`      | `health`      | ✅ Full | MCP tool, CLI uses `doctor --json`                        |
| `merge-order` | `merge-order` | ✅ Full | Added in AX-004 audit                                     |

### Configuration Commands

| CLI Command   | MCP Tool          | Parity      | Notes                                       |
| ------------- | ----------------- | ----------- | ------------------------------------------- |
| `init-local`  | `local.init`      | ✅ Full     | Identical semantics                         |
| `config show` | `config.show`     | ✅ Full     | Added in AX-004 audit                       |
| n/a           | `profile.resolve` | ✅ MCP Only | Internal profile resolution exposed via MCP |

### Senior Dev Executor Tools (MCP Only)

| MCP Tool                     | CLI Equivalent               | Notes                          |
| ---------------------------- | ---------------------------- | ------------------------------ |
| `senior-dev.prepare-context` | `senior-dev prepare-context` | Full parity via CLI subcommand |
| `senior-dev.recall-context`  | `senior-dev recall-context`  | Full parity via CLI subcommand |
| `senior-dev.capture-frame`   | `senior-dev capture-frame`   | Full parity via CLI subcommand |
| `senior-dev.modes`           | `senior-dev modes`           | Full parity via CLI subcommand |

### Deprecated IntegrationRun Record Tools

| MCP Tool                  | CLI Equivalent | Notes                                                               |
| ------------------------- | -------------- | ------------------------------------------------------------------- |
| `lexrunner.startRun`      | n/a            | Deprecated IntegrationRun record adapter; remove in 3.0.0           |
| `lexrunner.getStatus`     | n/a            | Deprecated bounded IntegrationRun status; remove in 3.0.0           |
| `lexrunner.listArtifacts` | n/a            | Deprecated bounded artifact metadata, without inline content; 3.0.0 |

## Intentional Gaps

### CLI-Only Commands

These commands are intentionally CLI-only due to their interactive or local-only nature:

| Command          | Reason                                  |
| ---------------- | --------------------------------------- |
| `init`           | Interactive wizard requiring user input |
| `bootstrap`      | Local filesystem bootstrap              |
| `view`           | Interactive TUI requiring terminal      |
| `plan-review`    | Interactive review with prompts         |
| `completion`     | Shell-specific completion scripts       |
| `retry`          | Requires local execution state          |
| `query`          | Interactive query interface             |
| `plan-diff`      | Local file comparison                   |
| `idea`           | Interactive ideation workflow           |
| `create-project` | Interactive project creation            |

### MCP-Only Tools

These surfaces are MCP-only. The `lexrunner.*` entries are legacy IntegrationRun record adapters,
not orchestration authority:

| Tool                      | Reason                                                    |
| ------------------------- | --------------------------------------------------------- |
| `lexrunner.startRun`      | Deprecated; use integration operations or `start_attempt` |
| `lexrunner.getStatus`     | Deprecated; use `status` or `get_attempt_status`          |
| `lexrunner.listArtifacts` | Deprecated; use owning operation artifact references      |
| `profile.resolve`         | Internal resolution exposed for MCP clients               |

## Semantic Equivalence

All parity commands guarantee:

1. **Same inputs produce same outputs**: JSON payloads are equivalent
2. **Same error codes**: Validation errors return equivalent structures
3. **Same side effects**: File writes, API calls behave identically
4. **Deterministic output**: All JSON uses `canonicalJSONStringify()`

### Input/Output Mapping

#### `plan` / `plan.create`

```
CLI:  lex-pr plan --from-github --labels "ready" --json
MCP:  { name: "plan.create", arguments: { fromGithub: true, labels: ["ready"] } }

Both return:
{
  "schemaVersion": "1.0.0",
  "target": "main",
  "items": [...],
  "policy": {...}
}
```

#### `execute` / `gates.run`

```
CLI:  lex-pr execute plan.json --json
MCP:  { name: "gates.run", arguments: { planFile: "plan.json" } }

Both return:
{
  "items": [{ "name": "...", "status": "pass", "gates": [...] }],
  "allGreen": true
}
```

#### `discover` / `discover`

```
CLI:  lex-pr discover --json
MCP:  { name: "discover", arguments: {} }

Both return:
{
  "pullRequests": [...],
  "total": N,
  "authenticated": true,
  "user": "..."
}
```

#### `status` / `status`

```
CLI:  lex-pr status plan.json --json
MCP:  { name: "status", arguments: { planFile: "plan.json" } }

Both return:
{
  "plan": { "schemaVersion": "...", "target": "...", "itemCount": N },
  "mergeSummary": { "eligible": [...], "pending": [...], "failed": [...] }
}
```

#### `doctor` / `doctor`

```
CLI:  lex-pr doctor --json
MCP:  { name: "doctor", arguments: {} }

Both return:
{
  "hasErrors": false,
  "issues": [],
  "suggestions": [],
  "nodejs": { "status": "ok", ... },
  "git": { "status": "ok", ... },
  ...
}
```

#### `merge-order` / `merge-order`

```
CLI:  lex-pr merge-order plan.json --json
MCP:  { name: "merge-order", arguments: { planFile: "plan.json" } }

Both return:
{
  "levels": [["item-a"], ["item-b"]],
  "totalItems": N,
  "maxParallelism": N
}
```

#### `config show` / `config.show`

```
CLI:  lex-pr config show --json
MCP:  { name: "config.show", arguments: {} }

Both return:
{
  "config": { ... },
  "provenance": { ... },
  "sources": [...]
}
```

## Error Handling Parity

| Error Type       | CLI Exit Code | MCP Error Code            |
| ---------------- | ------------- | ------------------------- |
| Success          | 0             | No error                  |
| System error     | 1             | -32603 (Internal)         |
| Validation error | 2             | -32602 (Invalid params)   |
| Not found        | 1             | -32601 (Method not found) |

## Testing Parity

To verify parity, run the test suite:

```bash
npm test -- --grep "mcp-parity"
```

Or manually verify:

```bash
# CLI
lex-pr discover --json > /tmp/cli-discover.json

# MCP (via test script)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"discover","arguments":{}}}' | node mcp-server.mjs 2>/dev/null | jq -r '.result.content[0].text' > /tmp/mcp-discover.json

# Compare structure
jq 'keys' /tmp/cli-discover.json
jq 'keys' /tmp/mcp-discover.json
```

## Version History

| Version | Date       | Changes                       |
| ------- | ---------- | ----------------------------- |
| 1.0.0   | 2025-12-02 | Initial parity audit (AX-004) |

## References

- [CLI Reference](./cli.md)
- [MCP Migration Guide](./MCP-MIGRATION.md)
- [AX Contract](../AX-CONTRACT.v0.1.yaml)
