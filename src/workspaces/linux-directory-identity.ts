import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readlinkSync,
  statfsSync,
} from "node:fs";
import { platform } from "node:os";
import path from "node:path";

const DIRECTORY_OPEN_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const PROC_FD_ROOT = `/proc/${process.pid}/fd`;
const UNSUPPORTED_WSL_FILESYSTEM_TYPES = new Set([0x01021997n, 0x53464846n]);

export type DirectoryBoundaryErrorCode =
  "unsupported_platform" | "invalid_path" | "identity_changed";

export type DirectoryBoundaryReasonCode =
  | "native_linux_ready"
  | "windows_native_boundary_unavailable"
  | "macos_unsupported"
  | "unsupported_platform"
  | "case_insensitive_runtime"
  | "procfs_unavailable"
  | "invalid_native_path"
  | "path_unavailable"
  | "filesystem_unverified"
  | "wsl_drvfs_9p"
  | "identity_changed";

export class DirectoryBoundaryError extends Error {
  constructor(
    readonly code: DirectoryBoundaryErrorCode,
    message: string,
    readonly originalCause?: unknown,
    readonly reasonCode?: DirectoryBoundaryReasonCode
  ) {
    super(message);
    this.name = "DirectoryBoundaryError";
  }
}

export interface DirectoryIdentity {
  readonly path: string;
  readonly device: bigint;
  readonly inode: bigint;
}

export interface AnchoredDirectory extends DirectoryIdentity {
  readonly fd: number;
  readonly procPath: string;
  close(): void;
}

export type DirectoryIdentityBoundarySupport =
  | {
      readonly supported: true;
      readonly platform: NodeJS.Platform;
      readonly pathComparison: "case-sensitive";
      readonly reasonCode: "native_linux_ready";
    }
  | {
      readonly supported: false;
      readonly platform: NodeJS.Platform;
      readonly pathComparison: "case-sensitive" | "case-insensitive";
      readonly reasonCode:
        | "windows_native_boundary_unavailable"
        | "macos_unsupported"
        | "unsupported_platform"
        | "case_insensitive_runtime"
        | "procfs_unavailable";
    };

export interface DirectoryIdentityPathProbe {
  readonly verified: boolean;
  readonly filesystem: "native_linux" | "wsl_drvfs_9p" | "unknown";
  readonly reasonCode:
    | "directory_verified"
    | "wsl_drvfs_9p"
    | "invalid_native_path"
    | "path_unavailable"
    | "filesystem_unverified";
}

export interface DirectoryIdentityBoundaryFacts {
  readonly platform: NodeJS.Platform;
  readonly pathComparison: "case-sensitive" | "case-insensitive";
  readonly procfsAvailable: boolean;
}

/** Pure policy evaluation shared by construction-time checks and read-only preflight. */
export function evaluateDirectoryIdentityBoundarySupport(
  facts: DirectoryIdentityBoundaryFacts
): DirectoryIdentityBoundarySupport {
  if (facts.platform === "win32") {
    return {
      supported: false,
      platform: facts.platform,
      pathComparison: facts.pathComparison,
      reasonCode: "windows_native_boundary_unavailable",
    };
  }
  if (facts.platform === "darwin") {
    return {
      supported: false,
      platform: facts.platform,
      pathComparison: facts.pathComparison,
      reasonCode: "macos_unsupported",
    };
  }
  if (facts.platform !== "linux") {
    return {
      supported: false,
      platform: facts.platform,
      pathComparison: facts.pathComparison,
      reasonCode: "unsupported_platform",
    };
  }
  if (facts.pathComparison !== "case-sensitive") {
    return {
      supported: false,
      platform: facts.platform,
      pathComparison: facts.pathComparison,
      reasonCode: "case_insensitive_runtime",
    };
  }
  if (!facts.procfsAvailable) {
    return {
      supported: false,
      platform: facts.platform,
      pathComparison: facts.pathComparison,
      reasonCode: "procfs_unavailable",
    };
  }
  return {
    supported: true,
    platform: facts.platform,
    pathComparison: facts.pathComparison,
    reasonCode: "native_linux_ready",
  };
}

/** Inspect the current process boundary without creating directories or invoking Git. */
export function probeDirectoryIdentityBoundarySupport(
  pathComparison: "case-sensitive" | "case-insensitive"
): DirectoryIdentityBoundarySupport {
  const runtimePlatform = platform();
  let procfsAvailable = false;
  if (runtimePlatform === "linux" && pathComparison === "case-sensitive") {
    try {
      procfsAvailable = lstatSync(PROC_FD_ROOT).isDirectory();
    } catch {
      procfsAvailable = false;
    }
  }
  return evaluateDirectoryIdentityBoundarySupport({
    platform: runtimePlatform,
    pathComparison,
    procfsAvailable,
  });
}

/**
 * The broker's identity boundary currently depends on Linux procfs directory
 * descriptors. Other kernels, case-insensitive runtimes, and WSL DrvFS/9P
 * mounts fail closed until they have equivalent tested semantics.
 */
