export interface GitWorktreePorcelainRecord {
  worktree: string;
  head?: string;
  branch?: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  lockedReason?: string;
  prunable: boolean;
  prunableReason?: string;
  unknownFields: Array<{ name: string; value?: string }>;
}

export type GitStatusEntryKind = "ordinary" | "renamed" | "copied" | "untracked" | "ignored";

export interface GitStatusPorcelainV1Record {
  indexStatus: string;
  worktreeStatus: string;
  path: string;
  originalPath?: string;
  kind: GitStatusEntryKind;
}

type PorcelainInput = string | Uint8Array;

/** Parse `git worktree list --porcelain -z` without interpreting runtime-local paths. */
export function parseGitWorktreePorcelainZ(input: PorcelainInput): GitWorktreePorcelainRecord[] {
  const fields = splitNullTerminated(input, "git worktree porcelain");
  const records: GitWorktreePorcelainRecord[] = [];
  let current: Partial<GitWorktreePorcelainRecord> | undefined;

  const finishRecord = (): void => {
    if (current === undefined) return;
    if (current.worktree === undefined || current.worktree.length === 0) {
      throw new Error("Malformed git worktree porcelain: record is missing a worktree path");
    }
    records.push({
      worktree: current.worktree,
      ...(current.head === undefined ? {} : { head: current.head }),
      ...(current.branch === undefined ? {} : { branch: current.branch }),
      bare: current.bare ?? false,
      detached: current.detached ?? false,
      locked: current.locked ?? false,
      ...(current.lockedReason === undefined ? {} : { lockedReason: current.lockedReason }),
      prunable: current.prunable ?? false,
      ...(current.prunableReason === undefined ? {} : { prunableReason: current.prunableReason }),
      unknownFields: current.unknownFields ?? [],
    });
    current = undefined;
  };

  for (const field of fields) {
    if (field.length === 0) {
      finishRecord();
      continue;
    }

    const separator = field.indexOf(" ");
    const name = separator === -1 ? field : field.slice(0, separator);
    const value = separator === -1 ? undefined : field.slice(separator + 1);

    if (name === "worktree") {
      // A missing blank separator should not silently merge two records.
      finishRecord();
      if (value === undefined || value.length === 0) {
        throw new Error("Malformed git worktree porcelain: worktree path is empty");
      }
      current = { worktree: value, unknownFields: [] };
      continue;
    }
    if (current === undefined) {
      throw new Error(`Malformed git worktree porcelain: ${name} appears before worktree`);
    }

    switch (name) {
      case "HEAD":
        setOnce(current, "head", requiredValue(name, value));
        break;
      case "branch":
        setOnce(current, "branch", requiredValue(name, value));
        break;
      case "bare":
        current.bare = true;
        break;
      case "detached":
        current.detached = true;
        break;
      case "locked":
        current.locked = true;
        if (value !== undefined && value.length > 0) current.lockedReason = value;
        break;
      case "prunable":
        current.prunable = true;
        if (value !== undefined && value.length > 0) current.prunableReason = value;
        break;
      default:
        current.unknownFields?.push({ name, ...(value === undefined ? {} : { value }) });
    }
  }

  finishRecord();
  return records;
}

/** Parse `git status --porcelain=v1 -z --ignored=matching --untracked-files=all`. */
export function parseGitStatusPorcelainV1Z(input: PorcelainInput): GitStatusPorcelainV1Record[] {
  const fields = splitNullTerminated(input, "git status porcelain");
  const records: GitStatusPorcelainV1Record[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field.length === 0) {
      throw new Error("Malformed git status porcelain: unexpected empty record");
    }
    if (field.length < 4 || field[2] !== " ") {
      throw new Error("Malformed git status porcelain: expected an XY status and path");
    }

    const indexStatus = field[0];
    const worktreeStatus = field[1];
    const path = field.slice(3);
    if (path.length === 0) {
      throw new Error("Malformed git status porcelain: path is empty");
    }

    const renameOrCopy = [indexStatus, worktreeStatus].find(
      (status) => status === "R" || status === "C"
    );
    let originalPath: string | undefined;
    if (renameOrCopy !== undefined) {
      originalPath = fields[index + 1];
      if (originalPath === undefined || originalPath.length === 0) {
        throw new Error("Malformed git status porcelain: rename/copy source path is missing");
      }
      index += 1;
    }

    const kind: GitStatusEntryKind =
      indexStatus === "?" && worktreeStatus === "?"
        ? "untracked"
        : indexStatus === "!" && worktreeStatus === "!"
          ? "ignored"
          : renameOrCopy === "R"
            ? "renamed"
            : renameOrCopy === "C"
              ? "copied"
              : "ordinary";

    records.push({
      indexStatus,
      worktreeStatus,
      path,
      ...(originalPath === undefined ? {} : { originalPath }),
      kind,
    });
  }

  return records;
}

function splitNullTerminated(input: PorcelainInput, label: string): string[] {
  const text = typeof input === "string" ? input : Buffer.from(input).toString("utf8");
  if (text.length === 0) return [];
  if (!text.endsWith("\0")) {
    throw new Error(`Malformed ${label}: output is not NUL terminated`);
  }
  return text.slice(0, -1).split("\0");
}

function requiredValue(name: string, value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`Malformed git worktree porcelain: ${name} value is empty`);
  }
  return value;
}

function setOnce<K extends "head" | "branch">(
  record: Partial<GitWorktreePorcelainRecord>,
  key: K,
  value: string
): void {
  if (record[key] !== undefined) {
    throw new Error(`Malformed git worktree porcelain: duplicate ${key} field`);
  }
  record[key] = value;
}
