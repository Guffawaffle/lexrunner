# From Calendars to Control Stacks
## A SmarterGPT Concept for Reducing Meeting Load (v0.1.0)

**Status:** Concept note / future-arc design (3.x+), *not* a 1.0.0 requirement
**Intended home:** LexRunner docs (`docs/`)
**Audience:** SmarterGPT / Lex / LexRunner design collaborators

---

## 1. Purpose

This document explores how the SmarterGPT ecosystem (Lex, LexRunner, LexSona, and agents) could be used to **reduce meeting load by default**, without sacrificing safety, accountability, or human control.

It deliberately looks beyond the 1.0.0 roadmap. Think of this as a **3.x-era direction-of-travel**: it should inform how we design primitives now (Frames, Receipts, policies, procedures), but it is not a near-term commitment.

Core thesis:

> The same control-stack patterns we use for code and PR orchestration can be applied to **teams and calendars**.
> Instead of treating meetings as the default coordination primitive, we treat them as one tool among many — governed by explicit policy, modes, and receipts.

---

## 2. The Problem: Calendars as a Coordination OS

Most teams use calendars as their de facto “coordination operating system.” The result:

- **Too many meetings** tied to habit, not value.
- **Status-heavy calls** where people read to each other from dashboards.
- **Underspecified decisions**: it’s unclear who decided what, under which constraints.
- **High cognitive load** for leadership: “What can move async vs what must be synchronous?”

When you unpack actual meeting content, most sessions fall into a small set of types:

1. **Status sync** – “What’s going on?”
2. **Clarification** – “What does this spec / ticket / email actually mean?”
3. **Decision** – “Which option do we pick? Who signs off?”
4. **Planning** – “What’s the plan for this sprint / quarter / project?”
5. **Brainstorm / alignment** – “Are we even solving the right thing?”

You do *not* need synchronous time for most of 1–4. You need:

- Shared context and history
- Structured options and tradeoffs
- Policy and risk constraints
- A clear owner and record of approval

Those are exactly the sorts of things the SmarterGPT control stack already models — for code. The 3.x move is to point that same machinery at **team coordination**.

---

## 3. Control Stack Recap (Applied to Meetings)

This section uses intentionally high-level descriptions; deep details belong in other docs.

- **Lex (memory + policy)**
  - Stores **Frames**: typed, structured snapshots of context.
  - Encodes **policy**: what’s allowed, what must be reviewed, what requires receipts.

- **LexRunner (orchestration, procedures)**
  - Premier orchestration layer built on Lex’s foundation.
  - Runs **procedures**: sequences of steps, gates, and tool calls to drive work forward.
  - Produces **Receipts** and structured status for runs.

- **LexSona (modes + guardrails)**
  - Behavioral layer: defines **modes** (e.g., conservative vs aggressive) and **guardrail profiles**.
  - Controls how assertive the system is allowed to be in a given context.

Applied to meetings, the control stack becomes:

> **Data plane:** Frames & artifacts (meeting notes, tickets, docs, transcripts)
> **Control plane:** LexRunner procedures operating over that data
> **Policy plane:** Lex + LexSona rules that define what can be async vs must be live

---

## 4. New Concepts: MeetingAtlas & DecisionMesh

To work on calendar time the way we work on code, we need two conceptual structures.

### 4.1 MeetingAtlas

A **MeetingAtlas** is the structured view of a team’s meeting landscape across time:

- Recurring meetings (standup, planning, retro, leadership syncs)
- Ad-hoc meetings (one-offs, cross-team syncs, incident calls)
- Metadata:
  - Participants and roles
  - Duration, recurrence, and time of day
  - Agenda patterns (if available)
  - Links to Frames and decisions

This is not a separate database product; it is a **lens** built out of Frames and calendar integrations:

- Calendar events → **MeetingFrames**
- Meeting notes / transcripts → enrich those Frames
- Outcomes → linked **DecisionFrames** and **ActionFrames**

### 4.2 DecisionMesh

