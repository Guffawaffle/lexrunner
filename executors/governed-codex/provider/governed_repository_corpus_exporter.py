#!/usr/bin/env python3
"""Emit one bounded, credential-free, exact-commit repository review corpus."""

from __future__ import annotations

import hashlib
import json
import os
import stat
import struct
import subprocess
import sys
from pathlib import Path, PurePosixPath
from typing import Any, Iterable


PROTOCOL_VERSION = "1.0.0"
MAX_REQUEST_BYTES = 256 * 1024
MAX_HEADER_BYTES = 2 * 1024 * 1024
MAX_FILE_BYTES = 4 * 1024 * 1024
MAX_TREE_BYTES = 32 * 1024 * 1024
MAX_PATCH_BYTES = 8 * 1024 * 1024
MAX_FILES = 4_096
MAX_GIT_METADATA_BYTES = 4 * 1024 * 1024
GIT = Path("/usr/bin/git")


class ExportError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise ExportError(message)


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode(
        "utf-8"
    )


def canonical_hash(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_bytes(value)).hexdigest()


def content_hash(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def git_blob_object_id(value: bytes, expected: str) -> str:
    algorithm = hashlib.sha1 if len(expected) == 40 else hashlib.sha256
    framed = b"blob " + str(len(value)).encode("ascii") + b"\0" + value
    return algorithm(framed).hexdigest()


def require_keys(value: dict[str, Any], required: Iterable[str], field: str) -> None:
    if set(value) != set(required):
        fail(f"{field} has unexpected or missing fields")


def require_string(value: Any, field: str, maximum: int = 16_384) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum or "\0" in value:
        fail(f"{field} is not a bounded string")
    return value


def require_hash(value: Any, field: str) -> str:
    candidate = require_string(value, field, 71)
    if len(candidate) != 71 or not candidate.startswith("sha256:"):
        fail(f"{field} is not a SHA-256 reference")
    try:
        int(candidate[7:], 16)
    except ValueError as error:
        raise ExportError(f"{field} is not a SHA-256 reference") from error
    return candidate


def require_git_id(value: Any, field: str) -> str:
    candidate = require_string(value, field, 64)
    if len(candidate) not in (40, 64):
        fail(f"{field} is not a full Git object identifier")
    try:
        int(candidate, 16)
    except ValueError as error:
        raise ExportError(f"{field} is not a full Git object identifier") from error
    if candidate.lower() != candidate:
        fail(f"{field} must be lowercase")
    return candidate


def require_absolute_path(value: Any, field: str) -> Path:
    candidate = Path(require_string(value, field))
    if not candidate.is_absolute() or "\\" in str(candidate):
        fail(f"{field} must be a native absolute Linux path")
    return candidate


def directory_identity(path: Path, field: str) -> dict[str, str]:
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        fail(f"{field} must be a real directory")
    return {"device": str(info.st_dev), "inode": str(info.st_ino)}


def require_identity(value: Any, field: str) -> dict[str, str]:
    if not isinstance(value, dict):
        fail(f"{field} must be an identity object")
    require_keys(value, ("device", "inode"), field)
    identity: dict[str, str] = {}
    for name in ("device", "inode"):
        candidate = require_string(value[name], f"{field}.{name}", 32)
        if not candidate.isdecimal() or (candidate.startswith("0") and candidate != "0"):
            fail(f"{field}.{name} must be a canonical decimal integer")
        identity[name] = candidate
    return identity


def assert_identity(path: Path, expected: dict[str, str], field: str) -> None:
    if directory_identity(path, field) != expected:
        fail(f"{field} identity changed")


def is_strictly_within(candidate: Path, root: Path) -> bool:
    try:
        candidate.relative_to(root)
    except ValueError:
        return False
    return candidate != root


def git_environment() -> dict[str, str]:
    return {
        "PATH": "/usr/bin:/bin",
        "HOME": "/nonexistent",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_OPTIONAL_LOCKS": "0",
        "GIT_NO_REPLACE_OBJECTS": "1",
    }


def git_command(worktree: Path, arguments: Iterable[str]) -> list[str]:
    return [
        str(GIT),
        "--no-optional-locks",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        "-c",
        f"safe.directory={worktree}",
        "-C",
        str(worktree),
        *arguments,
    ]


def run_git(
    worktree: Path,
    arguments: Iterable[str],
    *,
    maximum: int,
    expected_codes: tuple[int, ...] = (0,),
) -> tuple[int, bytes]:
    completed = subprocess.run(
        git_command(worktree, arguments),
        check=False,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        env=git_environment(),
        timeout=60,
    )
    if completed.returncode not in expected_codes:
        fail("bounded Git inspection failed")
    if len(completed.stdout) > maximum:
        fail("bounded Git inspection exceeded its output limit")
    return completed.returncode, completed.stdout


def git_text(worktree: Path, arguments: Iterable[str], field: str) -> str:
    _code, output = run_git(worktree, arguments, maximum=64 * 1024)
    try:
        value = output.decode("utf-8", errors="strict").strip()
    except UnicodeDecodeError as error:
        raise ExportError(f"{field} was not UTF-8") from error
    return require_string(value, field)


def parse_request() -> dict[str, Any]:
    payload = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if not payload or len(payload) > MAX_REQUEST_BYTES:
        fail("export request is outside its bound")
    try:
        value = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ExportError("export request is not valid JSON") from error
    if not isinstance(value, dict):
        fail("export request must be an object")
    require_keys(
        value,
        (
            "schema_version",
            "environment_id",
            "repository_id",
            "attempt_id",
            "workspace_lease_id",
            "task_packet_hash",
            "launch_envelope_hash",
            "path_mapping_hash",
            "base_object_id",
            "host_id",
            "git_runtime",
            "branch",
            "repository_root",
            "allocation_root",
            "worktree_root",
            "directory_identities",
        ),
        "export request",
    )
    if value["schema_version"] != PROTOCOL_VERSION:
        fail("export request schema version is unsupported")
    for field in ("environment_id", "repository_id", "attempt_id", "workspace_lease_id"):
        require_string(value[field], field, 256)
    for field in ("task_packet_hash", "launch_envelope_hash", "path_mapping_hash"):
        require_hash(value[field], field)
    require_git_id(value["base_object_id"], "base_object_id")
    for field in ("host_id", "git_runtime", "branch"):
        require_string(value[field], field, 4_096)
    identities = value["directory_identities"]
    if not isinstance(identities, dict):
        fail("directory_identities must be an object")
    require_keys(identities, ("repository", "allocation", "worktree"), "directory_identities")
    for field in identities:
        require_identity(identities[field], f"directory_identities.{field}")
    return value


def validate_live_workspace(request: dict[str, Any]) -> tuple[Path, Path, Path, str]:
    repository = require_absolute_path(request["repository_root"], "repository_root").resolve()
    allocation = require_absolute_path(request["allocation_root"], "allocation_root").resolve()
    worktree = require_absolute_path(request["worktree_root"], "worktree_root").resolve()
    identities = request["directory_identities"]
    assert_identity(repository, identities["repository"], "repository_root")
    assert_identity(allocation, identities["allocation"], "allocation_root")
    assert_identity(worktree, identities["worktree"], "worktree_root")
    if not is_strictly_within(worktree, allocation):
        fail("Attempt worktree is outside its allocation root")

    _code, replacement_refs = run_git(
        worktree,
        ("for-each-ref", "--format=%(refname)", "refs/replace"),
        maximum=64 * 1024,
    )
    if replacement_refs:
        fail("Git replacement refs are forbidden in an exact repository corpus")

    top_level = Path(git_text(worktree, ("rev-parse", "--show-toplevel"), "Git top level")).resolve()
    if top_level != worktree:
        fail("Git top level does not match the bound Attempt worktree")
    common_value = Path(git_text(worktree, ("rev-parse", "--git-common-dir"), "Git common directory"))
    common = (worktree / common_value).resolve() if not common_value.is_absolute() else common_value.resolve()
    expected_common = (repository / ".git").resolve()
    if common != expected_common or not is_strictly_within(common, repository):
        fail("Git common directory does not match the bound native repository")
    git_directory = Path(
        git_text(worktree, ("rev-parse", "--absolute-git-dir"), "Git worktree directory")
    ).resolve()
    if not is_strictly_within(git_directory, common):
        fail("Git worktree administration escaped the bound native repository")

    marker_path = git_directory / "lexrunner-attempt.json"
    marker_info = marker_path.lstat()
    if not stat.S_ISREG(marker_info.st_mode) or stat.S_ISLNK(marker_info.st_mode):
        fail("Attempt marker is not a regular file")
    if marker_info.st_size <= 0 or marker_info.st_size > 64 * 1024:
        fail("Attempt marker is outside its bound")
    try:
        marker = json.loads(marker_path.read_bytes())
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ExportError("Attempt marker is invalid") from error
    expected_marker = {
        "schemaVersion": 1,
        "repositoryId": request["repository_id"],
        "attemptId": request["attempt_id"],
        "hostId": request["host_id"],
        "gitRuntime": request["git_runtime"],
        "projectRoot": str(repository),
        "worktreePath": str(worktree),
        "branch": request["branch"],
        "baseSha": request["base_object_id"],
    }
    if marker != expected_marker:
        fail("Attempt marker does not match the durable workspace binding")

    branch = git_text(worktree, ("branch", "--show-current"), "Git branch")
    if branch != request["branch"]:
        fail("Attempt branch changed before corpus export")
    candidate = require_git_id(
        git_text(worktree, ("rev-parse", "--verify", "HEAD^{commit}"), "candidate object"),
        "candidate_object_id",
    )
    if candidate == request["base_object_id"]:
        fail("Repository review candidate must differ from its base")
    base = git_text(
        worktree,
        ("rev-parse", "--verify", f"{request['base_object_id']}^{{commit}}"),
        "base object",
    )
    if base != request["base_object_id"]:
        fail("Attempt base object is unavailable")
    code, _output = run_git(
        worktree,
        ("merge-base", "--is-ancestor", request["base_object_id"], candidate),
        maximum=1,
        expected_codes=(0, 1),
    )
    if code != 0:
        fail("Repository review candidate does not descend from the Attempt base")
    _code, status = run_git(
        worktree,
        ("status", "--porcelain=v1", "-z", "--ignored=matching", "--untracked-files=all"),
        maximum=MAX_GIT_METADATA_BYTES,
    )
    if status:
        fail("Attempt worktree must be completely clean before corpus export")
    return repository, allocation, worktree, candidate


def parse_tree(worktree: Path, candidate: str) -> list[dict[str, Any]]:
    _code, output = run_git(
        worktree,
        ("ls-tree", "-rz", "--full-tree", candidate),
        maximum=MAX_GIT_METADATA_BYTES,
    )
    entries: list[dict[str, Any]] = []
    previous = ""
    for raw in output.split(b"\0"):
        if not raw:
            continue
        metadata, separator, path_bytes = raw.partition(b"\t")
        if not separator:
            fail("Git tree entry is malformed")
        parts = metadata.split(b" ")
        if len(parts) != 3:
            fail("Git tree metadata is malformed")
        try:
            mode = parts[0].decode("ascii")
            object_type = parts[1].decode("ascii")
            object_id = require_git_id(parts[2].decode("ascii"), "tree object")
            path = path_bytes.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise ExportError("Repository paths must be UTF-8") from error
        canonical = PurePosixPath(path)
        if (
            not path
            or path.startswith("/")
            or path.endswith("/")
            or "\\" in path
            or str(canonical) != path
            or any(part in ("", ".", "..") or part.lower() == ".git" for part in canonical.parts)
            or len(path) > 1_024
        ):
            fail("Repository tree contains a non-canonical or administrative path")
        if path <= previous:
            fail("Repository tree paths are not strictly ordered")
        previous = path
        if object_type != "blob" or mode not in ("100644", "100755"):
            fail("Repository corpus permits only regular non-symlink tracked files")
        entries.append(
            {
                "path": path,
                "object_id": object_id,
                "executable": mode == "100755",
            }
        )
        if len(entries) > MAX_FILES:
            fail("Repository corpus file count exceeds its bound")
    if not entries:
        fail("Repository corpus candidate tree is empty")
    return entries


def read_blobs(worktree: Path, entries: list[dict[str, Any]]) -> list[bytes]:
    request = b"".join(entry["object_id"].encode("ascii") + b"\n" for entry in entries)
    process = subprocess.Popen(
        git_command(worktree, ("cat-file", "--batch")),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        env=git_environment(),
    )
    try:
        output, _stderr = process.communicate(input=request, timeout=60)
    except subprocess.TimeoutExpired as error:
        process.kill()
        process.wait(timeout=10)
        raise ExportError("Git object export timed out") from error
    if process.returncode != 0 or len(output) > MAX_TREE_BYTES + MAX_GIT_METADATA_BYTES:
        fail("Git object export failed or exceeded its bound")
    blobs: list[bytes] = []
    offset = 0
    total = 0
    for entry in entries:
        newline = output.find(b"\n", offset)
        if newline < 0:
            fail("Git object export header is truncated")
        try:
            header = output[offset:newline].decode("ascii").split(" ")
        except UnicodeDecodeError as error:
            raise ExportError("Git object export header is invalid") from error
        if len(header) != 3 or header[0] != entry["object_id"] or header[1] != "blob":
            fail("Git object export binding is invalid")
        try:
            size = int(header[2])
        except ValueError as error:
            raise ExportError("Git object export size is invalid") from error
        if size < 0 or size > MAX_FILE_BYTES:
            fail("Repository corpus file exceeds its bound")
        start = newline + 1
        end = start + size
        if end >= len(output) or output[end : end + 1] != b"\n":
            fail("Git object export payload is truncated")
        content = output[start:end]
        if git_blob_object_id(content, entry["object_id"]) != entry["object_id"]:
            fail("Git blob content does not match its tree object identifier")
        blobs.append(content)
        entry["byte_length"] = size
        entry["content_hash"] = content_hash(content)
        total += size
        if total > MAX_TREE_BYTES:
            fail("Repository corpus tree exceeds its byte bound")
        offset = end + 1
    if offset != len(output):
        fail("Git object export contains trailing bytes")
    return blobs


def export_patch(worktree: Path, base: str, candidate: str) -> bytes:
    _code, patch = run_git(
        worktree,
        (
            "diff",
            "--binary",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            base,
            candidate,
            "--",
        ),
        maximum=MAX_PATCH_BYTES,
    )
    if not patch:
        fail("Repository review candidate has no base-to-candidate patch")
    return patch


def export() -> None:
    request = parse_request()
    repository, allocation, worktree, candidate = validate_live_workspace(request)
    entries = parse_tree(worktree, candidate)
    blobs = read_blobs(worktree, entries)
    patch = export_patch(worktree, request["base_object_id"], candidate)

    identities = request["directory_identities"]
    assert_identity(repository, identities["repository"], "repository_root")
    assert_identity(allocation, identities["allocation"], "allocation_root")
    assert_identity(worktree, identities["worktree"], "worktree_root")
    current = git_text(worktree, ("rev-parse", "--verify", "HEAD^{commit}"), "candidate object")
    if current != candidate:
        fail("Candidate changed during repository corpus export")
    _code, status = run_git(
        worktree,
        ("status", "--porcelain=v1", "-z", "--ignored=matching", "--untracked-files=all"),
        maximum=MAX_GIT_METADATA_BYTES,
    )
    if status:
        fail("Attempt worktree changed during repository corpus export")

    public_entries = [
        {
            "path": entry["path"],
            "object_id": entry["object_id"],
            "byte_length": entry["byte_length"],
            "content_hash": entry["content_hash"],
            "executable": entry["executable"],
        }
        for entry in entries
    ]
    source_binding = {
        "attempt_id": request["attempt_id"],
        "workspace_lease_id": request["workspace_lease_id"],
        "task_packet_hash": request["task_packet_hash"],
        "launch_envelope_hash": request["launch_envelope_hash"],
        "path_mapping_hash": request["path_mapping_hash"],
    }
    source_binding_hash = canonical_hash(source_binding)
    candidate_tree_hash = canonical_hash(
        {"kind": "governed-repository-candidate-tree-v1", "entries": public_entries}
    )
    selection_hash = canonical_hash(
        {
            "kind": "governed-repository-selection-v1",
            "repository_id": request["repository_id"],
            "base_object_id": request["base_object_id"],
            "candidate_object_id": candidate,
            "paths": [entry["path"] for entry in public_entries],
        }
    )
    patch_hash = content_hash(patch)
    corpus_hash = canonical_hash(
        {
            "kind": "governed-repository-corpus-v1",
            "source_binding_hash": source_binding_hash,
            "candidate_tree_hash": candidate_tree_hash,
            "patch_hash": patch_hash,
            "selection_hash": selection_hash,
        }
    )
    header = {
        "schema_version": PROTOCOL_VERSION,
        "environment_id": request["environment_id"],
        "repository_id": request["repository_id"],
        "base_object_id": request["base_object_id"],
        "candidate_object_id": candidate,
        "source_binding": source_binding,
        "source_binding_hash": source_binding_hash,
        "entries": public_entries,
        "candidate_tree_bytes": sum(entry["byte_length"] for entry in public_entries),
        "candidate_tree_hash": candidate_tree_hash,
        "patch_bytes": len(patch),
        "patch_hash": patch_hash,
        "selection_hash": selection_hash,
        "corpus_hash": corpus_hash,
    }
    encoded_header = canonical_bytes(header)
    if len(encoded_header) > MAX_HEADER_BYTES:
        fail("Repository corpus header exceeds its bound")
    sys.stdout.buffer.write(struct.pack(">I", len(encoded_header)))
    sys.stdout.buffer.write(encoded_header)
    for blob in blobs:
        sys.stdout.buffer.write(blob)
    sys.stdout.buffer.write(patch)
    sys.stdout.buffer.flush()


def main() -> int:
    try:
        export()
        return 0
    except (ExportError, OSError, subprocess.SubprocessError) as error:
        sys.stderr.write(f"governed-repository-corpus-exporter: {type(error).__name__}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
