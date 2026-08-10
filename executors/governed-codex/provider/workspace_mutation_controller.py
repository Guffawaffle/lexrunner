#!/usr/bin/env python3
"""Root-owned preparation and discard boundary for disposable mutation workspaces."""

from __future__ import annotations

import argparse
import base64
import binascii
import datetime as dt
import hashlib
import json
import os
import pwd
import re
import shutil
import stat
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any, Iterable


PROTOCOL_VERSION = "1.0.0"
CONTROLLER_ID = "lexrunner.workspace-recovery-controller"
MAX_CONTROL_BYTES = 8 * 1024 * 1024
MAX_SOURCE_BYTES = 4 * 1024 * 1024
MAX_SOURCE_FILE_BYTES = 1 * 1024 * 1024
MAX_SOURCE_FILES = 512
MAX_CHANGED_PATHS = 4_096
MAX_TTL_SECONDS = 60 * 60
OPAQUE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")
SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
WORKSPACE_ID = re.compile(r"^workspace-[0-9a-f]{32}$")
UNSAFE_PATH_PREFIX = "__lexrunner_raw_path__/sha256-"
TEST_MODE = os.environ.get("LEXRUNNER_WORKSPACE_CONTROLLER_TEST_MODE") == "1"


def configured_path(name: str, production: str) -> Path:
    override = os.environ.get(name)
    if override and not TEST_MODE:
        fail(f"{name} is a test-only override")
    return Path(override if override else production)


STATE_ROOT = configured_path(
    "LEXRUNNER_WORKSPACE_CONTROLLER_STATE_ROOT",
    "/var/lib/lexrunner-workspace-controller",
)
WORKSPACES = STATE_ROOT / "workspaces"
RECORDS = STATE_ROOT / "records"
RECEIPTS = STATE_ROOT / "receipts"
WORKSPACE_OWNER = os.environ.get(
    "LEXRUNNER_WORKSPACE_CONTROLLER_OWNER", "lexrunner-provider"
)


class WorkspaceControllerError(RuntimeError):
    pass


class WorkspaceEvidenceIncomplete(WorkspaceControllerError):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def fail(message: str) -> None:
    raise WorkspaceControllerError(message)


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def canonical_hash(value: Any) -> str:
    return content_hash(canonical_bytes(value))