export function assertDirectoryIdentityBoundarySupported(
  pathComparison: "case-sensitive" | "case-insensitive"
): void {
  const support = probeDirectoryIdentityBoundarySupport(pathComparison);
  if (support.supported) return;
  throw new DirectoryBoundaryError(
    "unsupported_platform",
    boundarySupportMessage(support.reasonCode),
    undefined,
    support.reasonCode
  );
}

/** Capture the exact directory object named by an absolute, symlink-free path. */
export function captureDirectoryIdentity(absolutePath: string, label: string): DirectoryIdentity {
  const directory = openAbsoluteDirectory(absolutePath, label);
  try {
    assertSupportedFilesystem(directory, label);
    const currentPath = currentDirectoryPath(directory, label);
    if (currentPath !== directory.path) {
      throw new DirectoryBoundaryError(
        "invalid_path",
        `${label} must use its exact native spelling and may not traverse aliases or symlinks`,
        undefined,
        "path_unavailable"
      );
    }
    return identityOf(directory);
  } finally {
    directory.close();
  }
}

/** Return a bounded path capability result without exposing the inspected path or OS error text. */
export function probeDirectoryIdentityPath(
  absolutePath: string,
  label: string
): DirectoryIdentityPathProbe {
  try {
    captureDirectoryIdentity(absolutePath, label);
    return { verified: true, filesystem: "native_linux", reasonCode: "directory_verified" };
  } catch (error) {
    if (error instanceof DirectoryBoundaryError) {
      if (error.reasonCode === "wsl_drvfs_9p") {
        return { verified: false, filesystem: "wsl_drvfs_9p", reasonCode: "wsl_drvfs_9p" };
      }
      if (error.reasonCode === "invalid_native_path") {
        return { verified: false, filesystem: "unknown", reasonCode: "invalid_native_path" };
      }
      if (error.reasonCode === "filesystem_unverified") {
        return { verified: false, filesystem: "unknown", reasonCode: "filesystem_unverified" };
      }
    }
    return { verified: false, filesystem: "unknown", reasonCode: "path_unavailable" };
  }
}

function assertSupportedFilesystem(directory: AnchoredDirectory, label: string): void {
  try {
    const type = statfsSync(directory.procPath, { bigint: true }).type;
    if (UNSUPPORTED_WSL_FILESYSTEM_TYPES.has(type)) {
      throw new DirectoryBoundaryError(
        "unsupported_platform",
        `${label} is on a WSL DrvFS/9P mount; physical worktree containment requires a native Linux filesystem`,
        undefined,
        "wsl_drvfs_9p"
      );
    }
  } catch (error) {
    if (error instanceof DirectoryBoundaryError) throw error;
    throw new DirectoryBoundaryError(
      "unsupported_platform",
      `Could not verify the filesystem semantics for ${label}`,
      error,
      "filesystem_unverified"
    );
  }
}

/** Reopen a configured directory and prove it is still the captured object. */
export function reopenDirectoryIdentity(
  expected: DirectoryIdentity,
  label: string
): AnchoredDirectory {
  const directory = openAbsoluteDirectory(expected.path, label);
  if (!sameDirectoryIdentity(directory, expected)) {
    directory.close();
    throw new DirectoryBoundaryError(
      "identity_changed",
      `${label} was replaced after the broker captured its directory identity`,
      undefined,
      "identity_changed"
    );
  }
  return directory;
}

/** Open a direct child without following its final component. */
export function openChildDirectory(
  parent: AnchoredDirectory,
  component: string,
  label: string
): AnchoredDirectory {
  assertPathComponent(component, label);
  const expectedPath = path.join(parent.path, component);
  try {
    return directoryHandle(
      openSync(procChildPath(parent, component), DIRECTORY_OPEN_FLAGS),
      expectedPath
    );
  } catch (error) {
    throw boundaryPathError(label, error);
  }
}

/** Open a child if present; all non-missing cases, including symlinks, fail closed. */
export function tryOpenChildDirectory(
  parent: AnchoredDirectory,
  component: string,
  label: string
): AnchoredDirectory | null {
  try {
    return openChildDirectory(parent, component, label);
  } catch (error) {
    const cause = errorCause(error);
    if (isNodeError(cause) && cause.code === "ENOENT") return null;
    throw error;
  }
}

/** Create one reserved directory through an anchored parent and open its identity. */
export function createChildDirectory(
  parent: AnchoredDirectory,
  component: string,
  label: string
): AnchoredDirectory {
  assertPathComponent(component, label);
  try {
    mkdirSync(procChildPath(parent, component), { mode: 0o700 });
  } catch (error) {
    throw boundaryPathError(label, error);
  }
  return openChildDirectory(parent, component, label);
}

export function identityOf(directory: AnchoredDirectory): DirectoryIdentity {
  return { path: directory.path, device: directory.device, inode: directory.inode };
}

