import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

import {
  PLAN_ARTIFACT_REFERENCE_CONTRACT,
  ExecutionPlanArtifact_v1Schema,
  PlanArtifactReference_v1Schema,
  PlanArtifactScope_v1Schema,
  type ExecutionPlanArtifact_v1,
  type PlanArtifactReference_v1,
  type PlanArtifactScope_v1,
} from "./execution-plan-artifact.js";
import { PlanArtifactService, PlanArtifactServiceError } from "./plan-artifact-service.js";

export type PlanArtifactRegistrationFailureCode =
  | "PLAN_REGISTRATION_INVALID"
  | "PLAN_REGISTRATION_UNSAFE"
  | "PLAN_REGISTRATION_CONFLICT"
  | "PLAN_REGISTRATION_VERIFY_FAILED";

export class PlanArtifactRegistrationError extends Error {
  constructor(
    readonly code: PlanArtifactRegistrationFailureCode,
    message: string
  ) {
    super(message);
    this.name = "PlanArtifactRegistrationError";
  }
}

export interface RegisterPlanArtifactInput {
  artifact: ExecutionPlanArtifact_v1;
  storeDirectory: string;
  scope?: PlanArtifactScope_v1;
}

export interface RegisteredPlanArtifact {
  artifact: ExecutionPlanArtifact_v1;
  reference: PlanArtifactReference_v1;
  created: boolean;
  storage: {
    assurance: "service-no-replace-verified";
    authority: "unverified";
  };
}

/**
 * Minimal service-level no-replace content-addressed storage for ADR-012 plan
 * bytes. Portable pathname checks and mode bits are not protected store
 * authority; results remain explicitly unverified until a native boundary owns
 * the store.
 *
 * This service does not select, archive, supersede, or grant authority to an
 * artifact. It also does not delete crash-left ambiguous links; durable
 * publication recovery belongs to the reference-safe retention slice. Those
 * coordination operations belong to later ADR-012 slices.
 */