def content_hash(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def instant(value: dt.datetime) -> str:
    return (
        value.astimezone(dt.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def require_exact_keys(value: dict[str, Any], expected: Iterable[str], field: str) -> None:
    if set(value) != set(expected):
        fail(f"{field} has unexpected or missing fields")


def require_opaque(value: Any, field: str) -> str:
    if not isinstance(value, str) or not OPAQUE_ID.fullmatch(value):
        fail(f"{field} is not a bounded opaque identifier")
    return value


def require_hash(value: Any, field: str) -> str:
    if not isinstance(value, str) or not SHA256.fullmatch(value):
        fail(f"{field} is not a SHA-256 reference")
    return value


def require_hash_binding(value: Any, body: Any, field: str) -> str:
    digest = require_hash(value, field)
    if digest != canonical_hash(body):
        fail(f"{field} does not match its canonical body")
    return digest


def require_relative_path(value: Any, field: str, *, allow_root: bool = False) -> str:
    if value == "." and allow_root:
        return value
    if (
        not isinstance(value, str)
        or not value
        or len(value.encode("utf-8")) > 4_096
        or value.startswith("/")
        or "\\" in value
        or "\0" in value
    ):
        fail(f"{field} is not a bounded relative path")
    parts = value.split("/")
    if (
        value.startswith(UNSAFE_PATH_PREFIX)
        or any(part in ("", ".", "..") or part == ".git" for part in parts)
    ):
        fail(f"{field} is not a normalized non-Git path")
    return value


def read_json_stdin() -> dict[str, Any]:
    data = sys.stdin.buffer.read(MAX_CONTROL_BYTES + 1)
    if not data or len(data) > MAX_CONTROL_BYTES:
        fail("stdin payload is outside its bound")
    try:
        value = json.loads(data)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise WorkspaceControllerError("stdin is not valid JSON") from error
    if not isinstance(value, dict):
        fail("stdin JSON must be an object")
    return value


def emit_json(value: Any) -> None:
    sys.stdout.buffer.write(canonical_bytes(value) + b"\n")
    sys.stdout.buffer.flush()


def controller_uid() -> int:
    return os.geteuid() if TEST_MODE else 0


def require_controller_authority() -> None:
    if not TEST_MODE and os.geteuid() != 0:
        fail("workspace controller requires root authority")
    if not TEST_MODE:
        info = Path(__file__).resolve().lstat()
        if (
            not stat.S_ISREG(info.st_mode)
            or stat.S_ISLNK(info.st_mode)
            or info.st_uid != 0
            or info.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
        ):
            fail("workspace controller executable authority is invalid")


def workspace_owner_identity() -> tuple[int, int]:
    if TEST_MODE and WORKSPACE_OWNER == "current":
        return os.geteuid(), os.getegid()
    try:
        identity = pwd.getpwnam(WORKSPACE_OWNER)
    except KeyError as error:
        raise WorkspaceControllerError("workspace owner does not exist") from error
    return identity.pw_uid, identity.pw_gid


def ensure_directory(path: Path, mode: int, *, create: bool = False) -> None:
    if create:
        path.mkdir(mode=mode, parents=True, exist_ok=True)
        os.chmod(path, mode)
    info = path.lstat()
    if (
        not stat.S_ISDIR(info.st_mode)
        or stat.S_ISLNK(info.st_mode)
        or info.st_uid != controller_uid()
        or stat.S_IMODE(info.st_mode) != mode
    ):
        fail("workspace controller state authority is invalid")


def ensure_state() -> None:
    require_controller_authority()
    ensure_directory(STATE_ROOT, 0o711, create=True)
    ensure_directory(WORKSPACES, 0o711, create=True)
    ensure_directory(RECORDS, 0o700, create=True)
    ensure_directory(RECEIPTS, 0o700, create=True)


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_atomic(path: Path, data: bytes, mode: int = 0o600) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "wb", closefd=True) as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def read_record(path: Path) -> dict[str, Any]:
    info = path.lstat()
    if (
        not stat.S_ISREG(info.st_mode)
        or stat.S_ISLNK(info.st_mode)
        or info.st_uid != controller_uid()
        or info.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
        or info.st_size <= 0
        or info.st_size > MAX_CONTROL_BYTES
    ):
        fail("workspace controller record authority is invalid")
    try:
        value = json.loads(path.read_bytes())
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise WorkspaceControllerError("workspace controller record is invalid") from error
    if not isinstance(value, dict):
        fail("workspace controller record must be an object")
    return value


def controller_executable_hash() -> str:
    return content_hash(Path(__file__).resolve().read_bytes())


def source_manifest(source: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[dict[str, Any], bytes]]]:
    require_exact_keys(source, ("schema_version", "manifest_hash", "entries"), "source")
    if source["schema_version"] != PROTOCOL_VERSION:
        fail("source schema version is unsupported")
    entries = source["entries"]
    if not isinstance(entries, list) or not 0 < len(entries) <= MAX_SOURCE_FILES:
        fail("source file count is outside its bound")
    manifest_entries: list[dict[str, Any]] = []
    decoded: list[tuple[dict[str, Any], bytes]] = []
    previous = ""
    total = 0
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            fail("source entry must be an object")
        require_exact_keys(
            entry,
            ("path", "content_base64", "byte_length", "content_hash", "executable"),
            f"source.entries[{index}]",
        )
        path = require_relative_path(entry["path"], f"source.entries[{index}].path")
        if path <= previous:
            fail("source paths must be unique and strictly ordered")
        previous = path
        length = entry["byte_length"]
        if (
            not isinstance(length, int)
            or isinstance(length, bool)
            or length < 0
            or length > MAX_SOURCE_FILE_BYTES
        ):
            fail("source file length is outside its bound")
        if not isinstance(entry["executable"], bool):
            fail("source executable flag must be a boolean")
        digest = require_hash(entry["content_hash"], f"source.entries[{index}].content_hash")
        encoded = entry["content_base64"]
        if not isinstance(encoded, str):
            fail("source content must be base64")
        try:
            content = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as error:
            raise WorkspaceControllerError("source content is not canonical base64") from error
        if base64.b64encode(content).decode("ascii") != encoded:
            fail("source content is not canonical base64")
        if len(content) != length or content_hash(content) != digest:
            fail("source content does not match its manifest")
        total += length
        if total > MAX_SOURCE_BYTES:
            fail("source bytes exceed their bound")
        metadata = {
            "path": path,
            "byte_length": length,
            "content_hash": digest,
            "executable": entry["executable"],
        }
        manifest_entries.append(metadata)
        decoded.append((metadata, content))
    manifest = {"schema_version": PROTOCOL_VERSION, "entries": manifest_entries}
    require_hash_binding(source["manifest_hash"], manifest, "source.manifest_hash")
    return manifest, decoded


def scope_binding(
    value: Any,
    digest: Any,
    field: str,
    *,
    allow_root: bool,
) -> tuple[dict[str, Any], list[str]]:
    if not isinstance(value, dict):
        fail(f"{field} must be an object")
    require_exact_keys(value, ("root", "paths"), field)
    if value["root"] != "/workspace":
        fail(f"{field} root is unsupported")
    paths = value["paths"]
    if not isinstance(paths, list) or not 0 < len(paths) <= MAX_SOURCE_FILES:
        fail(f"{field} paths are outside their bound")
    normalized = [
        require_relative_path(path, f"{field}.paths[{index}]", allow_root=allow_root)
        for index, path in enumerate(paths)
    ]
    overlaps = any(
        later.startswith(earlier + "/")
        for index, earlier in enumerate(normalized)
        for later in normalized[index + 1 :]
    )
    if (
        normalized != sorted(set(normalized))
        or ("." in normalized and len(normalized) != 1)
        or overlaps
    ):
        fail(f"{field} paths must be unique, sorted, and non-overlapping with root")
    body = {"root": "/workspace", "paths": normalized}
    require_hash_binding(digest, body, f"{field}_hash")
    return body, normalized


def validate_prepare_request(value: dict[str, Any]) -> dict[str, Any]:
    require_exact_keys(
        value,
        (
            "schema_version",
            "attempt_id",
            "task_spec_hash",
            "environment_id",
            "prompt_hash",
            "source",
            "workspace_read_scope",
            "workspace_read_scope_hash",
            "writable_path_set",
            "writable_path_set_hash",
            "ownership_scope",
            "ownership_scope_hash",
            "rollback",
            "ttl_seconds",
        ),
        "prepare request",
    )
    if value["schema_version"] != PROTOCOL_VERSION:
        fail("prepare request schema version is unsupported")
    attempt_id = require_opaque(value["attempt_id"], "attempt_id")
    require_hash(value["task_spec_hash"], "task_spec_hash")
    require_opaque(value["environment_id"], "environment_id")
    require_hash(value["prompt_hash"], "prompt_hash")
    if not isinstance(value["source"], dict):
        fail("source must be an object")
    manifest, source_entries = source_manifest(value["source"])
    read_scope, _ = scope_binding(
        value["workspace_read_scope"],
        value["workspace_read_scope_hash"],
        "workspace_read_scope",
        allow_root=True,
    )
    if read_scope != {"root": "/workspace", "paths": ["."]}:
        fail("the prepared source must remain wholly readable")
    write_scope, writable_paths = scope_binding(
        value["writable_path_set"],
        value["writable_path_set_hash"],
        "writable_path_set",
        allow_root=True,
    )
    ownership = value["ownership_scope"]
    if not isinstance(ownership, dict):
        fail("ownership_scope must be an object")
    require_exact_keys(ownership, ("kind", "attempt_id"), "ownership_scope")
    if ownership != {"kind": "attempt_owned_workspace", "attempt_id": attempt_id}:
        fail("ownership scope is not bound to the Attempt")
    require_hash_binding(
        value["ownership_scope_hash"], ownership, "ownership_scope_hash"
    )
    rollback = value["rollback"]
    if not isinstance(rollback, dict):
        fail("rollback must be an object")
    require_exact_keys(
        rollback,
        ("strategy", "controller_id", "ownership_scope_hash", "binding_hash"),
        "rollback",
    )
    rollback_body = {
        "strategy": "discard_workspace",
        "controller_id": CONTROLLER_ID,
        "ownership_scope_hash": value["ownership_scope_hash"],
    }
    if {key: rollback[key] for key in rollback_body} != rollback_body:
        fail("rollback is not owned by this discard controller")
    require_hash_binding(rollback["binding_hash"], rollback_body, "rollback.binding_hash")
    ttl = value["ttl_seconds"]
    if not isinstance(ttl, int) or isinstance(ttl, bool) or not 0 < ttl <= MAX_TTL_SECONDS:
        fail("workspace evidence TTL is outside its bound")
    return {
        **value,
        "source_manifest": manifest,
        "source_entries": source_entries,
        "writable_paths": writable_paths,
        "workspace_read_scope": read_scope,
        "writable_path_set": write_scope,
    }


def write_source_file(root: Path, metadata: dict[str, Any], content: bytes) -> None:
    current = root
    parts = metadata["path"].split("/")
    for component in parts[:-1]:
        current = current / component
        if current.exists():
            info = current.lstat()
            if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
                fail("source directory path is ambiguous")
        else:
            current.mkdir(mode=0o700)
    target = current / parts[-1]
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o700 if metadata["executable"] else 0o600)
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        if target.exists():
            target.unlink()
        raise


