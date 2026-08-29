# Naming Conventions

> **Canonical Source:** [Lex `docs/NAMING_CONVENTIONS.md`](https://github.com/Guffawaffle/lex/blob/main/docs/NAMING_CONVENTIONS.md)

This document summarizes the Lex ecosystem naming conventions. For the full specification, see the canonical source in the Lex repository.

---

## Quick Reference

| Context            | Convention                | Example                        |
| ------------------ | ------------------------- | ------------------------------ |
| **MCP tool names** | `mcp_{ns}_{cat}_{action}` | `mcp_lexrunner_weave_discover` |
| **CLI commands**   | `{cli} {cat} {action}`    | `lex-pr weave discover`        |
| **CLI multi-word** | hyphen-case               | `--dry-run`                    |
| **Persona IDs**    | `{behavior}_{domain}`     | `quality-first_engineering`    |

---

## MCP Tools (LexRunner)

Pattern: `mcp_lexrunner_{category}_{action}`

### Categories

| Category    | Purpose                       |
| ----------- | ----------------------------- |
| `weave`     | Merge-weave orchestration     |
| `gate`      | CI/gate execution             |
| `plan`      | Plan creation/validation      |
| `workspace` | Local workspace management    |
| `run`       | Run lifecycle management      |
| `core`      | Cross-cutting (use sparingly) |

### Current → Canonical Mapping

| Current Name          | Canonical Name                            | Status                      |
| --------------------- | ----------------------------------------- | --------------------------- |
| `discover`            | `mcp_lexrunner_weave_discover`            | Planned                     |
| `status`              | `mcp_lexrunner_weave_status`              | Planned                     |
| `plan.create`         | `mcp_lexrunner_plan_create`               | Planned                     |
| `gates.run`           | `mcp_lexrunner_gate_run`                  | Planned                     |
| `merge-order`         | `mcp_lexrunner_weave_order`               | Planned                     |
| `doctor`              | `mcp_lexrunner_workspace_doctor`          | Planned                     |
| `local.init`          | `mcp_lexrunner_workspace_init`            | Planned                     |
| `lexrunner.startRun`  | Integration operations or `start_attempt` | Deprecated; remove in 3.0.0 |
| `lexrunner.getStatus` | `status` or `get_attempt_status`          | Deprecated; remove in 3.0.0 |

---

## CLI Commands (LexRunner)

Pattern: `lex-pr {category} {action} [--flags]`

See [CLI_VERBS.md](CLI_VERBS.md) for the full category-action contract.

### Current → Canonical Mapping

| Current           | Canonical                 |
| ----------------- | ------------------------- |
| `lex-pr discover` | `lex-pr weave discover`   |
| `lex-pr plan`     | `lex-pr weave plan`       |
| `lex-pr status`   | `lex-pr weave status`     |
| `lex-pr init`     | `lex-pr workspace init`   |
| `lex-pr doctor`   | `lex-pr workspace doctor` |

---

## Related Issues

- [#574](https://github.com/Guffawaffle/lexrunner/issues/574) — Cross-repo naming convention doc
- [#575](https://github.com/Guffawaffle/lexrunner/issues/575) — MCP tool naming standardization
- [#576](https://github.com/Guffawaffle/lexrunner/issues/576) — Category-action CLI migration
- [#577](https://github.com/Guffawaffle/lexrunner/issues/577) — MCP tool namespacing

---

## See Also

- [Lex NAMING_CONVENTIONS.md](https://github.com/Guffawaffle/lex/blob/main/docs/NAMING_CONVENTIONS.md) — Full specification
- [CLI_VERBS.md](CLI_VERBS.md) — CLI category-action contract
- [README.mcp.md](../README.mcp.md) — MCP server documentation
