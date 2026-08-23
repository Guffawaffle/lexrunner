import { z } from "zod";

import { computeCanonicalHash, SHA256Hash } from "../schemas/task-contract.js";

export const ATTEMPT_AWAITABLE_CONTRACT_VERSION = "1.0.0" as const;
export const AXF_AWAITABLE_SCHEMA_VERSION = "axf/awaitable/v1" as const;
export const AXF_AWAIT_RESULT_SCHEMA_VERSION = "axf/await-result/v1" as const;
export const MIN_ATTEMPT_AWAITABLE_DURATION_MS = 1_000;
export const MAX_ATTEMPT_AWAITABLE_DURATION_MS = 30 * 60 * 1_000;

const MAX_DESCRIPTOR_BYTES = 16 * 1_024;
const MAX_EVIDENCE_BYTES = 32 * 1_024;
const MAX_JSON_DEPTH = 24;
const MAX_JSON_ENTRIES = 2_048;
const MAX_REQUIRED_CHECKS = 32;
const opaqueId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, "Must be an opaque identifier")
  .refine(
    (value) => !containsAttemptAwaitableCredentialValue(value),
    "opaque identifiers must not contain credential material"
  );
const instant = z.string().datetime({ offset: true });
const supportedProviderKind = z.literal("github.required-checks");
const githubRepository = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u, "must be an owner/name repository identity")
  .refine(
    (value) => !containsAttemptAwaitableCredentialValue(value),
    "repository identity must not contain credential material"
  );
const gitCommitSha = z.string().regex(/^[a-f0-9]{40}$/iu, "must be an exact commit SHA");
const publicName = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine(
      (value) => !containsAttemptAwaitableCredentialValue(value),
      "must not contain credential material"
    );
const authorityFieldNames = new Set([
  "auth",
  "authorization",
  "authorizationheader",
  "bearer",
  "bearertoken",
  "credential",
  "credentials",
  "password",
  "privatekey",
  "secret",
  "secrets",
  "token",
]);
const authorityFieldSuffixes = [
  "apikey",
  "accesskey",
  "credential",
  "credentials",
  "password",
  "privatekey",
  "secret",
  "token",
] as const;

const GithubRequiredCheckSelector_v1 = z
  .object({
    source: z.enum(["check-run", "status"]),
    name: publicName(200),
    appSlug: publicName(100).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.source === "status" && value.appSlug !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["appSlug"],
        message: "appSlug is valid only for check-run selectors",
      });
    }
  });

/**
 * The initial durable slice admits only an exact schema mirrored from AXF's bundled provider.
 * Adding a provider requires another closed descriptor and evidence schema here; arbitrary JSON is
 * never accepted into the durable store merely because AXF can observe it.
 */
const GithubRequiredChecksDescriptor_v1 = z
  .object({
    schemaVersion: z.literal(AXF_AWAITABLE_SCHEMA_VERSION),
    kind: supportedProviderKind,
    subject: z
      .object({
        repository: githubRepository,
        headSha: gitCommitSha,
        pullRequestNumber: z.number().int().positive().optional(),
      })
      .strict(),
    condition: z
      .object({
        type: z.literal("all-required-checks-terminal"),
        requiredChecks: z.array(GithubRequiredCheckSelector_v1).min(1).max(MAX_REQUIRED_CHECKS),
      })
      .strict()
      .superRefine((value, context) => {
        const identities = value.requiredChecks.map(
          (selector) => `${selector.source}:${selector.name}:${selector.appSlug ?? "*"}`
        );
        if (new Set(identities).size !== identities.length) {
          context.addIssue({
            code: "custom",
            path: ["requiredChecks"],
            message: "required check selectors must be unique",
          });
        }
      }),
  })
  .strict();