def ensure_writable_paths(root: Path, paths: list[str]) -> None:
    for relative in paths:
        if relative == ".":
            continue
        current = root
        for component in relative.split("/"):
            current = current / component
            if current.exists():
                info = current.lstat()
                if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
                    fail("writable path conflicts with a source file")
            else:
                current.mkdir(mode=0o700)


def chown_tree(root: Path, uid: int, gid: int) -> None:
    for candidate in sorted(root.rglob("*"), key=lambda path: len(path.parts), reverse=True):
        info = candidate.lstat()
        if stat.S_ISLNK(info.st_mode):
            fail("workspace tree contains a symlink")
        os.chown(candidate, uid, gid, follow_symlinks=False)
    os.chown(root, uid, gid, follow_symlinks=False)


def filesystem_manifest(root: Path) -> dict[str, Any]:
    root_info = root.lstat()
    if not stat.S_ISDIR(root_info.st_mode) or stat.S_ISLNK(root_info.st_mode):
        fail("workspace root is not a real directory")
    entries: list[dict[str, Any]] = []
    total = 0
    for directory, directory_names, file_names, descriptor in os.fwalk(
        root, topdown=True, follow_symlinks=False
    ):
        relative_directory = Path(directory).relative_to(root)
        directory_names.sort()
        file_names.sort()
        for name in list(directory_names):
            info = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            relative = evidence_relative_path((relative_directory / name).as_posix())
            if stat.S_ISLNK(info.st_mode):
                directory_names.remove(name)
                entries.append(symlink_manifest_entry(relative, name, descriptor, info))
                continue
            if not stat.S_ISDIR(info.st_mode):
                directory_names.remove(name)
                entries.append(special_manifest_entry(relative, info))
                continue
            entries.append(
                {
                    "path": relative,
                    "kind": "directory",
                    "mode": stat.S_IMODE(info.st_mode),
                }
            )
        for name in file_names:
            before = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            relative = evidence_relative_path((relative_directory / name).as_posix())
            if stat.S_ISLNK(before.st_mode):
                entries.append(symlink_manifest_entry(relative, name, descriptor, before))
                continue
            if not stat.S_ISREG(before.st_mode):
                entries.append(special_manifest_entry(relative, before))
                continue
            if before.st_size > MAX_SOURCE_FILE_BYTES:
                raise WorkspaceEvidenceIncomplete("file_size_limit_exceeded")
            file_descriptor = os.open(
                name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=descriptor
            )
            try:
                opened = os.fstat(file_descriptor)
                if (
                    opened.st_dev != before.st_dev
                    or opened.st_ino != before.st_ino
                    or not stat.S_ISREG(opened.st_mode)
                ):
                    fail("workspace file identity changed during evidence capture")
                chunks: list[bytes] = []
                observed = 0
                while True:
                    chunk = os.read(file_descriptor, min(64 * 1024, MAX_SOURCE_FILE_BYTES + 1 - observed))
                    if not chunk:
                        break
                    chunks.append(chunk)
                    observed += len(chunk)
                    if observed > MAX_SOURCE_FILE_BYTES:
                        raise WorkspaceEvidenceIncomplete("file_size_limit_exceeded")
                after = os.fstat(file_descriptor)
                if (
                    after.st_dev != opened.st_dev
                    or after.st_ino != opened.st_ino
                    or after.st_size != observed
                    or after.st_mtime_ns != opened.st_mtime_ns
                ):
                    fail("workspace file changed during evidence capture")
            finally:
                os.close(file_descriptor)
            data = b"".join(chunks)
            total += len(data)
            if total > MAX_SOURCE_BYTES:
                raise WorkspaceEvidenceIncomplete("total_bytes_limit_exceeded")
            entries.append(
                {
                    "path": relative,
                    "kind": "file",
                    "mode": stat.S_IMODE(opened.st_mode),
                    "byte_length": len(data),
                    "content_hash": content_hash(data),
                }
            )
        if len(entries) > MAX_CHANGED_PATHS:
            raise WorkspaceEvidenceIncomplete("entry_limit_exceeded")
    entries.sort(key=lambda entry: entry["path"])
    return {
        "schema_version": PROTOCOL_VERSION,
        "entries": entries,
        "total_file_bytes": total,
    }


