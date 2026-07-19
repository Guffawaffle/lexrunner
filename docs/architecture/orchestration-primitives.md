# Orchestration Primitives: Adopt, Adapt, Defer, Reject

> **Status:** Ecosystem 3.1 decision record
>
> **Research date:** 2026-07-19
>
> **Scope:** Conceptual interpolation from current primary sources; no source-code import or
> compatibility promise

## Decision rule

LexRunner does not optimize for the largest possible agent fleet. It optimizes for
[cumulative intelligence](../PRINCIPLES.md): successful executions advance the work, failed
executions improve the next attempt, and both claims require inspectable evidence.

This review asks whether a primitive strengthens durable work identity, least authority,
runtime neutrality, independent verification, bounded context, recovery, or delivery safety.
Product polish and raw concurrency are not sufficient reasons to adopt a concept.

The decision words mean:

- **Adopt:** the concept fits LexRunner's current invariants without changing its ownership model.
- **Adapt:** retain the problem-solving idea but change its trust, state, evidence, or authority
  assumptions.
- **Defer:** valuable, but its prerequisite contracts are not yet proven.
- **Reject:** conflicts with a Lex ecosystem invariant; retain the rationale so it is not repeatedly
  rediscovered.

## Primary-source baseline

The sources below are product documentation and specifications, not implementation dependencies:

