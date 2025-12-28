# Store Layer

This directory contains the RunStore interface and its implementations.

## Interface

- `run-store.ts` — `RunStore` interface and associated types

## Implementations

| Implementation | Status  | Use Case            |
| -------------- | ------- | ------------------- |
| `inmemory/`    | Default | CLI runs, testing   |
| `sqlite/`      | Future  | Local persistence   |
| `postgres/`    | Future  | Multi-tenant/hosted |

## Design Principles

1. **Interface-first** — All implementations conform to `RunStore`
2. **ID ownership** — Caller generates IDs, store persists
3. **Timestamps** — UTC ISO 8601 strings
4. **NDJSON coexistence** — RunStore complements, not replaces, audit logs