def evidence_relative_path(relative: str) -> str:
    safe = (
        relative
        and not relative.startswith("/")
        and not relative.startswith(UNSAFE_PATH_PREFIX)
        and "\\" not in relative
        and "\0" not in relative
        and all(
            part not in ("", ".", "..") and all(ord(character) >= 32 for character in part)
            for part in relative.split("/")
        )
    )
    if safe:
        try:
            relative.encode("utf-8", errors="strict")
            return relative
        except UnicodeEncodeError:
            pass
    return UNSAFE_PATH_PREFIX + hashlib.sha256(os.fsencode(relative)).hexdigest()


def symlink_manifest_entry(
    relative: str, name: str, descriptor: int, info: os.stat_result
) -> dict[str, Any]:
    target = os.readlink(os.fsencode(name), dir_fd=descriptor)
    if len(target) > 4_096:
        raise WorkspaceEvidenceIncomplete("symlink_target_limit_exceeded")
    return {
        "path": relative,
        "kind": "symbolic_link",
        "mode": stat.S_IMODE(info.st_mode),
        "target_byte_length": len(target),
        "target_hash": content_hash(target),
    }


def special_manifest_entry(relative: str, info: os.stat_result) -> dict[str, Any]:
    kind = (
        "fifo"
        if stat.S_ISFIFO(info.st_mode)
        else "socket"
        if stat.S_ISSOCK(info.st_mode)
        else "character_device"
        if stat.S_ISCHR(info.st_mode)
        else "block_device"
        if stat.S_ISBLK(info.st_mode)
        else "unknown"
    )
    return {
        "path": relative,
        "kind": "special",
        "special_kind": kind,
        "mode": stat.S_IMODE(info.st_mode),
    }