/** Credential-free AXF observation identity. Kind-specific semantics remain AXF-owned. */
export const ExternalAwaitableDescriptor_v1 = GithubRequiredChecksDescriptor_v1.superRefine(
  (value, context) => {
    const inspection = inspectJson(value);
    if (inspection.depth > MAX_JSON_DEPTH || inspection.entries > MAX_JSON_ENTRIES) {
      context.addIssue({
        code: "custom",
        message: "awaitable descriptor exceeds its structural bound",
      });
    }
    if (inspection.authorityField) {
      context.addIssue({
        code: "custom",
        path: inspection.authorityField,
        message: "awaitable descriptors must not contain credentials or bearer authority",
      });
    }
    if (inspection.authorityValue) {
      context.addIssue({
        code: "custom",
        path: inspection.authorityValue,
        message: "awaitable descriptors must not contain credential values",
      });
    }
    if (
      inspection.valid &&
      inspection.depth <= MAX_JSON_DEPTH &&
      canonicalBytes(value) > MAX_DESCRIPTOR_BYTES
    ) {
      context.addIssue({
        code: "custom",
        message: `awaitable descriptor exceeds ${MAX_DESCRIPTOR_BYTES} bytes`,
      });
    }
  }
);
export type ExternalAwaitableDescriptor_v1 = z.infer<typeof ExternalAwaitableDescriptor_v1>;

export const ExternalAwaitOutcome_v1 = z.enum([
  "satisfied",
  "terminal-failed",
  "deadline",
  "cancelled",
  "subject-drift",
  "observation-error",
]);
export type ExternalAwaitOutcome_v1 = z.infer<typeof ExternalAwaitOutcome_v1>;

const GithubRequiredCheckObservation_v1 = z
  .object({
    source: z.enum(["check-run", "status"]),
    name: publicName(200),
    appSlug: publicName(100).nullable(),
    state: z.enum([
      "missing",
      "queued",
      "in_progress",
      "requested",
      "waiting",
      "pending",
      "completed",
      "error",
      "failure",
      "success",
    ]),
    conclusion: z
      .enum([
        "action_required",
        "cancelled",
        "failure",
        "neutral",
        "skipped",
        "stale",
        "startup_failure",
        "success",
        "timed_out",
      ])
      .nullable()
      .optional(),
    terminal: z.boolean(),
    successful: z.boolean(),
  })
  .strict();

const GithubRequiredChecksEvidence_v1 = z.union([
  z.null(),
  z
    .object({
      repository: githubRepository,
      headSha: gitCommitSha,
      pullRequestNumber: z.number().int().positive().nullable(),
      requiredChecks: z.array(GithubRequiredCheckObservation_v1).min(1).max(MAX_REQUIRED_CHECKS),
    })
    .strict(),
  z
    .object({
      repository: githubRepository,
      pullRequestNumber: z.number().int().positive(),
      expectedHeadSha: gitCommitSha,
      observedHeadSha: gitCommitSha,
    })
    .strict(),
]);

/** Exact normalized terminal projection returned by AXF's process-bound wait capability. */
export const AxfExternalAwaitResult_v1 = z
  .object({
    schemaVersion: z.literal(AXF_AWAIT_RESULT_SCHEMA_VERSION),
    provider: supportedProviderKind,
    outcome: ExternalAwaitOutcome_v1,
    terminal: z.literal(true),
    durability: z.literal("process-bound"),
    authorityModel: z.literal("host-provided"),
    underlyingCancellation: z.literal(false),
    effectiveDeadlineMs: z
      .number()
      .int()
      .min(MIN_ATTEMPT_AWAITABLE_DURATION_MS)
      .max(MAX_ATTEMPT_AWAITABLE_DURATION_MS),
    observationCount: z.number().int().nonnegative(),
    evidence: GithubRequiredChecksEvidence_v1,
  })
  .strict()
  .superRefine((value, context) => {
    const inspection = inspectJson(value.evidence);
    if (inspection.depth > MAX_JSON_DEPTH || inspection.entries > MAX_JSON_ENTRIES) {
      context.addIssue({ code: "custom", path: ["evidence"], message: "evidence is too complex" });
    }
    if (
      inspection.valid &&
      inspection.depth <= MAX_JSON_DEPTH &&
      canonicalBytes(value.evidence) > MAX_EVIDENCE_BYTES
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: `evidence exceeds ${MAX_EVIDENCE_BYTES} bytes`,
      });
    }
    if (inspection.authorityField) {
      context.addIssue({
        code: "custom",
        path: ["evidence", ...inspection.authorityField],
        message: "awaitable evidence must not contain credentials or bearer authority",
      });
    }
    if (inspection.authorityValue) {
      context.addIssue({
        code: "custom",
        path: ["evidence", ...inspection.authorityValue],
        message: "awaitable evidence must not contain credential values",
      });
    }
    const snapshot =
      value.evidence !== null && "requiredChecks" in value.evidence ? value.evidence : undefined;
    const drift =
      value.evidence !== null && "expectedHeadSha" in value.evidence ? value.evidence : undefined;
    if (["satisfied", "terminal-failed"].includes(value.outcome) && !snapshot) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "terminal check outcomes require normalized required-check evidence",
      });
    }
    if (value.outcome === "subject-drift" && !drift) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "subject drift requires exact-head drift evidence",
      });
    }
  });
