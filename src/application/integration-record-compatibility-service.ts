import { createRunManager, type RunManager } from "../runs/manager.js";
import type { ArtifactType } from "../runs/artifacts.js";

const MAX_INPUT_BYTES = 16 * 1024;
const MAX_RESULT_BYTES = 64 * 1024;
const MAX_STRING_BYTES = 1024;
const MAX_ARTIFACTS = 64;

export const INTEGRATION_RECORD_REMOVAL_VERSION = "2.0.0" as const;

export const INTEGRATION_RECORD_REPLACEMENTS = {
  "lexrunner.startRun":
    "plan.create, gates.run, or merge.apply for integration; start_attempt for ADR-010 orchestration",
  "lexrunner.getStatus": "status for integration; get_attempt_status for ADR-010 orchestration",
  "lexrunner.listArtifacts":
    "bounded artifact references from the owning plan.create, gates.run, or merge.apply operation",
} as const;

export type IntegrationRecordCompatibilityTool = keyof typeof INTEGRATION_RECORD_REPLACEMENTS;

export type IntegrationRecordCompatibilityFailureCode =
  | "INTEGRATION_RECORD_INVALID_INPUT"
  | "INTEGRATION_RECORD_NOT_FOUND"
  | "INTEGRATION_RECORD_RESULT_LIMIT_EXCEEDED"
  | "INTEGRATION_RECORD_OPERATION_FAILED";

export class IntegrationRecordCompatibilityError extends Error {
  constructor(
    readonly code: IntegrationRecordCompatibilityFailureCode,
    message: string
  ) {
    super(message);
    this.name = "IntegrationRecordCompatibilityError";
  }
}

interface StartIntegrationRecordInput {
  mode: string;
  procedure: string;
  repo: string;
  task?: string;
  params?: Record<string, unknown>;
}

interface ListIntegrationArtifactsInput {
  runId: string;
  type?: ArtifactType;
  path?: string;
  latestOnly?: boolean;
  inline?: boolean;
}

interface CompatibilityMetadata {
  contract: "bounded-ax-v1";
  kind: "IntegrationRun";
  authority: "integration-record-only";
  deprecation: {
    tool: IntegrationRecordCompatibilityTool;
    replacement: string;
    removeIn: typeof INTEGRATION_RECORD_REMOVAL_VERSION;
  };
}

/**
 * Bounded retirement adapter for the legacy lexrunner.* integration-record tools.
 * It never receives a CoordinationStore and cannot advance ADR-010 WorkItem/Run/Attempt state.
 */
export class IntegrationRecordCompatibilityService {
  private readonly manager: RunManager;

  constructor(baseDir: string = process.cwd()) {
    this.manager = createRunManager(baseDir);
  }

  start(input: StartIntegrationRecordInput): CompatibilityMetadata & {
    runId: string;
    status: string;
    message: string;
    initialStatus: {
      runId: string;
      state: string;
      mode: string;
      procedure: string;
      summary: string;
      progress: unknown;
      nextOptions: unknown[];
    };
  } {
    validateStartInput(input);
    try {
      const result = this.manager.startRun(input);
      return boundedResult({
        ...metadata("lexrunner.startRun"),
        runId: boundedString(result.runId),
        status: boundedString(result.status),
        message: boundedString(result.message),
        initialStatus: projectStatus(result.initialStatus),
      });
    } catch (error) {
      if (error instanceof IntegrationRecordCompatibilityError) throw error;
      throw new IntegrationRecordCompatibilityError(
        "INTEGRATION_RECORD_OPERATION_FAILED",
        "Unable to create the legacy integration record"
      );
    }
  }