def git_identity(manifest: dict[str, Any]) -> dict[str, Any]:
    git_paths = [
        entry["path"]
        for entry in manifest["entries"]
        if entry["path"] == ".git" or entry["path"].endswith("/.git")
    ]
    return {
        "schema_version": PROTOCOL_VERSION,
        "kind": "absent" if not git_paths else "present",
        "paths": sorted(git_paths),
    }


def writable_root_identity(root: Path, workspace_id: str) -> dict[str, Any]:
    info = root.lstat()
    return {
        "schema_version": PROTOCOL_VERSION,
        "workspace_id": workspace_id,
        "device": info.st_dev,
        "inode": info.st_ino,
        "uid": info.st_uid,
        "gid": info.st_gid,
        "mode": stat.S_IMODE(info.st_mode),
    }


def prepare_workspace(value: dict[str, Any]) -> dict[str, Any]:
    ensure_state()
    request = validate_prepare_request(value)
    workspace_id = "workspace-" + uuid.uuid4().hex
    staging = WORKSPACES / (".pending-" + uuid.uuid4().hex)
    target = WORKSPACES / workspace_id
    observed = now_utc()
    expires = observed + dt.timedelta(seconds=request["ttl_seconds"])
    uid, gid = workspace_owner_identity()
    staging.mkdir(mode=0o700)
    try:
        for metadata, content in request["source_entries"]:
            write_source_file(staging, metadata, content)
        ensure_writable_paths(staging, request["writable_paths"])
        chown_tree(staging, uid, gid)
        os.rename(staging, target)
        fsync_directory(WORKSPACES)
        before_manifest = filesystem_manifest(target)
        before_git = git_identity(before_manifest)
        root_identity = writable_root_identity(target, workspace_id)
        if before_git["kind"] != "absent":
            fail("prepared workspace unexpectedly contains Git metadata")
        preparation_receipt = {
            "schema_version": PROTOCOL_VERSION,
            "controller_id": CONTROLLER_ID,
            "controller_executable_hash": controller_executable_hash(),
            "workspace_id": workspace_id,
            "attempt_id": request["attempt_id"],
            "task_spec_hash": request["task_spec_hash"],
            "environment_id": request["environment_id"],
            "prompt_hash": request["prompt_hash"],
            "source_manifest_hash": request["source"]["manifest_hash"],
            "workspace_read_scope_hash": request["workspace_read_scope_hash"],
            "writable_path_set_hash": request["writable_path_set_hash"],
            "ownership_scope_hash": request["ownership_scope_hash"],
            "rollback_binding_hash": request["rollback"]["binding_hash"],
            "writable_root_identity_hash": canonical_hash(root_identity),
            "before_filesystem_manifest_hash": canonical_hash(before_manifest),
            "before_git_identity_hash": canonical_hash(before_git),
            "observed_at": instant(observed),
            "expires_at": instant(expires),
        }
        protected_receipt_hash = canonical_hash(preparation_receipt)
        evidence_refs = [
            request["source"]["manifest_hash"],
            preparation_receipt["writable_root_identity_hash"],
            preparation_receipt["before_filesystem_manifest_hash"],
            preparation_receipt["before_git_identity_hash"],
            protected_receipt_hash,
        ]
        evidence_body = {
            "schema_version": PROTOCOL_VERSION,
            "attempt_id": request["attempt_id"],
            "task_spec_hash": request["task_spec_hash"],
            "environment_id": request["environment_id"],
            "workspace_id": workspace_id,
            "writable_root_identity_hash": preparation_receipt["writable_root_identity_hash"],
            "prompt_hash": request["prompt_hash"],
            "source_manifest_hash": request["source"]["manifest_hash"],
            "before_filesystem_manifest_hash": preparation_receipt["before_filesystem_manifest_hash"],
            "before_git_identity_hash": preparation_receipt["before_git_identity_hash"],
            "workspace_read_scope_hash": request["workspace_read_scope_hash"],
            "writable_path_set_hash": request["writable_path_set_hash"],
            "ownership_scope_hash": request["ownership_scope_hash"],
            "rollback": {
                "strategy": "discard_workspace",
                "binding_hash": request["rollback"]["binding_hash"],
                "controller_id": CONTROLLER_ID,
                "controller_executable_hash": preparation_receipt["controller_executable_hash"],
                "controller_authority": "separate_process",
                "state": "prepared",
                "evidence_refs": [protected_receipt_hash],
            },
            "issuer": {
                "controller_id": CONTROLLER_ID,
                "controller_executable_hash": preparation_receipt["controller_executable_hash"],
                "protected_receipt_hash": protected_receipt_hash,
            },
            "evidence_refs": evidence_refs,
            "observed_at": preparation_receipt["observed_at"],
            "expires_at": preparation_receipt["expires_at"],
        }
        evidence = {**evidence_body, "evidence_hash": canonical_hash(evidence_body)}
        record = {
            "schema_version": PROTOCOL_VERSION,
            "state": "prepared",
            "workspace_id": workspace_id,
            "workspace_name": workspace_id,
            "quarantine_name": None,
            "request": {
                key: request[key]
                for key in (
                    "attempt_id",
                    "task_spec_hash",
                    "environment_id",
                    "prompt_hash",
                    "workspace_read_scope_hash",
                    "writable_path_set_hash",
                    "ownership_scope_hash",
                )
            },
            "rollback_binding_hash": request["rollback"]["binding_hash"],
            "writable_paths": request["writable_paths"],
            "root_identity": root_identity,
            "before_filesystem_manifest": before_manifest,
            "before_git_identity": before_git,
            "preparation_receipt": preparation_receipt,
            "prepared_evidence": evidence,
            "pending_recovery": None,
            "recovery_receipt": None,
        }
        write_atomic(RECORDS / f"{workspace_id}.json", canonical_bytes(record) + b"\n")
        return {"prepared": True, "evidence": evidence}
    except BaseException:
        if staging.exists():
            shutil.rmtree(staging)
        if target.exists() and not (RECORDS / f"{workspace_id}.json").exists():
            shutil.rmtree(target)
        raise