export type AxfExternalAwaitResult_v1 = z.infer<typeof AxfExternalAwaitResult_v1>;

export const AttemptAwaitableStatus_v1 = z.enum([
  "registered",
  "observing",
  "satisfied",
  "terminal_failed",
  "deadline",
  "cancelled",
  "subject_drift",
  "observation_error",
]);
export type AttemptAwaitableStatus_v1 = z.infer<typeof AttemptAwaitableStatus_v1>;

export const AttemptAwaitableObserverLease_v1 = z
  .object({
    observer_id: opaqueId,
    lease_id: opaqueId,
    fencing_token: z.number().int().positive(),
    acquired_at: instant,
    expires_at: instant,
  })
  .strict()
  .refine((value) => Date.parse(value.expires_at) > Date.parse(value.acquired_at), {
    path: ["expires_at"],
    message: "observer lease must expire after acquisition",
  });
export type AttemptAwaitableObserverLease_v1 = z.infer<typeof AttemptAwaitableObserverLease_v1>;

export const AttemptAwaitableTerminalResult_v1 = z
  .object({
    schema_version: z.literal(ATTEMPT_AWAITABLE_CONTRACT_VERSION),
    provider: supportedProviderKind,
    outcome: ExternalAwaitOutcome_v1,
    source: z.enum(["observer", "lexrunner"]),
    observed_at: instant,
    observer_result: AxfExternalAwaitResult_v1.optional(),
    reason_code: z.enum(["deadline_elapsed", "operator_cancelled"]).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.source === "observer") {
      if (
        !value.observer_result ||
        value.reason_code ||
        value.provider !== value.observer_result.provider ||
        value.outcome !== value.observer_result.outcome ||
        value.outcome === "cancelled"
      ) {
        context.addIssue({
          code: "custom",
          path: ["observer_result"],
          message: "observer results must bind one non-cancelled AXF terminal outcome",
        });
      }
      return;
    }
    const expectedReason = value.outcome === "deadline" ? "deadline_elapsed" : "operator_cancelled";
    if (
      value.observer_result ||
      !["deadline", "cancelled"].includes(value.outcome) ||
      value.reason_code !== expectedReason
    ) {
      context.addIssue({
        code: "custom",
        path: ["reason_code"],
        message: "LexRunner terminal results are limited to deadline or operator cancellation",
      });
    }
  });
export type AttemptAwaitableTerminalResult_v1 = z.infer<typeof AttemptAwaitableTerminalResult_v1>;

export const AttemptAwaitableDelivery_v1 = z
  .object({
    delivery_id: opaqueId,
    status: z.enum(["pending", "delivered"]),
    completion_hash: SHA256Hash,
    attempt_count: z.number().int().nonnegative(),
    last_attempt_at: instant.optional(),
    delivered_at: instant.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.attempt_count > 0 !== (value.last_attempt_at !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["last_attempt_at"],
        message: "delivery attempts and their last timestamp must appear together",
      });
    }
    if ((value.status === "delivered") !== (value.delivered_at !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["delivered_at"],
        message: "delivered_at is required exactly for delivered notifications",
      });
    }
  });
export type AttemptAwaitableDelivery_v1 = z.infer<typeof AttemptAwaitableDelivery_v1>;