  getStatus(input: { runId: string }): CompatibilityMetadata & ReturnType<typeof projectStatus> {
    validateLabel(input.runId, "runId");
    try {
      return boundedResult({
        ...metadata("lexrunner.getStatus"),
        ...projectStatus(this.manager.getStatus(input)),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "RunNotFoundError") {
        throw new IntegrationRecordCompatibilityError(
          "INTEGRATION_RECORD_NOT_FOUND",
          "Integration record not found"
        );
      }
      if (error instanceof IntegrationRecordCompatibilityError) throw error;
      throw new IntegrationRecordCompatibilityError(
        "INTEGRATION_RECORD_OPERATION_FAILED",
        "Unable to read the legacy integration record"
      );
    }
  }

  listArtifacts(input: ListIntegrationArtifactsInput): CompatibilityMetadata & {
    artifacts: Array<{
      path: string;
      type: ArtifactType;
      size: number;
      createdAt: string;
      modifiedAt: string;
    }>;
    totalCount: number;
    returnedCount: number;
    truncated: boolean;
    inlineContentRetired: true;
  } {
    validateArtifactInput(input);
    try {
      const result = this.manager.listArtifacts({
        runId: input.runId,
        type: input.type,
        path: input.path,
        latestOnly: input.latestOnly,
        inline: false,
      });
      const artifacts = result.artifacts.slice(0, MAX_ARTIFACTS).map((artifact) => ({
        path: boundedString(artifact.path),
        type: artifact.type,
        size: artifact.size,
        createdAt: artifact.createdAt,
        modifiedAt: artifact.modifiedAt,
      }));
      return boundedResult({
        ...metadata("lexrunner.listArtifacts"),
        artifacts,
        totalCount: result.totalCount,
        returnedCount: artifacts.length,
        truncated: result.totalCount > artifacts.length,
        inlineContentRetired: true,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "RunNotFoundError") {
        throw new IntegrationRecordCompatibilityError(
          "INTEGRATION_RECORD_NOT_FOUND",
          "Integration record not found"
        );
      }
      if (error instanceof IntegrationRecordCompatibilityError) throw error;
      throw new IntegrationRecordCompatibilityError(
        "INTEGRATION_RECORD_OPERATION_FAILED",
        "Unable to list legacy integration artifacts"
      );
    }
  }
}

function metadata(tool: IntegrationRecordCompatibilityTool): CompatibilityMetadata {
  return {
    contract: "bounded-ax-v1",
    kind: "IntegrationRun",
    authority: "integration-record-only",
    deprecation: {
      tool,
      replacement: INTEGRATION_RECORD_REPLACEMENTS[tool],
      removeIn: INTEGRATION_RECORD_REMOVAL_VERSION,
    },
  };
}

function projectStatus(status: {
  runId: string;
  state: string;
  mode: string;
  procedure: string;
  summary: string;
  progress?: unknown;
  nextOptions?: unknown[];
}) {
  return {
    runId: boundedString(status.runId),
    state: boundedString(status.state),
    mode: boundedString(status.mode),
    procedure: boundedString(status.procedure),
    summary: boundedString(status.summary),
    progress: status.progress,
    nextOptions: (status.nextOptions ?? []).slice(0, MAX_ARTIFACTS),
  };
}

function validateStartInput(input: StartIntegrationRecordInput): void {
  validateLabel(input.mode, "mode");
  validateLabel(input.procedure, "procedure");
  validateLabel(input.repo, "repo");
  if (input.task !== undefined) validateLabel(input.task, "task");
  if (Buffer.byteLength(JSON.stringify(input.params ?? {}), "utf8") > MAX_INPUT_BYTES) {
    throw invalidInput("params exceeds the compatibility input limit");
  }
}

function validateArtifactInput(input: ListIntegrationArtifactsInput): void {
  validateLabel(input.runId, "runId");
  if (input.path !== undefined) validateLabel(input.path, "path");
}

function validateLabel(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw invalidInput(`${field} is required`);
  if (Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES) {
    throw invalidInput(`${field} exceeds the compatibility input limit`);
  }
}

function invalidInput(message: string): IntegrationRecordCompatibilityError {
  return new IntegrationRecordCompatibilityError("INTEGRATION_RECORD_INVALID_INPUT", message);
}

function boundedString(value: string): string {
  if (Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES) {
    throw new IntegrationRecordCompatibilityError(
      "INTEGRATION_RECORD_RESULT_LIMIT_EXCEEDED",
      "Integration record contains an overlong string"
    );
  }
  return value;
}

function boundedResult<T>(value: T): T {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_RESULT_BYTES) {
    throw new IntegrationRecordCompatibilityError(
      "INTEGRATION_RECORD_RESULT_LIMIT_EXCEEDED",
      "Integration record response exceeds the compatibility result limit"
    );
  }
  return value;
}
