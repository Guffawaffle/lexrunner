# LexRunner (`lex-pr`)

LexRunner turns a changing set of pull requests into a reviewable integration program: discover
the work, freeze a dependency plan, run bounded gates, preserve evidence, and merge only with
explicit authority.

It is useful when a repository has concurrent PRs, dependencies between changes, repeated local
and CI checks, or agent-assisted implementation that needs a durable handoff. It is usually not a
fit for a repository with one occasional PR and no integration-order problem.

> **Ask your agent:** “Read [`docs/agent-evaluation.md`](docs/agent-evaluation.md), evaluate this
> repository without installing or changing anything, and return `adopt`, `pilot`, `defer`, or
> `not a fit` with the smallest reversible trial.”

That evaluation is deliberately read-only. Installing the package, writing a plan, creating a
branch, pushing, opening a PR, or merging requires separate approval.

## What works today

LexRunner’s supported workflow has grown in layers. A normal user can stop at any layer.

| Layer               | Current capability                                                                                           | First surface                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Deterministic plan  | Freeze PRs and declared dependencies into schema-versioned `plan.json`                                       | `lex-pr weave plan`                 |
| Merge-weave         | Compute merge order, preview integration, run gates, and apply authorized merges                             | `lex-pr weave *`, `lex-pr gate run` |
| Run and evidence    | Persist bounded receipts, independent verification, acceptance, and artifacts                                | `lex-pr attempt *`                  |
| Fanout              | Harvest and analyze issue/PR evidence for parallel work planning                                             | `lex-pr fanout *`                   |
| Assisted agent work | Prepare an immutable packet and workspace envelope, attach a foreground-owned worker, then verify its claims | CLI/MCP Attempt lifecycle           |

The ADR-010 coordination model is accepted and its assisted Attempt lifecycle is implemented.
LexRunner also has a tested headless reconciliation **application boundary**, but it is not a
general production supervisor: there is no approved public headless launch surface, native
host/reboot recovery remains release evidence, and Stage 5 fault-injection and authority expansion
remain unproven. See [ADR-010](docs/adr/ADR-010-agent-work-orchestration-protocol.md) and the
[headless proof boundary](docs/architecture/headless-supervisor.md).

## Smallest useful trial

First inspect without mutation:

```bash
lex-pr --version
lex-pr workspace doctor --json
lex-pr weave discover --json
```

After approving a local, reversible artifact, freeze and inspect a plan:

```bash
lex-pr weave plan --from-github --output plan.json --json
lex-pr schema validate plan.json --json
lex-pr weave merge-order plan.json --json
lex-pr gate run plan.json --dry-run --json
```

These commands do not merge. `lex-pr weave apply --execute` is a separate mutation and should be
run only after reviewing the frozen plan, authority, gates, and target branch.

For a guided merge-weave walkthrough, use
[MERGE_WEAVE_QUICKSTART.md](MERGE_WEAVE_QUICKSTART.md).

## Architecture boundary

LexRunner has two contracts that must not be blurred:

- **Stateless integration core:** plan, gate, status, and weave services consume frozen inputs.
  At integration time, `plan.json` is the sole authority for dependency order and merge intent.
  The integration core never reads coordination state or `.smartergpt/` as hidden truth.
- **Explicitly stateful coordination service:** ADR-010 WorkItems, Runs, Attempts, controller
  leases, workspace leases, receipts, and verification live behind `CoordinationStore` and
  workspace lifecycle adapters. That state coordinates implementation work; it does not authorize
  the integration core or silently alter a frozen plan.

`.smartergpt/` is a portable example profile, not a runtime dependency. User/work artifacts belong
in explicit stores, ignored local deliverables, CI artifacts, or PR comments—not in the package
source tree. Canonical terms live in [`docs/TERMS.md`](docs/TERMS.md).

## Authority and safety

- Discovery, status, planning, schema validation, merge-order calculation, and dry runs are
  non-merging operations.
- Gate commands execute the commands declared by the reviewed plan; inspect them before running.
- Git/GitHub writes, delivery, release, and merge are separate authority lanes.
- Worker receipts are claims. LexRunner-owned verification and acceptance are the evidence used by
  the coordinator.
- Assisted and headless control share durable nouns and fencing rules; neither mode gains implicit
  merge, credential, release, or external-service authority.