export const AttemptAwaitableRecord_v1 = z
  .object({
    schema_version: z.literal(ATTEMPT_AWAITABLE_CONTRACT_VERSION),
    awaitable_id: opaqueId,
    attempt_id: opaqueId,
    worker_session_id: opaqueId.optional(),
    revision: z.number().int().nonnegative(),
    descriptor: ExternalAwaitableDescriptor_v1,
    descriptor_hash: SHA256Hash,
    status: AttemptAwaitableStatus_v1,
    deadline_at: instant,
    observer_fencing_token: z.number().int().nonnegative(),
    observer_lease: AttemptAwaitableObserverLease_v1.optional(),
    result: AttemptAwaitableTerminalResult_v1.optional(),
    result_hash: SHA256Hash.optional(),
    delivery: AttemptAwaitableDelivery_v1.optional(),
    created_at: instant,
    updated_at: instant,
    terminal_at: instant.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (computeCanonicalHash(value.descriptor) !== value.descriptor_hash) {
      context.addIssue({
        code: "custom",
        path: ["descriptor_hash"],
        message: "descriptor hash does not match the persisted descriptor",
      });
    }
    if (Date.parse(value.deadline_at) <= Date.parse(value.created_at)) {
      context.addIssue({
        code: "custom",
        path: ["deadline_at"],
        message: "deadline must follow registration",
      });
    }
    if ((value.status === "observing") !== (value.observer_lease !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["observer_lease"],
        message: "an observer lease is required exactly while observing",
      });
    }
    if (
      value.observer_lease &&
      value.observer_lease.fencing_token !== value.observer_fencing_token
    ) {
      context.addIssue({
        code: "custom",
        path: ["observer_fencing_token"],
        message: "active observer lease must use the latest fencing token",
      });
    }
    const terminal = !["registered", "observing"].includes(value.status);
    if (
      terminal !== (value.terminal_at !== undefined) ||
      terminal !== (value.result !== undefined) ||
      terminal !== (value.result_hash !== undefined) ||
      terminal !== (value.delivery !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["terminal_at"],
        message: "terminal state, result, delivery, and terminal timestamp must appear together",
      });
    }
    if (terminal && value.observer_lease) {
      context.addIssue({
        code: "custom",
        path: ["observer_lease"],
        message: "terminal awaitables cannot retain observer authority",
      });
    }
    if (value.result) {
      if (
        computeCanonicalHash(value.result) !== value.result_hash ||
        statusForAwaitableOutcome(value.result.outcome) !== value.status
      ) {
        context.addIssue({
          code: "custom",
          path: ["result"],
          message: "terminal result must bind the persisted status and result hash",
        });
      }
      const completion = completionForAttemptAwaitable(value);
      if (value.delivery?.completion_hash !== computeCanonicalHash(completion)) {
        context.addIssue({
          code: "custom",
          path: ["delivery", "completion_hash"],
          message: "delivery must bind the exact completion payload",
        });
      }
    }
  });
export type AttemptAwaitableRecord_v1 = z.infer<typeof AttemptAwaitableRecord_v1>;

export const AttemptAwaitableCompletion_v1 = z
  .object({
    schema_version: z.literal(ATTEMPT_AWAITABLE_CONTRACT_VERSION),
    delivery_id: opaqueId,
    awaitable_id: opaqueId,
    attempt_id: opaqueId,
    worker_session_id: opaqueId.optional(),
    descriptor_hash: SHA256Hash,
    result: AttemptAwaitableTerminalResult_v1,
    result_hash: SHA256Hash,
    terminal_at: instant,
  })
  .strict();
export type AttemptAwaitableCompletion_v1 = z.infer<typeof AttemptAwaitableCompletion_v1>;

export function completionForAttemptAwaitable(
  record: Pick<
    AttemptAwaitableRecord_v1,
    | "awaitable_id"
    | "attempt_id"
    | "worker_session_id"
    | "descriptor_hash"
    | "result"
    | "result_hash"
    | "terminal_at"
    | "delivery"
  >
): AttemptAwaitableCompletion_v1 {
  if (!record.result || !record.result_hash || !record.terminal_at || !record.delivery) {
    throw new Error("Attempt awaitable is not terminal");
  }
  return AttemptAwaitableCompletion_v1.parse({
    schema_version: ATTEMPT_AWAITABLE_CONTRACT_VERSION,
    delivery_id: record.delivery.delivery_id,
    awaitable_id: record.awaitable_id,
    attempt_id: record.attempt_id,
    ...(record.worker_session_id ? { worker_session_id: record.worker_session_id } : {}),
    descriptor_hash: record.descriptor_hash,
    result: record.result,
    result_hash: record.result_hash,
    terminal_at: record.terminal_at,
  });
}

