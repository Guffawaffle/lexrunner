# Worker reports, task receipts and verification

The owned Codex connection currently captures `turn/completed` notifications.
The observation stores retain those bytes, and reconciliation identifies a
consistent reported terminal outcome within a supplied snapshot. None of these
operations submits a task receipt or establishes that a task met its criteria.
Even valid receipt JSON appearing in provider text remains captured text.

## Existing application route

1. A worker claim must satisfy `AgentTaskReceipt_v2`: exact run, work item,
   attempt, packet, session and workspace bindings; observed base and result
   identity; claimed criteria/checks; outcome; and ordered worker timestamps.
   Provider `completed` is not a replacement for those fields. Provider
   `interrupted` also does not establish the task-receipt outcome `cancelled`.
2. `AgentWorkAttemptReceiptService.submit` validates the persisted execution
   envelope and path mapping before using the canonical receipt store. The
   store enforces controller credentials, revisions, packet references and
   receipt immutability. Submission requires an ended canonical worker session;
   ingestion and reconciliation never perform that lifecycle transition. A
   timely completed claim for a completed session becomes `receipt_submitted`
   with `verification_pending`; a late claim may be retained as `retained_late`
   without advancing the attempt. A report does not renew a lease.
3. `AgentWorkAttemptVerificationService.run` requires the stored receipt and
   its exact digest along with the bound packet, envelope, session and workspace.
   It uses the existing verification authorization and runtime contracts to
   observe the workspace and run packet-declared checks. A notification digest
   cannot stand in for a receipt digest. Worker-declared checks are assertions,
   not engine check results.
4. Acceptance is a separate policy operation over the recorded verification.
   Neither receipt submission nor provider completion establishes acceptance,
   integration eligibility or fulfillment of the larger work plan.

These services already exist. The real-worker adapter should compose them rather
than introduce another verification vocabulary or an alternative acceptance path.

## Next implementation boundary: receipt delivery

The source-only [structured delivery bridge](structured-worker-receipts.md) now
implements capture, provenance and recovery using this route. Live provider and
qualified-host conformance remain unproven. Its contract addresses:

- A bounded, explicit structured-result channel. Do not scrape arbitrary prose,
  infer omitted fields, or assume that terminal notification items contain a
  complete task transcript. Verify the selected channel against the supported
  provider protocol before depending on it.
- Provenance binding the supplied receipt bytes/digest to the dispatch claim,
  owned session, acknowledged turn and retained source artifact. A receipt's
  self-declared identifiers alone do not establish that association.
- Missing, malformed, duplicate and conflicting receipts; missing acknowledgments;
  partial capture; late arrival; and a crash between artifact persistence and
  submission. Recovery may retry an immutable receipt submission under its
  existing rules, but must not resend the model task or turn stale authority
  into a new grant.
- Explicit separation of reconciliation blockers, receipt-validation failures,
  verification outcomes and acceptance decisions. Receipt evidence can be
  retained without granting permission to verify or accept it.
- An explicit, authorized canonical worker-session end, with the resulting
  revision supplied to receipt submission. Define crash recovery across that
  transition and submission; never equate draining the capture queue with ending
  the session or releasing its resources.

The regression suite composes both real store implementations with snapshot
collection, reconciliation and the existing verifier's missing-receipt rejection.
It also submits a synthetic valid receipt through the canonical store to show
that a completed claim stops at verification pending. It does not exercise the
receipt application's path validation, run Git checks, prove provider receipt
delivery, qualify a native workspace, or demonstrate live end-to-end execution.
