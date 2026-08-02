import { z } from "zod";

import {
  NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
  NativeWslProjectionInventoryState,
  NativeWslProjectionManifest_v1,
  NativeWslProjectionPlanAction,
  NativeWslProjectionPlanReason,
  NativeWslProjectionRequest_v1,
  nativeWslProjectionId,
} from "../schemas/agent-work-projection.js";
import { boundedStrictObject } from "../schemas/bounded-strict-object.js";
import { SHA256Hash } from "../schemas/task-contract.js";

const ProjectionId = z.string().min(1).max(4_096);
const Timestamp = z.string().max(64).datetime({ offset: true });

export const NativeWslProjectionInventoryObservation_v1 = z.union([
  boundedStrictObject({ state: z.literal("absent") }),
  boundedStrictObject({
    state: z.literal("ready"),
    manifest: NativeWslProjectionManifest_v1,
  }),
  boundedStrictObject({
    state: z.literal("staging"),
    projection_id: ProjectionId,
    request_digest: SHA256Hash,
    started_at: Timestamp,
  }),
  boundedStrictObject({
    state: z.literal("quarantined"),
    projection_id: ProjectionId.optional(),
    request_digest: SHA256Hash.optional(),
    quarantined_at: Timestamp,
  }),
  boundedStrictObject({
    state: z.literal("invalid"),
    projection_id: ProjectionId.optional(),
    request_digest: SHA256Hash.optional(),
  }),
  boundedStrictObject({
    state: z.literal("interrupted"),
    projection_id: ProjectionId,
    request_digest: SHA256Hash,
    started_at: Timestamp,
  }),
  boundedStrictObject({
    state: z.literal("conflicting"),
    projection_id: ProjectionId,
    request_digest: SHA256Hash.optional(),
    observed_at: Timestamp,
  }),
]);
export type NativeWslProjectionInventoryObservation_v1 = z.infer<
  typeof NativeWslProjectionInventoryObservation_v1
>;

export const NativeWslProjectionNextAction = z.enum([
  "prepare_projection_staging",
  "reuse_projection",
  "retry_after_active_request",
  "quarantine_observed_projection",
  "cleanup_quarantined_projection",
  "stop_and_report_conflict",
]);
export type NativeWslProjectionNextAction = z.infer<typeof NativeWslProjectionNextAction>;

export const NativeWslProjectionPlan_v1 = boundedStrictObject({
  schema_version: z.literal(NATIVE_WSL_PROJECTION_CONTRACT_VERSION),
  projection_id: ProjectionId,
  request_digest: SHA256Hash,
  inventory_state: NativeWslProjectionInventoryState,
  action: NativeWslProjectionPlanAction,
  reason: NativeWslProjectionPlanReason,
  selection_allowed: z.boolean(),
  mutation_required: z.boolean(),
  selected_manifest_digest: SHA256Hash.optional(),
  next_actions: z.array(NativeWslProjectionNextAction).min(1).max(2),
}).superRefine((plan, context) => {
  const reusesReady = plan.action === "reuse_ready";
  const mutates =
    plan.action === "prepare_staging" ||
    plan.action === "quarantine_then_prepare" ||
    plan.action === "cleanup_quarantine_then_prepare";
  if (plan.projection_id !== nativeWslProjectionId(plan.request_digest)) {
    context.addIssue({
      code: "custom",
      path: ["projection_id"],
      message: "projection identity does not match the request digest",
    });
  }
  if (plan.selection_allowed !== reusesReady) {
    context.addIssue({
      code: "custom",
      path: ["selection_allowed"],
      message: "only an exact ready projection may be selected",
    });
  }
  if (reusesReady !== (plan.selected_manifest_digest !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["selected_manifest_digest"],
      message: "only reuse plans bind a selected manifest",
    });
  }
  if (plan.mutation_required !== mutates) {
    context.addIssue({
      code: "custom",
      path: ["mutation_required"],
      message: "mutation declaration does not match the planned action",
    });
  }
  if (!planActionMatchesState(plan)) {
    context.addIssue({
      code: "custom",
      path: ["action"],
      message: "planned action and reason do not match inventory state",
    });
  }
  if (!planNextActionsMatch(plan)) {
    context.addIssue({
      code: "custom",
      path: ["next_actions"],
      message: "next actions do not match the planned action",
    });
  }
});
export type NativeWslProjectionPlan_v1 = z.infer<typeof NativeWslProjectionPlan_v1>;