A **DecisionMesh** is the graph of decisions, constraints, and dependencies:

- Nodes:
  - Decisions (“Ship feature X behind flag Y by date Z?”)
  - Policies (“Never change production DB schema without two approvals”)
  - Constraints (budget, safety, compliance)
- Edges:
  - “depends on”, “derived from”, “supersedes”, “blocked by”
- Attachments:
  - Receipts (who approved, when, under which mode)
  - Related Frames (specs, PRs, incidents, experiments)

The MeetingAtlas is about **time and people**.
The DecisionMesh is about **choices, constraints, and consequences**.

Together, they let the control stack answer: *“Do we really need this meeting, or can we move this decision async under policy X?”*

---

## 5. Frame Types for Coordination

We can support the above ideas with a small number of new Lex frame types.

### 5.1 MeetingFrame (concept sketch)

```ts
type MeetingKind =
  | "status"
  | "planning"
  | "decision"
  | "1:1"
  | "retro"
  | "brainstorm"
  | "incident"
  | "other";

interface MeetingFrame {
  frame_type: "meeting";
  meeting_id: string;          // stable ID for recurring series or unique for one-off
  occurrence_id: string;       // single instance
  kind: MeetingKind;
  title: string;
  schedule: {
    start_utc: string;
    end_utc: string;
    recurrence_id?: string;
  };
  participants: {
    id: string;
    name: string;
    role?: string;             // "host", "required", "optional"
  }[];
  purpose?: string;
  agenda_items?: string[];
  inputs?: string[];           // links to docs/tickets/Frames
  outcomes?: string[];         // quick summary
  decisions?: string[];        // FK into DecisionFrames
  actions?: string[];          // FK into ActionFrames / tickets
  transcript_refs?: string[];  // logs, recordings, summary frames
  tags?: string[];
}
```

### 5.2 DecisionFrame (concept sketch)

```ts
type DecisionStatus = "proposed" | "approved" | "rejected" | "superseded";

interface DecisionFrame {
  frame_type: "decision";
  decision_id: string;
  title: string;
  context_frames: string[];   // specs, incidents, code Frames, MeetingFrames
  options: {
    id: string;
    summary: string;
    pros: string[];
    cons: string[];
    risk_notes?: string;
  }[];
  chosen_option_id?: string;
  status: DecisionStatus;
  receipts?: string[];        // approval receipts
  constraints?: string[];     // policy references
  effective_from_utc?: string;
  superseded_by?: string;     // new DecisionFrame ID
}
```

### 5.3 Receipt (shared primitive)

Receipts already exist conceptually for risk/scope approvals in LexRunner. The same primitive should apply to decisions and meeting conversions:

- Who approved moving this meeting async?
- Who approved choosing Option B over Option A?
- Under which mode and policy profile?

We only need one Receipt concept; we just apply it in new contexts.

> **Design note:** These schemas are conceptual. For 1.0.x, it’s enough that Lex can store and index MeetingFrames and DecisionFrames. Sophisticated automation only comes once they’re proven useful in practice.

---

## 6. Core Flows That Actually Reduce Meetings

This section describes “what the system does” at a high level. Implementation details, MCP wiring, and agent persona design live elsewhere.

### 6.1 Flow A: “Can this meeting be async?”

**Goal:** Default to async decision runs unless policy says otherwise.

1. A meeting is created or requested (calendar event, ticket comment, form, etc.).
2. LexRunner runs a **`decide_meeting_mode`** procedure:
   - Classifies the meeting (status / decision / planning / etc.).
   - Pulls relevant Frames (prior meetings, specs, tickets, incidents).
   - Consults Lex policy and LexSona mode:
     - Risk categories (e.g., “changes to production DB must be live”).
     - Domain rules (e.g., safety-critical domains always require human huddles).