def workspace_record(workspace_id: Any) -> tuple[Path, dict[str, Any]]:
    if not isinstance(workspace_id, str) or not WORKSPACE_ID.fullmatch(workspace_id):
        fail("workspace identity is invalid")
    path = RECORDS / f"{workspace_id}.json"
    record = read_record(path)
    if record.get("workspace_id") != workspace_id:
        fail("workspace record identity is invalid")
    return path, record


def validate_discard_request(value: dict[str, Any], record: dict[str, Any]) -> dict[str, Any]:
    require_exact_keys(
        value,
        (
            "schema_version",
            "workspace_id",
            "attempt_id",
            "task_spec_hash",
            "rollback_binding_hash",
            "writable_root_identity_hash",
            "worker_absence_evidence_hash",
            "recovery_authorization_hash",
            "reason",
        ),
        "discard request",
    )
    if value["schema_version"] != PROTOCOL_VERSION:
        fail("discard request schema version is unsupported")
    require_hash(value["worker_absence_evidence_hash"], "worker_absence_evidence_hash")
    require_hash(value["recovery_authorization_hash"], "recovery_authorization_hash")
    if value["reason"] not in (
        "cancelled",
        "client_lost",
        "worker_lost",
        "task_terminal",
        "qualification_cleanup",
    ):
        fail("discard reason is unsupported")
    expected = {
        "workspace_id": record["workspace_id"],
        "attempt_id": record["request"]["attempt_id"],
        "task_spec_hash": record["request"]["task_spec_hash"],
        "rollback_binding_hash": record["rollback_binding_hash"],
        "writable_root_identity_hash": record["prepared_evidence"]["writable_root_identity_hash"],
    }
    if any(value[field] != expected[field] for field in expected):
        fail("discard request does not match the prepared workspace")
    return value