export function planNativeWslProjection(
  requestInput: NativeWslProjectionRequest_v1,
  observationInput: NativeWslProjectionInventoryObservation_v1
): NativeWslProjectionPlan_v1 {
  const request = NativeWslProjectionRequest_v1.parse(requestInput);
  const observation = NativeWslProjectionInventoryObservation_v1.parse(observationInput);
  const projectionId = nativeWslProjectionId(request.request_digest);
  const common = {
    schema_version: NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
    projection_id: projectionId,
    request_digest: request.request_digest,
    inventory_state: observation.state,
  } as const;

  switch (observation.state) {
    case "absent":
      return NativeWslProjectionPlan_v1.parse({
        ...common,
        action: "prepare_staging",
        reason: "projection_absent",
        selection_allowed: false,
        mutation_required: true,
        next_actions: ["prepare_projection_staging"],
      });

    case "ready": {
      const manifest = observation.manifest;
      const sameProjection =
        manifest.projection_id === projectionId &&
        manifest.request_digest === request.request_digest;
      if (sameProjection && manifestMatchesRequest(manifest, request)) {
        return NativeWslProjectionPlan_v1.parse({
          ...common,
          action: "reuse_ready",
          reason: "projection_exact_match",
          selection_allowed: true,
          mutation_required: false,
          selected_manifest_digest: manifest.manifest_digest,
          next_actions: ["reuse_projection"],
        });
      }
      if (sameProjection) {
        return NativeWslProjectionPlan_v1.parse({
          ...common,
          action: "refuse_conflict",
          reason: "projection_conflicting",
          selection_allowed: false,
          mutation_required: false,
          next_actions: ["stop_and_report_conflict"],
        });
      }
      return NativeWslProjectionPlan_v1.parse({
        ...common,
        action: "quarantine_then_prepare",
        reason: "projection_stale",
        selection_allowed: false,
        mutation_required: true,
        next_actions: ["quarantine_observed_projection", "prepare_projection_staging"],
      });
    }

    case "staging":
      if (
        observation.projection_id === projectionId &&
        observation.request_digest === request.request_digest
      ) {
        return NativeWslProjectionPlan_v1.parse({
          ...common,
          action: "wait_for_same_request",
          reason: "projection_staging_same_request",
          selection_allowed: false,
          mutation_required: false,
          next_actions: ["retry_after_active_request"],
        });
      }
      return NativeWslProjectionPlan_v1.parse({
        ...common,
        action: "refuse_conflict",
        reason: "projection_staging_conflict",
        selection_allowed: false,
        mutation_required: false,
        next_actions: ["stop_and_report_conflict"],
      });

    case "quarantined":
      return NativeWslProjectionPlan_v1.parse({
        ...common,
        action: "cleanup_quarantine_then_prepare",
        reason: "projection_quarantined",
        selection_allowed: false,
        mutation_required: true,
        next_actions: ["cleanup_quarantined_projection", "prepare_projection_staging"],
      });

    case "invalid":
      return NativeWslProjectionPlan_v1.parse({
        ...common,
        action: "quarantine_then_prepare",
        reason: "projection_invalid",
        selection_allowed: false,
        mutation_required: true,
        next_actions: ["quarantine_observed_projection", "prepare_projection_staging"],
      });

    case "interrupted":
      return NativeWslProjectionPlan_v1.parse({
        ...common,
        action: "quarantine_then_prepare",
        reason: "projection_interrupted",
        selection_allowed: false,
        mutation_required: true,
        next_actions: ["quarantine_observed_projection", "prepare_projection_staging"],
      });

    case "conflicting":
      return NativeWslProjectionPlan_v1.parse({
        ...common,
        action: "refuse_conflict",
        reason: "projection_conflicting",
        selection_allowed: false,
        mutation_required: false,
        next_actions: ["stop_and_report_conflict"],
      });
  }
}