- Cursor: [Cursor 3 changelog](https://cursor.com/changelog/3-0),
  [Background Agents](https://docs.cursor.com/background-agent), and
  [Background Agents API](https://docs.cursor.com/background-agent/api/overview)
- OpenClaw: [Sub-agents](https://docs.openclaw.ai/tools/subagents) and
  [Multi-agent routing](https://docs.openclaw.ai/concepts/multi-agent)
- Anthropic: [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams)
- OpenAI: [Codex app](https://openai.com/index/introducing-the-codex-app/) and
  [Symphony service specification](https://github.com/openai/symphony/blob/main/SPEC.md)
- GitHub: [Copilot cloud-agent workflow](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/overview),
  [cloud-agent risks and mitigations](https://docs.github.com/en/enterprise-cloud@latest/copilot/concepts/agents/cloud-agent/risks-and-mitigations),
  [firewall controls](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-the-firewall),
  and [Copilot SDK custom agents](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/custom-agents)

These pages are mutable. This record describes the documented behavior observed on the research
date and links the source rather than copying product code or protocol schemas.

## System and assumption review

Each system is evaluated on the same dimensions required by
[Ecosystem 3.1 #803](https://github.com/Guffawaffle/lexrunner/issues/803).

### Cursor

- **Durable work identity and restart:** editor agents use separate chats/worktrees; remote
  background agents expose status and follow-up prompts. The hosted service retains enough remote
  state for asynchronous handoff, but that state is Cursor-owned rather than a portable LexRunner
  run contract.
- **Authority and sandbox:** background agents run in isolated remote Ubuntu machines, automatically
  execute terminal commands, have internet access, and receive GitHub read/write access for selected
  repositories. Cursor documents the resulting prompt-injection and exfiltration risk.
- **Worker/runtime neutrality:** local, worktree, cloud, and remote-SSH surfaces are unified in the
  product UI; the background API itself is Cursor-hosted and Cursor-specific.
- **Fan-out, judging, and fan-in:** `/best-of-n` runs the same task across models in isolated
  worktrees and compares results. The public description does not establish LexRunner-style durable
  evidence for losing attempts or an engine-verification contract.
- **Retry, reconciliation, cancellation:** status, follow-up, takeover, long-running-job monitoring,
  and an `Await` tool are documented. A portable crash-reconciliation state machine is not.
- **Task graph and communication:** multiple agent tabs provide operator parallelism; the reviewed
  sources do not define a dependency/claim graph shared between workers.
- **Evidence, verification, delivery:** users review diffs and merge or take over. Background agents
  push a separate branch. Comparison and review are product workflows, not independent signed
  verification receipts.
- **Context and default output:** each chat retains its own context; shared chats can include plans
  and transcripts. LexRunner should not equate that conversation continuity with durable work state.
- **Operator cost and topology:** local and hosted modes are convenient, but remote agents require
  hosted compute, token-priced API use, repository grants, and retained remote code/environment
  state. The API documents high active-agent limits; limits are capacity, not evidence of value.

### OpenClaw

- **Durable work identity and restart:** agents have separate workspaces, state directories,
  SQLite-backed session stores, and stable session keys. Auto-archive is best-effort and pending
  timers are lost on gateway restart, so session durability is not equivalent to a durable
  orchestration transaction.
- **Authority and sandbox:** per-agent tool allow/deny lists and sandbox settings can attenuate
  access; nested leaf workers lose session-control tools. A sandboxed requester cannot spawn an
  unsandboxed target. However, the documented additive fallback to main-agent authentication
  profiles conflicts with LexRunner's explicit authority intersection.
- **Worker/runtime neutrality:** discovery metadata distinguishes configured OpenClaw, Codex
  app-server, and other native runtimes. This is strong precedent for explicit adapter capabilities,
  but LexRunner must bind them to an immutable Attempt rather than session configuration alone.
- **Fan-out, judging, and fan-in:** bounded child counts and a maximum nesting depth prevent runaway
  fan-out. Results flow up an announce chain for parent synthesis; no independent engine judge or
  losing-attempt evidence set is guaranteed.
- **Retry, reconciliation, cancellation:** completion delivery is push-based with stable idempotency,
  routing fallback, and bounded retry. Cascade stop is explicit. Best-effort archival and lost
  restart timers are insufficient for LexRunner recovery truth.
- **Task graph and communication:** parent/child relationships and depth-scoped tools form a bounded
  delegation tree. The reviewed surfaces are session-oriented rather than a durable dependency DAG.
- **Evidence, verification, delivery:** runtime status is derived from terminal outcome instead of
  model text, which is a useful evidence distinction. Child text remains a report for parent
  synthesis, not independently verified truth.
- **Context and default output:** child history is redacted, block-truncated, and byte-capped; raw
  transcripts remain an operator fallback. This strongly supports bounded diagnostic retrieval, but
  Lex should preserve decisions and evidence rather than make transcripts canonical work memory.
- **Operator cost and topology:** one gateway can route multiple isolated agents/personas and each
  child has its own token context. Model selection can reduce cost. Shared-gateway convenience does
  not make auth/profile state safe to inherit across Lex tenants or workspaces.

### Claude Code agent teams

- **Durable work identity and restart:** local task lists persist, but in-process teammates do not
  resume with the lead; the documentation calls out stale task status, shutdown, and orphaned tmux
  limitations. It is an experimental coordination surface, not restart-safe orchestration truth.
- **Authority and sandbox:** teammates begin with the lead's permission mode and permission requests
  bubble to the lead. Per-role tool allowlists exist, but some coordination tools are always present
  and per-teammate permission modes cannot be set at spawn.
- **Worker/runtime neutrality:** the team is composed of Claude Code sessions. Reusable role
  definitions are valuable precedent, but the runtime and model semantics remain Claude-specific.
- **Fan-out, judging, and fan-in:** separate context windows support parallel review and competing
  hypotheses. The lead synthesizes results. The docs explicitly warn about linear token cost,
  coordination overhead, diminishing returns, and file conflicts.
- **Retry, reconciliation, cancellation:** teammates can be redirected or replaced and shutdown is
  requested through the lead. Known resume, error recovery, slow shutdown, and orphan-process gaps
  are exactly the cases LexRunner's supervisor must make durable.
- **Task graph and communication:** a shared dependency-aware task list, file-locked claiming, and
  validated per-agent mailboxes provide useful coordination primitives. Task completion remains
  worker-maintained and can lag reality.
- **Evidence, verification, delivery:** completion hooks can refuse idle/task-complete transitions,
  but a teammate's claim still needs engine-owned verification before delivery.
- **Context and default output:** teammates get project context but not the lead transcript; spawn
  prompts must carry task-specific context. This supports immutable bounded packets. Direct peer
  messages are useful but can create hidden coordination state unless preserved as evidence.
- **Operator cost and topology:** interactive monitoring and steering are expected. The official
  guidance recommends small teams and independent tasks, reinforcing evidence-driven fan-out rather
  than maximum concurrency.

### Codex app

- **Durable work identity and restart:** agents run in project-organized threads and share session
  history/configuration with Codex CLI and IDE surfaces. That is useful operator continuity, but
  LexRunner still needs its own Run/Attempt/work identity rather than a UI thread as authority.
- **Authority and sandbox:** the product emphasizes secure defaults and configurable operation. The
  reviewed announcement is not a versioned capability-negotiation or lease protocol.
- **Worker/runtime neutrality:** the app coordinates Codex across app, CLI, IDE, and cloud. It is
  deliberately Codex-centric; LexRunner should integrate through a versioned worker adapter.
- **Fan-out, judging, and fan-in:** multiple agents can run in parallel and isolated worktrees avoid
  local Git collisions. The announcement does not define an engine-owned best-of-N judge.
- **Retry, reconciliation, cancellation:** long-running supervision and review queues are visible
  product concerns. The announcement does not specify crash/reboot reconciliation semantics.
- **Task graph and communication:** project/thread organization and skills help route work, but no
  frozen dependency graph is defined in the reviewed source.
- **Evidence, verification, delivery:** diffs are reviewable and scheduled Automations land in a
  review queue. That human handoff is useful; LexRunner additionally requires receipts and
  independent verification.
- **Context and default output:** separate threads prevent unrelated context mixing. Repository
  skills are reusable, but eagerly or broadly supplied instructions must still fit bounded packet
  budgets.
- **Operator cost and topology:** the app is an operator command center spanning local and cloud
  execution. LexRunner should learn from the supervision UX without becoming an IDE or hosted model
  fleet.

### OpenAI Symphony

- **Durable work identity and restart:** issues receive collision-resistant workspace keys and Run
  Attempts, but authoritative scheduler state is in memory. Retry timers and running sessions are
  not restored after process restart; recovery re-polls and redispatches eligible work.
- **Authority and sandbox:** the draft spec explicitly leaves approval/sandbox posture
  implementation-defined and requires it to be documented. Workspace isolation is treated as a
  baseline, not a complete sandbox. Provider tools can avoid exposing raw tracker credentials.
- **Worker/runtime neutrality:** the service specification is language-neutral, but the current
  agent-runner contract targets a versioned Codex app-server protocol. It correctly says the actual
  app-server schema, not the Symphony document, controls transport.
- **Fan-out, judging, and fan-in:** global and per-state concurrency are bounded. Symphony dispatches
  independent issues; it does not define best-of-N judging or preservation of unselected attempts.
- **Retry, reconciliation, cancellation:** poll ticks reconcile tracker state, detect stalls,
  terminate workers, and schedule capped exponential backoff. Clean exits also schedule a quick
  continuation. The retry records error/time but not a meaningful changed premise.
- **Task graph and communication:** tracker adapters determine eligibility and normalized issue
  snapshots. Generic scheduling intentionally avoids inferring provider-specific blockers. There is
  no peer-worker communication contract.
- **Evidence, verification, delivery:** structured runtime events, session IDs, token counts, and
  logs provide observability. Provider-native tools may update tickets/PRs. Worker success is not the
  same as LexRunner engine verification.
- **Context and default output:** a versioned in-repository `WORKFLOW.md` supplies prompt and runtime
  policy. Continuation turns reuse a live thread rather than replay the original prompt. LexRunner
  should adapt this to immutable packets plus bounded deltas.
- **Operator cost and topology:** it is a long-running poller with explicit concurrency, rate-limit,
  token, and stall telemetry. Terminal workspace cleanup is automatic; LexRunner must add registered
  worktree identity and dirty-state proof before cleanup.

### GitHub Copilot cloud agent and SDK custom agents

- **Durable work identity and restart:** cloud sessions are tied to issue/PR work and stream logs;
  SDK sub-agents are session-scoped with lifecycle events. Neither replaces LexRunner's
  source-neutral immutable WorkItem and Attempt contracts.
- **Authority and sandbox:** cloud agents use ephemeral environments, constrained branch writes,
  default network firewalling, restricted triggers, and required human review. GitHub documents
  firewall limitations. SDK custom agents can have distinct tool sets/MCP servers and explicit or
  inferred selection.
- **Worker/runtime neutrality:** GitHub's delivery surface can host multiple coding-agent products,
  while the SDK runtime is Copilot-specific. LexRunner should retain a provider-neutral adapter and
  make unsupported authority dimensions fail closed.
- **Fan-out, judging, and fan-in:** GitHub exposes concurrent research/coding sessions and SDK
  sub-agent delegation in isolated contexts. The parent integrates results; no durable
  evidence-preserving best-of-N contract is promised.
- **Retry, reconciliation, cancellation:** sessions can be monitored, steered, and stopped; SDK
  lifecycle events distinguish start, completion, and failure. The reviewed sources do not define a
  durable restart supervisor.
- **Task graph and communication:** issue assignment and PR comments are clear intake/iteration
  paths. SDK delegation uses runtime intent matching rather than a frozen integration plan.
- **Evidence, verification, delivery:** cloud work produces a draft PR, security scans, signed
  agent commits, session/audit logs, branch protections, and human review. This is strong delivery
  evidence, but LexRunner must keep engine verification distinct from platform or worker claims.
- **Context and default output:** SDK agents can receive agent-specific tools and eagerly injected
  skills; sub-agents do not inherit parent skills by default. Explicit opt-in is good, while eager
  content must be budgeted to avoid context bloat.
- **Operator cost and topology:** GitHub provides hosted ephemeral compute and GitHub-native review.
  Firewall, setup-step, MCP, and external-process limitations mean the environment is constrained,
  not a universal security boundary.

## Primitive decisions

Every decision records the required eight fields: problem, source, source assumptions, fit,
disposition, owner, smallest proof, and implementation/licensing boundary.

### D1. Isolated workspace plus explicit execution identity — Adopt

1. **Problem:** parallel workers otherwise collide in files, indexes, branches, and cleanup.
2. **Source:** [Cursor 3][cursor-3] and [Codex app][codex-app] worktrees;
   [Symphony][symphony] per-issue workspaces; current LexRunner broker.
3. **Assumptions:** source products often identify work by a UI session or path and may rely on one
   Git/runtime environment.
4. **Fit:** isolation already matches ADR-010, but path text alone is not identity.
5. **Decision:** **Adopt** isolation; retain repository, worktree, branch, base SHA, host, and Git
   runtime evidence in the lease/envelope.
6. **Owner:** LexRunner #794, #767, and #799.
7. **Proof:** two attempts with colliding branch/file names cannot cross-observe or clean one
   another; Windows/WSL identity mismatch fails closed; an authorized launch with no durable
   envelope fails closed without reconstructing the missing evidence.
8. **Boundary:** conceptual behavior only. Do not copy product worktree managers; use LexRunner's
   broker and Git contracts.

### D2. Runtime-neutral worker adapter with capability negotiation — Adapt

1. **Problem:** a common `launch()` shape hides whether a runtime can resume, cancel, sandbox,
   stream evidence, or enforce requested authority.
2. **Source:** [OpenClaw runtime metadata][openclaw-subagents],
   [Copilot per-agent tool sets][copilot-sdk], and [Symphony's][symphony] versioned app-server
   boundary.
3. **Assumptions:** each source controls both configuration and runtime or targets one provider.
4. **Fit:** ADR-010 requires replaceable workers and effective-authority intersection.
5. **Decision:** **Adapt** into an explicit adapter descriptor and attempt-time negotiation. Unknown
   or unenforceable dimensions reject attachment. LexRunner's packet-bound argv broker records
   direct-operation decisions, but `brokered` is not synonymous with sandboxed or `enforced`.
6. **Owner:** LexRunner #804 on top of #794.
7. **Proof:** one capable fake adapter attaches; adapters missing cancellation, identity, or an
   authority control fail before worker launch.
8. **Boundary:** target the selected runtime's actual versioned protocol; never treat this research
   record as a wire schema.

### D3. Push-based lifecycle events with idempotent delivery — Adopt

1. **Problem:** polling wastes turns/context and can duplicate or lose completion handling.
2. **Source:** [OpenClaw completion handoff][openclaw-subagents],
   [Copilot SDK lifecycle events][copilot-sdk], and app-server events in [Symphony][symphony].
3. **Assumptions:** source session stores may be best-effort and parent sessions may still exist.
4. **Fit:** events complement, but do not replace, durable CoordinationStore reconciliation.
5. **Decision:** **Adopt** push delivery with stable event identity; reconcile durable state when an
   event is missing, duplicated, late, or arrives after controller loss.
6. **Owner:** LexRunner #804 and #801.
7. **Proof:** duplicate completion advances one revision; a dropped event is recovered after restart;
   a late event becomes evidence without re-running delivery.
8. **Boundary:** no dependency on an OpenClaw or Copilot event type; adapters map into LexRunner
   events.

### D4. Continuous reconciliation against external reality — Adapt

1. **Problem:** process state, tracker state, leases, and worktrees diverge across crashes and time.
2. **Source:** [Symphony poll/reconciliation loop][symphony] and LexRunner's existing workspace
   coordinator.
3. **Assumptions:** Symphony's scheduler/retry truth is in memory and can redispatch after restart.
4. **Fit:** LexRunner requires transactional durable state and idempotent side effects.
5. **Decision:** **Adapt** the recurring reconciliation pattern, but compare persisted Run/Attempt/
   lease/session state with process, worktree, tracker, and delivery observations before mutation.
6. **Owner:** LexRunner #801, #767, and #699.
7. **Proof:** fault injection at every lifecycle boundary yields resume, quarantine, escalation, or a
   new Attempt without repeating a completed side effect.
8. **Boundary:** do not copy automatic redispatch or path-based cleanup assumptions.

### D5. Retry/backoff requires a retry delta — Adapt and Reject blind replay

1. **Problem:** transient faults need bounded retry, but repetition can waste compute and recreate
   side effects without learning.
2. **Source:** [Symphony capped backoff][symphony], [OpenClaw announce retry][openclaw-subagents],
   and [Claude replacement workers][claude-teams].
3. **Assumptions:** source retry records primarily capture attempt count, time, and error.
4. **Fit:** LexRunner's cumulative-intelligence principle requires inherited evidence and a changed
   premise.
5. **Decision:** **Adapt** capped backoff for transport/infrastructure delivery. **Reject** new work
   Attempts that cannot name a retry delta or explicit policy exception.
6. **Owner:** LexRunner #801; evidence foundations #766 and #762.
7. **Proof:** transport redelivery is idempotent; work retry with changed environment succeeds and
   records the delta; unchanged replay is refused and escalated.
8. **Boundary:** formulas are conventional concepts, not imported code. Policy selects timing.

### D6. Evidence-preserving best-of-N and competing hypotheses — Adapt

1. **Problem:** uncertain design/debugging work can benefit from independent exploration without
   allowing one early hypothesis to anchor every attempt.
2. **Source:** [Cursor best-of-N][cursor-3] and
   [Claude parallel reviews/competing hypotheses][claude-teams].
3. **Assumptions:** a lead or product compares worker outputs; losing paths may remain only in chats.
4. **Fit:** fan-out is useful only when evidence, authority, cost, and fan-in are explicit.
5. **Decision:** **Adapt** into bounded fan-out with immutable packets and evidence sets that retain
   useful unsuccessful/unselected findings.
6. **Owner:** LexRunner #802 after #762 and #804.
7. **Proof:** two contradictory attempts produce separately bound receipts/evidence; the selected
   result cites engine evidence and the unselected result still narrows uncertainty.
8. **Boundary:** no model-ranking or product UI is copied. Model/provider selection stays
   adapter-neutral.

### D7. Judging and acceptance are engine-owned — Adapt

1. **Problem:** worker self-report, exit status, or persuasive prose cannot establish correctness.
2. **Source:** [Cursor comparison UX][cursor-3], [Claude completion hooks][claude-teams], and
   [GitHub security/review gates][copilot-security].
3. **Assumptions:** source products may combine worker, platform, and reviewer judgments.
4. **Fit:** ADR-010 already separates receipts (claims) from EngineVerification (evidence).
5. **Decision:** **Adapt** second-opinion and gate concepts into immutable engine verification and an
   explicit acceptance decision. Preserve trust gaps.
6. **Owner:** LexRunner #762 and #793.
7. **Proof:** a worker claims success while the engine gate fails; public status remains rejected and
   both claim and evidence stay inspectable.
8. **Boundary:** external CodeQL/review results may be evidence inputs, not the universal truth model.

### D8. Dependency-aware task claims — Adapt

1. **Problem:** multiple workers need deterministic eligibility and exclusive claims without
   inventing dependencies from live conversation.
2. **Source:** [Claude's shared dependency task list and file-locked claiming][claude-teams];
   LexRunner plan DAGs.
3. **Assumptions:** Claude task state is session-local and workers can mark it complete.
4. **Fit:** LexRunner can reuse dependency semantics while keeping WorkItem snapshots and engine
   acceptance authoritative.
5. **Decision:** **Adapt** claim/unblock behavior into shared application services; completion claims
   do not unblock dependents until policy-accepted evidence permits it.
6. **Owner:** LexRunner #780 for shared planning/status services and #802 for fan-in.
7. **Proof:** concurrent claims yield one owner; a worker-complete but verification-failed task keeps
   dependents blocked.
8. **Boundary:** do not import Claude's local mailbox/task formats or make them integration truth.

### D9. Bounded nested delegation — Defer

1. **Problem:** an orchestrator worker may need specialist children without unbounded recursive
   fan-out or authority expansion.
2. **Source:** [OpenClaw depth/tool limits][openclaw-subagents];
   [Claude's intentional no-nested-team boundary][claude-teams].
3. **Assumptions:** source parents synthesize child text inside session state.
4. **Fit:** depth and child limits are compatible, but LexRunner lacks stable child evidence and
   adapter authority negotiation today.
5. **Decision:** **Defer** nested execution until one-level fan-out, engine verification, cancellation,
   and capability attenuation pass dogfood. Preserve depth/child ceilings in the design.
6. **Owner:** LexRunner #802 and #804; no new package or runtime dependency.
7. **Proof:** later conformance must prove leaf workers cannot delegate or acquire controller tools,
   and cascade cancellation retains child evidence.
8. **Boundary:** session-tree behavior is not a protocol import.

### D10. Least-capability tools and non-escalating attenuation — Adopt

1. **Problem:** role prompts alone do not prevent a worker from invoking an available dangerous tool.
2. **Source:** [OpenClaw tool/depth restrictions][openclaw-subagents],
   [Copilot custom-agent tool lists][copilot-sdk], [GitHub branch/tool limits][copilot-security],
   and [Claude role allowlists][claude-teams].
3. **Assumptions:** some sources inherit parent/main permission or auth state and then restrict tools.
4. **Fit:** LexRunner computes effective authority as an intersection; explicit denial wins.
5. **Decision:** **Adopt** explicit capability sets and runtime enforcement. **Reject** additive auth
   fallback and any child authority greater than its parent/run ceiling.
6. **Owner:** LexRunner #794 and #804; AXF owns capability transport semantics.
7. **Proof:** requested edit-only work cannot push, read secrets, spawn a stronger worker, or gain an
   ambient credential after attachment.
8. **Boundary:** tool names are runtime-specific and mapped by adapters; AXF is not a worker runtime.

### D11. Raw transcript sharing and ambient auth fallback — Reject

1. **Problem:** session continuity can tempt systems to share broad transcripts or credentials as a
   shortcut for explicit context and authority.
2. **Source:** [OpenClaw cross-session history/auth fallback][openclaw-multi] and
   conversation-oriented product state across the reviewed systems.
3. **Assumptions:** one operator/gateway account is trusted across agent boundaries.
4. **Fit:** Lex tenants/workspaces and AXF capabilities require explicit boundaries; Lex Frames
   preserve deliberate work context rather than transcript dumps.
5. **Decision:** **Reject** raw transcript memory as orchestration state and reject inherited ambient
   credentials. Allow only bounded, redacted evidence references and explicit grants.
6. **Owner:** Lex for durable context; AXF for capabilities; LexRunner #794/#804 for enforcement.
7. **Proof:** a worker in another workspace receives neither transcript content nor credential
   capability unless both are explicitly authorized and bounded.
8. **Boundary:** this rejects a trust assumption, not the source products themselves.

### D12. Worker-owned GitHub delivery — Reject for initial LexRunner workers

1. **Problem:** letting a worker push/open/merge directly collapses work production, evidence,
   verification, signing, and authority into one actor.
2. **Source:** [Cursor background-agent branch push][cursor-background];
   [GitHub agent draft-PR workflow][copilot-cloud]; [Symphony provider-native tools][symphony].
3. **Assumptions:** platform branch restrictions, audit logs, and required human review constrain the
   hosted agent.
4. **Fit:** ADR-010 keeps delivery coordinator-owned and authority-gated.
5. **Decision:** **Reject** worker push/PR/merge/release authority by default. **Adopt** GitHub's
   reviewable draft/human handoff as a delivery UX produced by the coordinator.
6. **Owner:** LexRunner #793 and later delivery work under ADR-010.
7. **Proof:** a worker result can become a verified coordinator commit/PR; the same worker token
   cannot push or approve it.
8. **Boundary:** hosted provider agents may retain their native delivery behavior in an explicitly
   declared high-level adapter, but it cannot masquerade as least-authority worker conformance.

### D13. Hosted remote worker adapters — Defer

1. **Problem:** remote compute enables long-running and cross-device work but adds code retention,
   network, repository-grant, cost, and provider-state assumptions.
2. **Source:** [Cursor Background Agents][cursor-background], [Codex app][codex-app], and
   [GitHub Copilot cloud agent][copilot-cloud].
3. **Assumptions:** vendors own VM lifecycle, session storage, network policy, and part of delivery.
4. **Fit:** ADR-010 allows remote runtimes only through explicit envelope and capability contracts.
5. **Decision:** **Defer** production support until local adapter negotiation and reconciliation are
   proven. Research adapters may declare unsupported guarantees and fail closed.
6. **Owner:** LexRunner #804 after the first local worker adapter.
7. **Proof:** a mock remote adapter proves session binding, cancellation, evidence retrieval,
   credential non-disclosure, and lost-service reconciliation before any vendor integration.
8. **Boundary:** vendor terms, data retention, API pricing, and repository permissions require an
   operator decision; no vendor SDK becomes core orchestration truth.

### D14. Compact normal output and diagnostic evidence on demand — Adopt

1. **Problem:** agent-facing status can consume more context than the next decision needs.
2. **Source:** [OpenClaw bounded/redacted history][openclaw-subagents], separate product status
   views, and Lex compact context/diagnostic precedent.
3. **Assumptions:** source tools may retain full transcripts elsewhere.
4. **Fit:** LexRunner can expose stable state, IDs, outcome, durable delta, and next action by default
   while preserving detailed evidence behind explicit diagnostics.
5. **Decision:** **Adopt** bounded summaries and references; never hide state required for the next
   safe action.
6. **Owner:** LexRunner #793, #780, and #799; AXF owns transport-level compact response profiles.
7. **Proof:** normal CLI/MCP parity stays within a fixed byte budget and contains the next action;
   diagnostic mode adds redacted evidence without changing semantics.
8. **Boundary:** compactness is a schema/profile decision, not lossy string truncation.

### D15. Automatic workspace cleanup without identity and dirty-state proof — Reject

1. **Problem:** stale workspaces consume resources, but deletion can destroy useful failed work or a
   path that no longer belongs to the recorded Attempt.
2. **Source:** automatic cleanup in [Symphony][symphony] and [Claude teams][claude-teams];
   best-effort [OpenClaw process/archive cleanup][openclaw-subagents].
3. **Assumptions:** source directories are service/session-owned and safe to derive from an issue or
   session key.
4. **Fit:** LexRunner treats dirty orphaned workspaces as evidence and verifies registered worktree,
   repository, branch, runtime, and lease identity before removal.
5. **Decision:** **Reject** unconditional terminal cleanup. **Adapt** cleanup into idempotent,
   identity-verified release; quarantine ambiguous or dirty state.
6. **Owner:** LexRunner #767 and #799.
7. **Proof:** pathname swap, dirty tree, wrong branch, wrong Git runtime, and interrupted cleanup all
   preserve the workspace and emit a bounded actionable receipt.
8. **Boundary:** no source cleanup implementation is copied.

## Recommended implementation order

1. **Evidence first:** #766 canonical receipt sets, then #762 immutable engine verification.
2. **Authority and lifecycle truth:** #794 runtime ceilings, #767 envelope reconciliation, and #699
   merge-weave resume.
3. **Public services:** #793 verification/acceptance plus #779–#784 canonical CLI/MCP surfaces.
4. **Adapter boundary:** #804 capability negotiation and push lifecycle mapping.
5. **Supervisor:** #801 reconciliation, cancellation, retry-delta enforcement, and durable terminal
   deltas.
6. **Selective concurrency:** #802 evidence-preserving fan-out/fan-in and only later bounded nesting.
7. **Dogfood and release truth:** #799 fault injection and #795 evidence-based semver decision.

This order intentionally prioritizes cumulative intelligence over raw worker count. A second worker
is not useful until the system can preserve what it learned, verify what it produced, constrain what
it may do, and recover when either the worker or controller disappears.

## Explicitly unchanged

- `plan.json` remains the frozen integration input; this research does not make mutable issue or
  session state integration truth.
- Lex remains the durable work-context owner; LexRunner does not grow a transcript-memory system.
- AXF remains the bounded capability/response framework; it does not become an orchestrator.
- Lex-MCP transports Lex's MCP surface; it does not absorb LexRunner lifecycle state.
- LexSona derives reviewed behavior; it does not launch or verify workers.
- This record does not select a LexRunner package version. #795 owns that decision after dogfood
  evidence exists.

[cursor-3]: https://cursor.com/changelog/3-0
[cursor-background]: https://docs.cursor.com/background-agent
[openclaw-subagents]: https://docs.openclaw.ai/tools/subagents
[openclaw-multi]: https://docs.openclaw.ai/concepts/multi-agent
[claude-teams]: https://code.claude.com/docs/en/agent-teams
[codex-app]: https://openai.com/index/introducing-the-codex-app/
[symphony]: https://github.com/openai/symphony/blob/main/SPEC.md
[copilot-cloud]: https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/overview
[copilot-security]: https://docs.github.com/en/enterprise-cloud@latest/copilot/concepts/agents/cloud-agent/risks-and-mitigations
[copilot-sdk]: https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/custom-agents