3. Outcomes:
   - **Async permitted:**
     - LexRunner spins up an **async decision run**:
       - Drafts options + tradeoffs from existing Frames.
       - Routes to stakeholders for comments and approvals.
       - Collects Receipts until policy says “enough approvals.”
     - The original meeting is cancelled or converted to a “decision thread,” and a DecisionFrame is written.
   - **Synchronous required:**
     - The meeting stays on the calendar, but:
       - A **pre-brief** Frame is auto-generated (context, options, key questions).
       - Open questions are highlighted for live discussion.
       - Afterward, outcome and decision Frames are updated.

Result: meetings become a **fallback** for high-risk or high-ambiguity situations, not the default.

---

### 6.2 Flow B: Weekly “Meeting Budget” Optimizer

**Goal:** Help teams respect a “meeting budget” by default.

1. LexRunner ingests calendar events for a team (via MCP integrations).
2. Builds / updates the **MeetingAtlas**:
   - Recurring series (e.g., standup, planning, retro, leadership updates).
   - Ad-hoc clusters (e.g., incident response, project-specific syncs).
3. For each recurring meeting, it links to Frames:
   - Recent MeetingFrames, DecisionFrames, ActionFrames.
   - Indicators like “decisions per hour” or “actions per hour.”
4. Policy defines the **meeting budget** and rules, such as:
   - Maximum meeting-hours per week per person.
   - Allowed types of recurring meetings and expected decision density.
5. LexRunner produces a **Meeting Plan Frame**:
   - Meetings to **keep** as-is.
   - Meetings to **shrink** (shorten or reduce frequency).
   - Meetings to **merge** (similar participants + topics).
   - Meetings to **convert to async** (status-only, low-value).
   - For each recommendation, it prepares proposed calendar edits and async channels.
6. Team leads or designated approvers review and sign Receipts:
   - Approve/modify/reject per recommendation.
   - Once approved, LexRunner can execute the changes via integrations (calendar updates, channel creation, etc.).

Result: teams gain an explicit lever for “fewer meetings” without losing control. The system does the legwork; humans make the decision.

---

### 6.3 Flow C: Pre-briefs Instead of Giant Alignment Calls

**Goal:** Turn sprawling alignment meetings into smaller, focused discussions.

1. Before any major decision meeting, LexRunner runs a **`prepare_prebrief`** procedure:
   - Gathers relevant Frames: specs, incidents, experiments, prior decisions, tickets.
   - Builds a **pre-brief packet**:
     - Context summary.
     - Current options and tradeoffs, mapped to policy (risk, cost, compliance).
     - Open questions that truly require live discussion.
2. The pre-brief is shared 24–48 hours ahead in the team’s normal channels.
3. Lex and agents monitor comments and Q&A:
   - Auto-answer repeat questions based on Frames where safe.
   - Escalate conflicting assumptions or policy uncertainties.
4. Outcomes:
   - Some “big meetings” disappear entirely: async consensus + Receipt → DecisionFrame.
   - Others shrink into **short, focused** sessions that only deal with truly contentious questions.

Result: even when meetings remain, they become **shorter and more deliberate**.

---

## 7. Safety, Guardrails, and Human Control

Reducing meeting load without safeguards would be reckless. The control stack must enforce clear boundaries.

### 7.1 LexSona Modes for Meetings

LexSona could define modes like:

- `conservative`
  - Never auto-cancel meetings.
  - Only prepare pre-briefs and action logs.
  - All changes are suggestions; humans execute changes.

- `balanced`
  - Auto-convert **low-risk status meetings** to async, with approvals.
  - Enforce meeting budget suggestions, but require explicit leader signoff.

- `deep_work_max`
  - Hard cap on hours in meetings per week (policy-defined).
  - Aggressively recommend merging / removing low-value series.
  - Still forbids automation in safety-critical or compliance-sensitive domains unless explicitly allowed.

Modes can be set per team, per project, or per stakeholder group.

### 7.2 “Never Automate” Categories

Some meetings should be treated as **non-automatable**, regardless of mode. Examples:

- Performance reviews and sensitive HR conversations.
- High-severity incident calls in safety-critical systems.
- Legal/compliance reviews in regulated industries, unless a regulator-approved pattern exists.

