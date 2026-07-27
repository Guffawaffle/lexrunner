# Independent Merge Review Gate

The independent review gate sits between deterministic validation and merge. Its purpose is to
find correctness, security, contract, and integration problems that command gates do not encode.

This is the current procedural contract. First-class plan-schema, status, and merge enforcement
remain tracked in [#857](https://github.com/Guffawaffle/lexrunner/issues/857). The earlier
[`pr-review` procedure proposal](https://github.com/Guffawaffle/lexrunner/issues/435) described
how to review one PR; this contract additionally makes review part of merge eligibility and binds
the verdict to an exact replayed candidate.

## Policy

- Review is **mandatory by default** for every merge candidate.
- The reviewer must be independent of the implementation attempt. A separate agent context is
  sufficient for agent-led workflows; repository policy may require a separate identity.
- Review is read-only. The reviewer does not edit, push, approve, or merge the candidate.
- A verdict binds to one exact `candidateHead` and `baseHead`.
- Any code, test, documentation, generated-artifact, or base replay change invalidates the
  verdict.
- `PASS` makes the review gate eligible. `BLOCK` prevents merge.
- A bypass is possible only through the explicit override protocol below. Bypass is never a pass.

## Manual Gate Sequence

Use this sequence for each node in dependency order:

1. **Freeze the base.** Fetch the current target branch and record its exact commit.
2. **Replay the candidate.** Rebase or rebuild the candidate on that base. Preserve required
   signing and verify the resulting signature.
3. **Run deterministic gates.** Execute the candidate's required tests, lint, type, build, policy,
   security, and CI gates.
4. **Freeze the candidate.** Record the exact replayed head after all fixes.
5. **Assign an independent reviewer.** Give the reviewer the task packet below. Warn the reviewer
   that the default outcome is blocking until an explicit verdict is returned.
6. **Review read-only.** Inspect the exact diff and relevant surrounding contracts. Run targeted
   read-only tests when useful.
7. **Return one verdict.**
   - `PASS`: no actionable blocking findings; state tested evidence and residual risks.
   - `BLOCK`: list actionable findings by severity with exact file/line evidence.
   - A reviewer may return `BLOCK` as soon as one merge-blocking finding is confirmed. Do not
     hold the merge train for exhaustive secondary research; inspect the complete replacement
     diff during its required fresh review.
8. **Record the receipt.** Post or retain an auditable receipt linked to the candidate.
9. **If blocked, fix and restart.** Replay as needed, rerun affected deterministic gates, freeze
   the replacement head, and obtain a new independent review. Never carry a verdict forward.
10. **Merge only when eligible.** Required command/CI gates and the review gate must be satisfied,
    unless an authorized bypass receipt explicitly replaces review eligibility.

## Reviewer Task Packet

At minimum, provide:

```yaml
repository: owner/repository
change: pull-request-or-node-id
candidateHead: exact-commit-sha
baseHead: exact-commit-sha
mode: read-only
scope:
  - behavior and contracts changed by this candidate
  - security and data-boundary risks
  - interactions with already-merged dependencies
environmentConstraints:
  - live checkouts, runners, services, devices, or paths that review must not touch
  - temporary or read-only validation surfaces that are safe to use
requiredOutput:
  verdict: PASS | BLOCK
  findings: severity + file:line + actionable explanation
  evidence: inspections and targeted checks performed
  residualRisks: risks that remain after PASS
prohibited:
  - editing files
  - pushing commits
  - approving or merging the change
```

The scope should be specific enough to focus the review but must not prohibit the reviewer from
reporting an adjacent issue caused by the candidate.

Environment constraints are authoritative. A green test is not valid evidence if obtaining it
mutates a live checkout or another actor's in-progress work. When a real acceptance environment
is unavailable, use temporary/read-only evidence and retain the deferred acceptance condition
explicitly.

## Review Receipt

Record enough information to reproduce the decision:

```yaml
reviewGateVersion: review-gate-v0
change: owner/repository#123
candidateHead: 0123456789abcdef
baseHead: fedcba9876543210
reviewer:
  kind: agent | human
  identity: stable-run-or-account-reference
  independentFromImplementation: true
verdict: PASS | BLOCK | review_bypassed
findings:
  - severity: high | medium | low
    location: path/to/file.ts:42
    summary: concise actionable finding
evidence:
  - exact diff inspected
  - targeted tests 12/12 passed
residualRisks:
  - bounded risk accepted by merge authority
recordedAt: RFC-3339 timestamp
```

Do not include secrets, unbounded logs, source bodies, or hidden chain-of-thought. Findings and
evidence should be concise, inspectable conclusions.

## Explicit Review Bypass

An opt-out is an exception path, not normal success. It is valid only when all of the following
are present:

1. An authority allowed by repository policy explicitly requests the bypass.
2. The exact candidate/base pair is recorded.
3. A non-empty reason and risk acknowledgement are recorded.
4. Every acting implementation, review, and merge agent receives a visible warning before merge.
5. Required deterministic and security gates remain green; bypass does not waive unrelated gates.
6. The receipt verdict is `review_bypassed`, never `PASS`.
7. The PR/run status and final report retain the bypass marker after merge.

Recommended warning:

> WARNING: Independent review is mandatory by default. Authorized override `<authority>` has
> bypassed review for candidate `<head>` on base `<base>` because `<reason>`. Treat status as
> `review_bypassed`, not reviewed or passed.

If authority, reason, candidate identity, or warnings are missing, the candidate remains blocked.

## Dogfood Lesson

During the Windows/STFC continuity merge train, deterministic tests and hosted security checks
were green for a native policy-generator candidate. The independent review still found that a
documented repository-relative source directory accepted absolute, traversal, and symlink escapes.
The candidate was blocked, fixed, re-signed, replayed, retested, and independently re-reviewed
before merge.

That loop is the intended behavior:

```text
replay → deterministic gates → independent review
                              ├─ PASS  → merge
                              └─ BLOCK → fix → replay → gates → fresh review
```

Review is therefore distinct from lint, tests, security scanning, and branch protection. Those
remain necessary; none substitutes for a scoped independent judgment on the exact merge candidate.
