# Ecosystem provisioning and dogfood harness

The ecosystem dogfood harness validates a staged LexRunner package against exact published
versions of Lex, Lex-MCP, AXF, and LexSona without modifying any source checkout. It exists to turn
release preparation, failure recovery, and cleanup into repeatable evidence rather than operator
memory.

## Packet-owned preparation

`AgentTaskPacket_v1.preparation` is an optional portable execution DAG. Each provisioning or build
step declares its argument vector, repository-relative working directory, dependencies, and
accepted exit codes. Verification steps can depend on preparation or other verification IDs, so a
consumer that requires `install -> build -> test` records that order in the immutable packet.

The preparation policy explicitly declares:

- whether network access is forbidden or limited to named package registries;
- whether the machine-local cache is disabled, read-only, or read-write; and
- whether package lifecycle scripts are allowed.

The execution adapter must return the exact policy hash with every result. A missing or mismatched
policy attestation fails closed. `AgentWorkPreparationReceipt_v1` retains canonical hashes of
stdout and stderr, not their potentially secret-bearing contents. Dependent steps become blocked
after a failure.

## Real ecosystem run

The default baseline is Lex 3.0.1, Lex-MCP 3.0.1, AXF 2.0.0, and LexSona 1.0.0. LexRunner is built,
packed, and installed from the current checkout's staged tarball. The clean consumer then exercises
package imports, each user-facing CLI, the new preparation and fan-in exports, and Lex-MCP's stdio
`tools/list` surface.

```bash
npm run dogfood:ecosystem -- run \
  --receipt-out /tmp/lexrunner-ecosystem-receipt.json
```

Package versions are exact CLI inputs (`--lex`, `--lex-mcp`, `--axf`, and `--lexsona`). The npm
registry and cache policy are packet data; they are not inferred from an adjacent checkout. The
native cache directory lives below the disposable allocation root.

Default output is one compact status object. `--diagnostics` adds bounded step hashes and resolved
versions. Neither mode includes command output, dependency trees, transcripts, credentials, or
source-checkout paths.

## Interruption, inspection, and cleanup

Use `--retain` to preserve a completed allocation or `--fault-after stage|prepare` to exercise an
interrupted run. Inspection is explicit:

```bash
npm run dogfood:ecosystem -- inspect \
  --allocation-root /tmp/lexrunner-ecosystem-dogfood \
  --run-root /tmp/lexrunner-ecosystem-dogfood/run-EXAMPLE

npm run dogfood:ecosystem -- inspect --diagnostics \
  --allocation-root /tmp/lexrunner-ecosystem-dogfood \
  --run-root /tmp/lexrunner-ecosystem-dogfood/run-EXAMPLE
```

Reaping is an explicit, idempotent operation:

```bash
npm run dogfood:ecosystem -- reap \
  --allocation-root /tmp/lexrunner-ecosystem-dogfood \
  --run-root /tmp/lexrunner-ecosystem-dogfood/run-EXAMPLE
```

The reaper accepts only a real, direct child directory with a matching ownership marker and
allocation-root hash. It rejects parent paths, nested paths, symlink roots, forged markers, and any
target outside the allocation root. Repeating a successful reap reports `absent` without error.

## Parallel isolation proof

`npm run test:isolation` executes the full default Vitest suite twice. Each run receives its own
temporary root and process group. The proof fails if either suite fails, a descendant process
survives its runner, or the isolated temporary root retains state. The wrapper explicitly reaps
TSX's per-user compiler-cache directory inside the root before measuring residue; arbitrary cache
or test entries still fail the proof. The command emits only a compact machine-readable summary.