def manifest_delta(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    before_entries = {entry["path"]: entry for entry in before["entries"]}
    after_entries = {entry["path"]: entry for entry in after["entries"]}
    paths = sorted(set(before_entries) | set(after_entries))
    changed = [
        {
            "path": path,
            "before": before_entries.get(path),
            "after": after_entries.get(path),
        }
        for path in paths
        if before_entries.get(path) != after_entries.get(path)
    ]
    if len(changed) > MAX_CHANGED_PATHS:
        raise WorkspaceEvidenceIncomplete("change_limit_exceeded")
    return {"schema_version": PROTOCOL_VERSION, "changes": changed}


def recovery_receipt_body(record: dict[str, Any], pending: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": PROTOCOL_VERSION,
        "controller_id": CONTROLLER_ID,
        "controller_executable_hash": controller_executable_hash(),
        "workspace_id": record["workspace_id"],
        "attempt_id": record["request"]["attempt_id"],
        "task_spec_hash": record["request"]["task_spec_hash"],
        "rollback_binding_hash": record["rollback_binding_hash"],
        "writable_root_identity_hash": record["prepared_evidence"]["writable_root_identity_hash"],
        "before_filesystem_manifest_hash": record["prepared_evidence"]["before_filesystem_manifest_hash"],
        "after_filesystem_manifest_hash": pending["after_filesystem_manifest_hash"],
        "before_git_identity_hash": record["prepared_evidence"]["before_git_identity_hash"],
        "after_git_identity_hash": pending["after_git_identity_hash"],
        "patch_identity_hash": pending["patch_identity_hash"],
        "changed_paths": pending["changed_paths"],
        "worker_absence_evidence_hash": pending["worker_absence_evidence_hash"],
        "recovery_authorization_hash": pending["recovery_authorization_hash"],
        "reason": pending["reason"],
        "evidence_status": pending["evidence_status"],
        "evidence_failure_reason": pending["evidence_failure_reason"],
        "result": "discarded",
        "workspace_absent": True,
        "discarded_at": pending["discarded_at"],
    }


def discard_workspace(value: dict[str, Any]) -> dict[str, Any]:
    ensure_state()
    workspace_id = value.get("workspace_id")
    record_path, record = workspace_record(workspace_id)
    request = validate_discard_request(value, record)
    if record.get("state") == "discarded":
        receipt = record.get("recovery_receipt")
        if not isinstance(receipt, dict):
            fail("discarded workspace lost its recovery receipt")
        if any(
            receipt[field] != request[field]
            for field in (
                "worker_absence_evidence_hash",
                "recovery_authorization_hash",
                "reason",
            )
        ):
            fail("idempotent discard request does not match the recovery receipt")
        return {"discarded": True, "receipt": receipt}
    target = WORKSPACES / record["workspace_name"]
    pending = record.get("pending_recovery")
    if record.get("state") == "prepared":
        if not target.exists():
            fail("prepared workspace is unexpectedly absent")
        current_identity = writable_root_identity(target, record["workspace_id"])
        if canonical_hash(current_identity) != record["prepared_evidence"]["writable_root_identity_hash"]:
            fail("prepared workspace root identity changed")
        try:
            after_manifest = filesystem_manifest(target)
            after_git = git_identity(after_manifest)
            delta = manifest_delta(record["before_filesystem_manifest"], after_manifest)
            evidence_status = "complete"
            evidence_failure_reason = "none"
            changed_paths = [change["path"] for change in delta["changes"]]
        except WorkspaceEvidenceIncomplete as error:
            incomplete = {
                "schema_version": PROTOCOL_VERSION,
                "status": "incomplete",
                "reason": error.reason,
            }
            after_manifest = incomplete
            after_git = incomplete
            delta = incomplete
            evidence_status = "incomplete"
            evidence_failure_reason = error.reason
            changed_paths = []
        quarantine_name = ".discarding-" + record["workspace_id"]
        pending = {
            "after_filesystem_manifest_hash": canonical_hash(after_manifest),
            "after_git_identity_hash": canonical_hash(after_git),
            "patch_identity_hash": canonical_hash(delta),
            "changed_paths": changed_paths,
            "worker_absence_evidence_hash": request["worker_absence_evidence_hash"],
            "recovery_authorization_hash": request["recovery_authorization_hash"],
            "reason": request["reason"],
            "evidence_status": evidence_status,
            "evidence_failure_reason": evidence_failure_reason,
            "discarded_at": instant(now_utc()),
        }
        record = {
            **record,
            "state": "discarding",
            "quarantine_name": quarantine_name,
            "pending_recovery": pending,
        }
        write_atomic(record_path, canonical_bytes(record) + b"\n")
        quarantine = WORKSPACES / quarantine_name
        os.rename(target, quarantine)
        fsync_directory(WORKSPACES)
    elif record.get("state") == "discarding":
        if not isinstance(pending, dict):
            fail("discarding workspace lost its pending recovery evidence")
        if any(
            pending[field] != request[field]
            for field in (
                "worker_absence_evidence_hash",
                "recovery_authorization_hash",
                "reason",
            )
        ):
            fail("resumed discard request does not match pending recovery")
    else:
        fail("workspace recovery state is invalid")
    quarantine = WORKSPACES / record["quarantine_name"]
    if quarantine.exists():
        if not shutil.rmtree.avoids_symlink_attacks:
            fail("platform deletion does not resist symlink attacks")
        shutil.rmtree(quarantine)
        fsync_directory(WORKSPACES)
    if target.exists() or quarantine.exists():
        fail("workspace remains after discard")
    assert isinstance(pending, dict)
    receipt_body = recovery_receipt_body(record, pending)
    receipt = {**receipt_body, "receipt_hash": canonical_hash(receipt_body)}
    write_atomic(
        RECEIPTS / f"{record['workspace_id']}.json",
        canonical_bytes(receipt) + b"\n",
    )
    record = {
        **record,
        "state": "discarded",
        "pending_recovery": None,
        "recovery_receipt": receipt,
    }
    write_atomic(record_path, canonical_bytes(record) + b"\n")
    return {"discarded": True, "receipt": receipt}


def inspect_workspace(workspace_id: str) -> dict[str, Any]:
    ensure_state()
    _, record = workspace_record(workspace_id)
    target = WORKSPACES / record["workspace_name"]
    quarantine = (
        WORKSPACES / record["quarantine_name"]
        if isinstance(record.get("quarantine_name"), str)
        else None
    )
    return {
        "workspaceId": workspace_id,
        "status": record["state"],
        "workspacePresent": target.exists(),
        "quarantinePresent": quarantine is not None and quarantine.exists(),
        "preparedEvidenceHash": record["prepared_evidence"]["evidence_hash"],
        "recoveryReceiptHash": (
            record["recovery_receipt"]["receipt_hash"]
            if isinstance(record.get("recovery_receipt"), dict)
            else None
        ),
    }


def collect_workspace(workspace_id: str) -> dict[str, Any]:
    ensure_state()
    _, record = workspace_record(workspace_id)
    return {
        "workspaceId": workspace_id,
        "status": record["state"],
        "preparedEvidence": record["prepared_evidence"],
        "recoveryReceipt": record["recovery_receipt"],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="lexrunner-workspace-controller")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("prepare", "discard"):
        child = subparsers.add_parser(command)
        child.add_argument("--stdin-format", choices=("canonical-json-v1",), required=True)
    for command in ("inspect", "collect"):
        child = subparsers.add_parser(command)
        child.add_argument("--workspace-id", required=True)
    return parser


def dispatch(arguments: argparse.Namespace) -> None:
    if arguments.command == "prepare":
        emit_json(prepare_workspace(read_json_stdin()))
    elif arguments.command == "discard":
        emit_json(discard_workspace(read_json_stdin()))
    elif arguments.command == "inspect":
        emit_json(inspect_workspace(arguments.workspace_id))
    elif arguments.command == "collect":
        emit_json(collect_workspace(arguments.workspace_id))
    else:
        fail("workspace controller command is unsupported")


def main() -> int:
    arguments = build_parser().parse_args()
    try:
        dispatch(arguments)
    except (OSError, WorkspaceControllerError) as error:
        sys.stderr.write(f"lexrunner-workspace-controller: {type(error).__name__}\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