export function statusForAwaitableOutcome(
  outcome: ExternalAwaitOutcome_v1
): AttemptAwaitableStatus_v1 {
  switch (outcome) {
    case "terminal-failed":
      return "terminal_failed";
    case "subject-drift":
      return "subject_drift";
    case "observation-error":
      return "observation_error";
    default:
      return outcome;
  }
}

export function deliveryIdForAttemptAwaitable(awaitableId: string): string {
  const parsed = opaqueId.parse(awaitableId);
  return `completion:${computeCanonicalHash({ awaitable_id: parsed })}`;
}

export function parseExternalAwaitableDescriptor(value: unknown): ExternalAwaitableDescriptor_v1 {
  return ExternalAwaitableDescriptor_v1.parse(value);
}

function inspectJson(value: unknown): {
  valid: boolean;
  depth: number;
  entries: number;
  authorityField?: (string | number)[];
  authorityValue?: (string | number)[];
} {
  const pending: Array<{ value: unknown; depth: number; path: (string | number)[] }> = [
    { value, depth: 0, path: [] },
  ];
  let maximumDepth = 0;
  let entries = 0;
  let valid = true;
  let authorityField: (string | number)[] | undefined;
  let authorityValue: (string | number)[] | undefined;
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    maximumDepth = Math.max(maximumDepth, current.depth);
    if (current.value === null || typeof current.value === "boolean") {
      continue;
    }
    if (typeof current.value === "string") {
      if (!authorityValue && containsAttemptAwaitableCredentialValue(current.value)) {
        authorityValue = current.path;
      }
      continue;
    }
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) valid = false;
      continue;
    }
    if (typeof current.value !== "object") {
      valid = false;
      continue;
    }
    if (seen.has(current.value)) {
      valid = false;
      continue;
    }
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      entries += current.value.length;
      current.value.forEach((nested, index) =>
        pending.push({ value: nested, depth: current.depth + 1, path: [...current.path, index] })
      );
      continue;
    }
    const prototype = Object.getPrototypeOf(current.value);
    if (prototype !== Object.prototype && prototype !== null) {
      valid = false;
      continue;
    }
    const record = current.value as Record<string, unknown>;
    entries += Object.keys(record).length;
    for (const [field, nested] of Object.entries(record)) {
      if (!authorityField && isAuthorityField(field)) {
        authorityField = [...current.path, field];
      }
      pending.push({ value: nested, depth: current.depth + 1, path: [...current.path, field] });
    }
  }
  return {
    valid,
    depth: maximumDepth,
    entries,
    ...(authorityField ? { authorityField } : {}),
    ...(authorityValue ? { authorityValue } : {}),
  };
}

function isAuthorityField(field: string): boolean {
  const normalized = field.replace(/[^a-z0-9]/giu, "").toLowerCase();
  return (
    authorityFieldNames.has(normalized) ||
    authorityFieldSuffixes.some((suffix) => normalized.endsWith(suffix))
  );
}

export function containsAttemptAwaitableCredentialValue(value: string): boolean {
  if (/^\s*(?:basic|bearer)\s+\S+/iu.test(value)) return true;
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/iu.test(value)) return true;
  if (
    /(?:^|[?&;])(?:access[_-]?token|api[_-]?key|password|secret|token)=([^&;\s]+)/iu.test(value)
  ) {
    return true;
  }
  if (
    /(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})/u.test(
      value
    )
  ) {
    return true;
  }
  if (!value.includes("://")) return false;
  try {
    const parsed = new URL(value);
    return parsed.username.length > 0 || parsed.password.length > 0;
  } catch {
    return false;
  }
}

function canonicalBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