export class PlanArtifactRegistrationService {
  register(input: RegisterPlanArtifactInput): RegisteredPlanArtifact {
    const parsed = ExecutionPlanArtifact_v1Schema.safeParse(input.artifact);
    if (!parsed.success) {
      throw new PlanArtifactRegistrationError(
        "PLAN_REGISTRATION_INVALID",
        "The plan artifact does not satisfy the immutable artifact contract"
      );
    }
    const artifact = parsed.data;
    const scope = parseScope(input.scope);
    const storeDirectory = validateStoreReference(input.storeDirectory);
    prepareControlledStore(storeDirectory);

    const digestName = `${artifact.identity.digest.slice("sha256:".length)}.json`;
    const artifactPath = path.join(storeDirectory, digestName);
    const reference = createRegisteredReference(artifact, artifactPath, scope);

    if (pathEntryExists(artifactPath)) {
      return this.#verifyExisting(artifact, reference, false);
    }

    const temporaryPath = path.join(storeDirectory, `.plan-${randomUUID()}.tmp`);
    let temporaryCreated = false;
    try {
      const descriptor = fs.openSync(
        temporaryPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
        0o600
      );
      temporaryCreated = true;
      try {
        writeAll(descriptor, Buffer.from(artifact.canonicalBytes, "utf8"));
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }

      try {
        // Linking is the portable no-replace publication primitive. A rename
        // would overwrite on some supported platforms and is therefore rejected.
        fs.linkSync(temporaryPath, artifactPath);
      } catch (error) {
        if (!pathEntryExists(artifactPath)) throw error;
        return this.#verifyExisting(artifact, reference, false);
      }
      try {
        fs.unlinkSync(temporaryPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      temporaryCreated = false;
      flushDirectoryWhenSupported(storeDirectory);
      assertStoreDirectory(storeDirectory);
      return this.#verifyExisting(artifact, reference, true);
    } catch (error) {
      if (error instanceof PlanArtifactRegistrationError) throw error;
      throw new PlanArtifactRegistrationError(
        "PLAN_REGISTRATION_UNSAFE",
        "The plan artifact could not be published without replacing existing bytes"
      );
    } finally {
      if (temporaryCreated) {
        try {
          fs.unlinkSync(temporaryPath);
        } catch {
          // An unreachable temporary object is never an artifact reference.
        }
      }
    }
  }

  #verifyExisting(
    artifact: ExecutionPlanArtifact_v1,
    reference: PlanArtifactReference_v1,
    created: boolean
  ): RegisteredPlanArtifact {
    try {
      waitForConcurrentPublisher(reference.retrieval.reference);
      const resolved = new PlanArtifactService().resolve({ planReference: reference });
      if (resolved.artifact.canonicalBytes !== artifact.canonicalBytes) {
        throw new PlanArtifactRegistrationError(
          "PLAN_REGISTRATION_CONFLICT",
          "The content-addressed plan object conflicts with the requested artifact"
        );
      }
      return {
        artifact: resolved.artifact,
        reference,
        created,
        storage: { assurance: "service-no-replace-verified", authority: "unverified" },
      };
    } catch (error) {
      if (error instanceof PlanArtifactRegistrationError) throw error;
      if (error instanceof PlanArtifactServiceError && error.code === "PLAN_REFERENCE_MISMATCH") {
        throw new PlanArtifactRegistrationError(
          "PLAN_REGISTRATION_CONFLICT",
          "The content-addressed plan object conflicts with the requested artifact"
        );
      }
      throw new PlanArtifactRegistrationError(
        "PLAN_REGISTRATION_VERIFY_FAILED",
        "The persisted plan artifact could not be reread and verified"
      );
    }
  }
}

function createRegisteredReference(
  artifact: ExecutionPlanArtifact_v1,
  artifactPath: string,
  scope?: PlanArtifactScope_v1
): PlanArtifactReference_v1 {
  if (Buffer.byteLength(artifactPath, "utf8") > 4_096) {
    throw new PlanArtifactRegistrationError(
      "PLAN_REGISTRATION_INVALID",
      "The artifact store cannot produce a bounded retrieval reference"
    );
  }
  const reference = {
    contract: PLAN_ARTIFACT_REFERENCE_CONTRACT,
    artifact: artifact.identity,
    expectedDigest: artifact.identity.digest,
    expectedCanonicalByteLength: artifact.identity.canonicalByteLength,
    retrieval: { kind: "registered", reference: artifactPath },
    ...(scope ? { scope } : {}),
  };
  const parsed = PlanArtifactReference_v1Schema.safeParse(reference);
  if (!parsed.success) {
    throw new PlanArtifactRegistrationError(
      "PLAN_REGISTRATION_INVALID",
      "The registered artifact reference does not satisfy the bounded transport contract"
    );
  }
  return parsed.data;
}

function parseScope(scope: PlanArtifactScope_v1 | undefined): PlanArtifactScope_v1 | undefined {
  if (scope === undefined) return undefined;
  const parsed = PlanArtifactScope_v1Schema.safeParse(scope);
  if (!parsed.success) {
    throw new PlanArtifactRegistrationError(
      "PLAN_REGISTRATION_INVALID",
      "The plan scope does not satisfy the bounded transport contract"
    );
  }
  return parsed.data;
}

function validateStoreReference(reference: string): string {
  if (
    reference.length === 0 ||
    reference.includes("\0") ||
    Buffer.byteLength(reference, "utf8") > 4_096
  ) {
    throw new PlanArtifactRegistrationError(
      "PLAN_REGISTRATION_INVALID",
      "The artifact store reference is invalid or exceeds its bound"
    );
  }
  return path.resolve(reference);
}

function prepareControlledStore(storeDirectory: string): void {
  const root = path.parse(storeDirectory).root;
  const segments = path.relative(root, storeDirectory).split(path.sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const stats = fs.lstatSync(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new PlanArtifactRegistrationError(
          "PLAN_REGISTRATION_UNSAFE",
          "The artifact store contains an unsafe filesystem object"
        );
      }
    } catch (error) {
      if (error instanceof PlanArtifactRegistrationError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new PlanArtifactRegistrationError(
          "PLAN_REGISTRATION_UNSAFE",
          "The artifact store identity is unavailable"
        );
      }
      try {
        fs.mkdirSync(current, { mode: 0o700 });
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") {
          throw new PlanArtifactRegistrationError(
            "PLAN_REGISTRATION_UNSAFE",
            "The artifact store could not be prepared"
          );
        }
      }
      const created = fs.lstatSync(current);
      if (created.isSymbolicLink() || !created.isDirectory()) {
        throw new PlanArtifactRegistrationError(
          "PLAN_REGISTRATION_UNSAFE",
          "The artifact store contains an unsafe filesystem object"
        );
      }
    }
  }
  assertStoreDirectory(storeDirectory);
}

function assertStoreDirectory(storeDirectory: string): void {
  const root = path.parse(storeDirectory).root;
  const segments = path.relative(root, storeDirectory).split(path.sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(current);
    } catch {
      throw new PlanArtifactRegistrationError(
        "PLAN_REGISTRATION_UNSAFE",
        "The artifact store identity is unavailable"
      );
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new PlanArtifactRegistrationError(
        "PLAN_REGISTRATION_UNSAFE",
        "The artifact store contains an unsafe filesystem object"
      );
    }
  }
}

function writeAll(descriptor: number, bytes: Buffer): void {
  let offset = 0;
  while (offset < bytes.length) {
    offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset, null);
  }
}

function flushDirectoryWhenSupported(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (process.platform !== "win32" || (code !== "EISDIR" && code !== "EPERM")) throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function pathEntryExists(filePath: string): boolean {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code !== "ENOENT" && code !== "ENOTDIR";
  }
}

function waitForConcurrentPublisher(artifactPath: string): void {
  const deadline = Date.now() + 500;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline) {
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(artifactPath);
    } catch {
      return;
    }
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink <= 1) return;
    // A clean concurrent publisher removes only its own temporary link. This
    // service never guesses alias ownership or unlinks an ambiguous entry. A
    // crash-left or forged hard link therefore remains a fail-closed condition.
    Atomics.wait(signal, 0, 0, 10);
  }
}