export function sameDirectoryIdentity(
  left: Pick<DirectoryIdentity, "device" | "inode">,
  right: Pick<DirectoryIdentity, "device" | "inode">
): boolean {
  return left.device === right.device && left.inode === right.inode;
}

/**
 * Immediately before a pathname consumer runs, prove the held object is still
 * named at its captured path. The consumer then uses procPath, so a later swap
 * cannot redirect it to a substitute object.
 */
export function assertAnchoredDirectoryLocation(directory: AnchoredDirectory, label: string): void {
  const currentPath = currentDirectoryPath(directory, label);
  if (currentPath !== directory.path) {
    throw new DirectoryBoundaryError(
      "identity_changed",
      `${label} moved after its directory identity was anchored`,
      undefined,
      "identity_changed"
    );
  }
  const reopened = openAbsoluteDirectory(directory.path, label);
  try {
    if (!sameDirectoryIdentity(directory, reopened)) {
      throw new DirectoryBoundaryError(
        "identity_changed",
        `${label} now names a different directory identity`,
        undefined,
        "identity_changed"
      );
    }
  } finally {
    reopened.close();
  }
}

export function procChildPath(parent: AnchoredDirectory, component: string): string {
  assertPathComponent(component, "directory component");
  return path.join(parent.procPath, component);
}

function openAbsoluteDirectory(absolutePath: string, label: string): AnchoredDirectory {
  if (!path.isAbsolute(absolutePath) || absolutePath.includes("\0")) {
    throw new DirectoryBoundaryError(
      "invalid_path",
      `${label} must be a runtime-native absolute path`,
      undefined,
      "invalid_native_path"
    );
  }
  const normalized = path.resolve(absolutePath);
  if (path.parse(normalized).root !== path.sep) {
    throw new DirectoryBoundaryError(
      "invalid_path",
      `${label} is not a supported Linux absolute path`,
      undefined,
      "invalid_native_path"
    );
  }

  let current: AnchoredDirectory;
  try {
    current = directoryHandle(openSync(path.sep, DIRECTORY_OPEN_FLAGS), path.sep);
  } catch (error) {
    throw boundaryPathError(`${label} filesystem root`, error);
  }

  try {
    for (const component of normalized.slice(path.sep.length).split(path.sep).filter(Boolean)) {
      const child = openChildDirectory(current, component, label);
      current.close();
      current = child;
    }
    return current;
  } catch (error) {
    current.close();
    throw error;
  }
}

function directoryHandle(fd: number, expectedPath: string): AnchoredDirectory {
  let closed = false;
  const stats = fstatSync(fd, { bigint: true });
  if (!stats.isDirectory()) {
    closeSync(fd);
    throw new DirectoryBoundaryError(
      "invalid_path",
      `${expectedPath} is not a directory`,
      undefined,
      "path_unavailable"
    );
  }
  return {
    fd,
    procPath: path.join(PROC_FD_ROOT, String(fd)),
    path: expectedPath,
    device: stats.dev,
    inode: stats.ino,
    close() {
      if (closed) return;
      closed = true;
      closeSync(fd);
    },
  };
}

function currentDirectoryPath(directory: AnchoredDirectory, label: string): string {
  try {
    return readlinkSync(directory.procPath);
  } catch (error) {
    throw new DirectoryBoundaryError(
      "invalid_path",
      `Could not resolve the anchored ${label} directory identity`,
      error,
      "path_unavailable"
    );
  }
}

function assertPathComponent(component: string, label: string): void {
  if (
    component.length === 0 ||
    component === "." ||
    component === ".." ||
    component.includes("/") ||
    component.includes("\0")
  ) {
    throw new DirectoryBoundaryError("invalid_path", `${label} contains an unsafe path component`);
  }
}

function boundaryPathError(label: string, error: unknown): DirectoryBoundaryError {
  if (error instanceof DirectoryBoundaryError) return error;
  const suffix = isNodeError(error) && error.code ? ` (${error.code})` : "";
  return new DirectoryBoundaryError(
    "invalid_path",
    `${label} could not be opened as a symlink-free directory${suffix}`,
    error,
    "path_unavailable"
  );
}

function boundarySupportMessage(
  reasonCode: DirectoryIdentityBoundarySupport["reasonCode"]
): string {
  switch (reasonCode) {
    case "windows_native_boundary_unavailable":
      return "Physical worktree containment requires the native Windows workspace boundary";
    case "case_insensitive_runtime":
      return "Physical worktree containment currently requires a case-sensitive Linux Git runtime";
    case "procfs_unavailable":
      return "Physical worktree containment requires an accessible Linux procfs file-descriptor namespace";
    default:
      return "Physical worktree containment requires the Linux directory-identity boundary; macOS and Windows are disabled";
  }
}

function errorCause(error: unknown): unknown {
  return error instanceof DirectoryBoundaryError ? error.originalCause : error;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
