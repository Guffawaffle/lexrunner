# Selected-work materialization

The shared conversion boundary in `src/runs/selected-work-materialization.ts`
constructs one WorkItem and existing AgentTaskPacket from an explicitly selected,
dependency-free Execution Plan 1.0.0 item. It is exposed through `attempt materialize` and MCP `materialize_attempt_input`.
The pure conversion performs no I/O, preparation or dispatch. CLI input reads are
explicit; saving stdout is a separate caller-selected write.

The caller supplies exact UTF-8 source text and its expected SHA-256 digest, selected
item ID, stable work/criterion IDs, repository/base identity and explicit packet
policy. Requests and artifacts are bounded to 256 KiB. Unknown versions, ambiguous
selection, dependent work, repository mismatch, invalid criteria and nonportable
packet content fail with bounded diagnostics. No requirements are invented.

Source descriptions, technical context and constraints are explicitly composed into
existing packet instructions. Scope, authority, verification and budget stay exactly
as supplied. These prose requirements do not become enforced runtime policy. Old
packet formats, hashing and callers remain unchanged; old source specs may omit the
optional context. The entire source byte digest remains distinct from the resulting
semantic packet hash, including when only source whitespace changes.

The returned correspondence binds source bytes, selected item, normalized WorkItem,
criterion mapping, run/attempt IDs and the actual constructed packet hash. Outcome
and work-plan references are explicitly supplied and unverified. Caller-supplied
digests establish consistency, not acceptance, freshness or trusted provisioning.

A later preparation adapter must compare the real returned packet hash and attempt
identities with this correspondence before claiming preparation binding. Actual worker
observation, receipts and verification remain separate. Nonempty dependencies are
unsupported in this first slice; the converter never declares them satisfied.

Validation uses actual project and packet schemas, including existing agent-work
schema fixtures. It establishes construction behavior, not live issue creation,
worker execution or outcome fulfillment. Publication and public-surface adoption
remain separate delivery steps.

## Materialize, then prepare explicitly

This surface is available in the published 2.3.0 release. Install
`@smartergpt/lexrunner@2.3.0` before following these commands.
Existing 2.2.0 installations do not expose this operation.

```sh
lexrunner attempt materialize --input examples/selected-work-input.json --json
```

[The complete example](../examples/selected-work-input.json) uses illustrative identities
and source bytes. It demonstrates materialization only; replace them with the selected
real artifact, expected digest, identities and explicit policy before preparation.

The input is the complete `SelectedWorkInputJsonSchema` advertised by MCP: inline
project artifact text and its digest, supplied outcome/work-plan references, selected
item and stable criterion IDs, repository/base, capture time and explicit packet
policy. A successful result contains `preparationInput`, `correspondence`, and the
remaining required field names. It contains no controller credentials or guessed host.

Retain the correspondence, review the returned requirements/policy and construct a
full preparation request by adding your explicitly authorized `runtime`, `envelope`
and `attempt` lifecycle inputs to `preparationInput`. Keep `expectedPacketHash`.
Then, only with authority for preparation's workspace/database effects:

```sh
lexrunner attempt prepare --input reviewed-preparation.json --json
```

Preparation checks `expectedPacketHash` before opening its runtime/store and compares
the actual returned packet as well. Changing instructions, criteria, identity or
policy requires a new materialization and review; do not remove the expected hash to
bypass a mismatch. A post-preparation mismatch reports affected attempt references
and requires inspection because effects may already exist. No automatic retry occurs.

The new expected hash is optional for legacy request compatibility, not optional for
this bound handoff. Older strict request parsers reject the new field; upgrade rather
than stripping it. Materialization works with MCP mutations disabled. `prepare_attempt`
retains its existing ALLOW_MUTATIONS gate; enabling that gate is a separate authority
decision. A successful preparation binds packet/envelope resources, not worker launch.