## Install and authenticate

Ecosystem 3.1 requires Node.js 24 or newer. The package is restricted under the SmarterGPT npm
organization, so a human with organization access must authenticate the npm CLI once:

```bash
npm login --scope=@smartergpt --registry=https://registry.npmjs.org/
npm install --save-dev @smartergpt/lexrunner
npx lex-pr --version
```

Global installation is also supported:

```bash
npm install --global @smartergpt/lexrunner
lex-pr --version
```

Do not place npm tokens in the repository or a chat transcript. Windows/private-package validation
is documented in the [Node 24 migration guide](docs/node-24-migration.md).

The checked-in package version is the single source for `lex-pr --version`.

<!-- BEGIN GENERATED PACKAGE VERSION -->

Current repository package version: **1.2.1**. npm availability and dist-tags are separate
release evidence; inspect the registry rather than inferring publication from source metadata.
<!-- END GENERATED PACKAGE VERSION -->

See the [1.2.1 publication repair](docs/releases/1.2.1.md) and underlying
[1.2.0 compatibility decision](docs/releases/1.2.0.md) for the package disposition, semver
rationale, supported assisted behavior, and deferred headless guarantees.

## Choose a surface

- **Human CLI:** start with `workspace doctor`, `weave discover`, `weave plan`,
  `weave merge-order`, and `gate run`.
- **Agent/MCP:** use the matching canonical tools and bounded contracts in
  [`docs/AX.md`](docs/AX.md) and [`README.mcp.md`](README.mcp.md).
- **Assisted agent work:** run `attempt preflight` before packet construction. When it reports
  `broker_required`, use `attempt projection status|prepare` to bind the exact committed base into
  native WSL, then continue with `attempt prepare`, `attempt start`, worker
  attachment/heartbeat, receipt submission, verification, and acceptance. The foreground host
  still owns worker launch. Follow the
  [native Windows-to-WSL projection workflow](docs/workflows/native-wsl-projection.md) for recovery
  and cleanup.
- **Advanced operators:** read the
  [orchestration primitives](docs/architecture/orchestration-primitives.md),
  [headless supervisor boundary](docs/architecture/headless-supervisor.md), and
  [security guidance](docs/security/agent-worktree-containment.md).

The normative CLI/MCP inventory is generated from live registrations and stored in
[`docs/architecture/cli-mcp-surface.json`](docs/architecture/cli-mcp-surface.json). Deprecated
top-level aliases remain migration aids, not recommended entry points.

## Reading order

1. [Agent fit evaluation](docs/agent-evaluation.md) — decide whether to adopt, pilot, defer, or
   decline.
2. [Merge-weave quickstart](MERGE_WEAVE_QUICKSTART.md) — run the smallest integration workflow.
3. [Canonical CLI/MCP surface](docs/architecture/canonical-cli-mcp-surface.md) — choose stable
   commands and tools.
4. [AX contract](docs/AX.md) — understand bounded output, errors, parity, and exceptions.
5. [ADR-010](docs/adr/ADR-010-agent-work-orchestration-protocol.md) — understand assisted agent-work
   ownership and maturity.
6. [Documentation index](docs/README.md) — browse operator, fanout, MCP, audit, security, and
   contributor material.

Historical v2 design drafts are retained for provenance only. They do not describe a sibling
package, active migration, or current runtime contract.

## Development

```bash
nvm use
npm ci
npm run lint
npm run build
```

For implementation work, use the touched/adjacent gate selector and let CI prove the full suite on
high-risk changes:

```bash
lex-pr gate select --base <base-sha> --head <head-sha> --json
```

Release validation remains exhaustive. See [`AGENTS.md`](AGENTS.md),
[`CONTRIBUTING.md`](CONTRIBUTING.md), and the
[implementation gate contract](docs/architecture/implementation-gates.md).

## Package and licensing

- Package: `@smartergpt/lexrunner`
- CLI: `lex-pr`
- MCP bin: `lexrunner-mcp`
- Runtime dependency: `@smartergpt/lex` (MIT)
- LexRunner license: SmarterGPT Source-Available Personal Use License

See [`LICENSE.md`](LICENSE.md), [`NOTICE.md`](NOTICE.md), and
[ADR-008](docs/adr/ADR-008-lex-packaging.md).