function planActionMatchesState(plan: {
  inventory_state: NativeWslProjectionInventoryState;
  action: z.infer<typeof NativeWslProjectionPlanAction>;
  reason: z.infer<typeof NativeWslProjectionPlanReason>;
}): boolean {
  switch (plan.inventory_state) {
    case "absent":
      return plan.action === "prepare_staging" && plan.reason === "projection_absent";
    case "ready":
      return (
        (plan.action === "reuse_ready" && plan.reason === "projection_exact_match") ||
        (plan.action === "quarantine_then_prepare" && plan.reason === "projection_stale") ||
        (plan.action === "refuse_conflict" && plan.reason === "projection_conflicting")
      );
    case "staging":
      return (
        (plan.action === "wait_for_same_request" &&
          plan.reason === "projection_staging_same_request") ||
        (plan.action === "refuse_conflict" && plan.reason === "projection_staging_conflict")
      );
    case "quarantined":
      return (
        plan.action === "cleanup_quarantine_then_prepare" &&
        plan.reason === "projection_quarantined"
      );
    case "invalid":
      return plan.action === "quarantine_then_prepare" && plan.reason === "projection_invalid";
    case "interrupted":
      return plan.action === "quarantine_then_prepare" && plan.reason === "projection_interrupted";
    case "conflicting":
      return plan.action === "refuse_conflict" && plan.reason === "projection_conflicting";
  }
}

function planNextActionsMatch(plan: {
  action: z.infer<typeof NativeWslProjectionPlanAction>;
  next_actions: z.infer<typeof NativeWslProjectionNextAction>[];
}): boolean {
  const expected: Record<
    z.infer<typeof NativeWslProjectionPlanAction>,
    z.infer<typeof NativeWslProjectionNextAction>[]
  > = {
    prepare_staging: ["prepare_projection_staging"],
    reuse_ready: ["reuse_projection"],
    wait_for_same_request: ["retry_after_active_request"],
    quarantine_then_prepare: ["quarantine_observed_projection", "prepare_projection_staging"],
    cleanup_quarantine_then_prepare: [
      "cleanup_quarantined_projection",
      "prepare_projection_staging",
    ],
    refuse_conflict: ["stop_and_report_conflict"],
  };
  const expectedActions = expected[plan.action];
  return (
    plan.next_actions.length === expectedActions.length &&
    plan.next_actions.every((nextAction, index) => nextAction === expectedActions[index])
  );
}

function manifestMatchesRequest(
  manifest: NativeWslProjectionManifest_v1,
  request: NativeWslProjectionRequest_v1
): boolean {
  const mapping = manifest.path_mapping;
  const source = manifest.source_observation;
  const cleanEnough =
    request.source.dirty_policy === "committed_base_only" || source.cleanliness === "clean";
  const headMatches =
    request.source.head_policy === "observe" || source.source_head_sha === request.base_sha;

  return (
    manifest.repository_id === request.repository.id &&
    manifest.base_sha === request.base_sha &&
    manifest.native_host_id === request.native.host_id &&
    source.observed_remote_hash === request.repository.expected_remote_hash &&
    cleanEnough &&
    headMatches &&
    mapping.roots.windows_source.runtime_id === request.source.windows_runtime &&
    mapping.roots.windows_source.path === request.source.windows_repository_path &&
    mapping.roots.wsl_source.runtime_id === request.source.wsl_git_runtime &&
    mapping.roots.wsl_source.path === request.source.wsl_repository_path &&
    mapping.roots.native_repository.runtime_id === request.native.git_runtime &&
    mapping.roots.native_worktree_root.runtime_id === request.native.git_runtime &&
    linuxPathIsWithin(mapping.roots.native_repository.path, request.native.projection_root) &&
    linuxPathIsWithin(mapping.roots.native_worktree_root.path, request.native.worktree_root)
  );
}

function linuxPathIsWithin(candidate: string, root: string): boolean {
  if (candidate === root) return false;
  return root === "/" ? candidate.startsWith("/") : candidate.startsWith(`${root}/`);
}