Lex policy should codify these “never automate” categories, and LexRunner procedures must treat them as immutable constraints.

### 7.3 Receipts as the Safety Net

Receipts are central:

- “We converted this recurring standup into an async update stream.”
- “We accepted a more aggressive meeting budget for Q3.”
- “We approved Option B for deployment under constraints X and Y.”

The system can propose; only humans can **ratify**. The presence of Receipts is also what allows teams to audit and roll back unhealthy patterns.

---

## 8. Rollout Path (Versioned, Not All-at-Once)

To avoid over-promising, this section proposes a staged arc rather than a monolith.

### 8.1 1.x Era — Meeting-Aware Memory

Focus: **capture** before **control**.

- Lex can store MeetingFrames and DecisionFrames.
- Basic helpers:
  - “Summarize the last N meetings about X.”
  - “What decisions were made about Y in the last quarter?”
  - “Generate meeting minutes from transcript + chat.”
- No automated changes to calendars. No meeting budget logic.
  This is just about enabling *queryable history*.

### 8.2 2.x Era — Assist, Don’t Replace

Focus: **assistive workflows** around existing meetings.

- LexRunner procedures for:
  - `prepare_prebrief`
  - `generate_action_log`
  - `link_decisions_to_issues`
- Agents help teams **prep** and **follow through**, not remove meetings.
- LexSona modes constrain behavior to prep/postwork, not calendar edits.

### 8.3 3.x Era — Meeting Budget & Async-by-Default

Focus: **default async**, meetings as an explicit policy choice.

- MeetingAtlas and DecisionMesh are first-class structures.
- Policy and LexSona modes govern:
  - Meeting budgets per team/person.
  - When meetings can be auto-converted or merged.
  - When decisions can be taken async with Receipts.
- LexRunner procedures for:
  - `decide_meeting_mode`
  - `optimize_calendar_week`
  - Async decision runs linked to work artifacts.

Even in 3.x, the system never fully replaces human judgment. It compresses the **coordination tax** so humans can spend more time on actual work and less time “reading the calendar.”

---

## 9. Why This Belongs in the SmarterGPT Story

This concept fits the existing narrative in a clean way:

- We already care about **control stacks**, not just raw capability.
- We already care about **receipts**, not just one-shot answers.
- We already care about **policy and modes**, not just “max power.”

Applying the same ideas to meetings does three things:

1. Makes SmarterGPT a **credible customer-zero** story:
   > “We run SmarterGPT on SmarterGPT, and it measurably shrinks the time we spend in meetings.”

2. Keeps the **IP boundary** clean: Lex remains a general-purpose memory/policy engine; LexRunner remains the orchestration layer that can operate on code, calendars, or any other domain, as long as it’s framed as structured runs and receipts.

3. Creates a **bridge to other domains** (healthcare, traffic planning, operations) without redesigning the control stack. Only the **artifacts** change (from PRs to policies to interventions); the governing patterns remain the same.

---

## 10. Next Steps (Non-Binding)

These are intentionally small and non-disruptive to the 1.0.0 roadmap:

1. **Frame prototypes (internal only):**
   - Introduce `MeetingFrame` and `DecisionFrame` types in Lex in a way that can be safely disabled or hidden if needed.
   - Use them first for internal notes, not user-facing automation.

2. **Dogfood-level helpers:**
   - Scripts/commands to summarize meetings and decisions for the core team.
   - “What did we decide about X?” queries as everyday tools.

3. **Signals for later:**
   - As we dogfood, watch for:
     - Which questions we ask about meetings most often.
     - Which recurring meetings feel obviously overgrown.
   - Use that to shape any future 2.x or 3.x work.

Everything beyond that (MeetingAtlas, DecisionMesh, async-first procedures) can and should wait until the core Lex and LexRunner 1.0.0 story is fully landed and stable.

For now, this document’s job is simple: **plant the flag** that the same control-stack principles we use for code can eventually be used to free humans from living inside their calendars all day.
