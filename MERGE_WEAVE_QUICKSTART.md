# Your first merge-weave plan

Turn open GitHub PRs into a frozen plan you can inspect before executing anything.
The first useful result is a validated dependency order and a gate preview. There
is no fixed five-minute promise: repository access and dependency setup vary.

## 1. Install and discover

Use an existing local Git checkout with a GitHub remote, Node.js 24+ and Git.
Run these commands from that repository's root:

```bash
npm install --save-dev @smartergpt/lexrunner@2.1.0
npx lexrunner --version
npx lexrunner weave discover --json
```

The install updates `package.json`, the lockfile and `node_modules`. Use your
repository's package-manager policy if it does not use npm. No separate Lex, AXF,
LexSona or MCP install is needed. The CLI does not require the optional protected
policy-host service for this ordinary workflow.

Discovery reads GitHub and prints PR metadata. For private repositories, provide
an authorized `GITHUB_TOKEN` to this process through your credential manager or
shell environment. Signing into `gh` alone does not export it to LexRunner. Never
put a token in a tracked file or command example. Public unauthenticated discovery
may work within GitHub's API limits. A permissions or rate-limit failure is a
setup issue, not an empty PR list.

If repository detection fails, supply `--owner OWNER --repo REPOSITORY` to discovery
and planning. Both commands currently use GitHub; another forge is not supported
by this walkthrough. If there are no suitable PRs, stop here or use a repository
with real integration-order work. Do not create artificial PRs just to adopt it.

## 2. Freeze a plan

Choose an unused output filename so an earlier plan is not overwritten:

```bash
npx lexrunner weave plan --from-github --output plan.json --json
```

This reads GitHub again and **writes `plan.json` locally**. The JSON printed to
stdout is a summary, not the plan; use `--output`, not shell redirection, to save
it. Discovery and planning are separate observations of changing PRs.

Open the saved file. Confirm the repository, target branch, selected PRs and
recorded heads, declared dependencies and gate definitions. Planning includes
drafts by default. Use `--labels LABEL`, `--exclude-prs NUMBER`, or `--target BRANCH`
when needed, then inspect the replacement plan. `discover --suggest` produces
heuristic suggestions; inspect dependencies rather than treating suggestions as
accepted requirements.

The generated required gates are `lint`, `typecheck` and `test`. Review their actual
commands and make them match executable checks in this repository before running
anything. Generated defaults do not prove that those scripts exist or are adequate.
After edits, repeat validation and review; prior evidence belongs to the old plan.

## 3. Inspect and preview

```bash
npx lexrunner schema validate plan.json --json
npx lexrunner weave merge-order plan.json --json
npx lexrunner gate run plan.json --dry-run --json
```

Validation must succeed; the order must reflect the dependencies you intended.
A cycle or missing dependency must be resolved before continuing. The final command
previews the gate execution order without running gate commands. Preview paths may
write local diagnostic artifacts; use an appropriate writable workspace.

**This is the first-use stopping point:** retain the inspected plan and preview
with your work artifacts. Nothing in this walkthrough so far merges PRs, and a
successful preview is not a passed test, independent review or merge authorization.

## 4. Run the reviewed gates

When the commands and their effects are authorized, run them in the intended
checkout with its dependencies and required tools installed:

```bash
npx lexrunner gate run plan.json --artifact-dir artifacts/first-use --json
```

This executes the plan's commands and writes results. Read failures and artifact
references; never substitute an empty or always-successful command to get green
status. These local results describe the checkout tested; they do not prove that
every proposed merged candidate passed. Repository CI and candidate review remain
required. See [gate and review policy](docs/review-gate.md).

## 5. Review and integrate

Before applying merges, verify the frozen plan, exact current PR heads and base,
repository protections, required checks and the independent review for each exact
candidate. If they changed, regenerate or revise the plan and repeat the affected
checks and review. Authorization must cover the selected repository and merges.

Only after those conditions are met:

```bash
npx lexrunner weave apply --plan plan.json --execute --json
```

This is the explicit mutation boundary. It runs gates and invokes the merge
application service. Inspect its result and verify the resulting remote state;
command success alone does not expand the scope of your review. Without `--execute`,
`weave apply` runs gates but does not apply merges. Do not use `--skip-gates` to
bypass missing evidence.

## Next choices

- [CLI/MCP setup and component compatibility](docs/first-use-compatibility.md)
- [Independent review contract](docs/review-gate.md)
- [Assisted and headless limits](docs/architecture/headless-supervisor.md), if you
  are moving beyond integration planning into agent execution
- [SmarterGPT starting guide](https://smartergpt.dev/docs/how-to-use/), if your need
  is memory or repeatable workspace capabilities rather than PR integration
