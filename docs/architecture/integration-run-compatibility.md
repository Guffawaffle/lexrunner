# IntegrationRun compatibility retirement

## Decision

The published `lexrunner.startRun`, `lexrunner.getStatus`, and
`lexrunner.listArtifacts` MCP tools are deprecated in the Ecosystem 3.1 release and will be removed
in `3.0.0`. They are not renamed: a new generic run lifecycle would preserve the ambiguity that
this migration is intended to remove.

Until removal, every response identifies itself as a bounded `IntegrationRun` record with
`integration-record-only` authority. These adapters can create and inspect legacy integration
records, but they cannot authorize or advance ADR-010 `WorkItem`, `Run`, or `Attempt` state.

## Replacements

| Deprecated tool           | Replacement                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `lexrunner.startRun`      | `plan.create`, `gates.run`, or `merge.apply` for integration; `start_attempt` for ADR-010 orchestration   |
| `lexrunner.getStatus`     | `status` for integration; `get_attempt_status` for ADR-010 orchestration                                  |
| `lexrunner.listArtifacts` | Bounded artifact references returned by the owning `plan.create`, `gates.run`, or `merge.apply` operation |

## Compatibility bounds

- Inputs and string fields are capped before legacy storage is called.
- Status omits arbitrary stored context and returns a bounded projection.
- Artifact listing returns at most 64 metadata records and never returns inline file content.
- Responses use the `bounded-ax-v1` contract and include the replacement and removal window.
- Failures use stable AX error codes and do not expose filesystem paths or stored content.

The compatibility adapter depends only on the frozen integration-record manager. It is not given a
`CoordinationStore` and therefore cannot become an ADR-010 lifecycle authority.
