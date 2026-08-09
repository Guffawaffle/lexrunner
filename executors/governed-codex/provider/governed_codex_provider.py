#!/usr/bin/env python3
"""Trusted synthetic-only Codex provider for one disposable WSL2 environment."""

from __future__ import annotations

import argparse
import base64
import ctypes
import datetime as dt
import fcntl
import hashlib
import json
import math
import os
import re
import selectors
import shutil
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any, BinaryIO, Iterable


PROTOCOL_VERSION = "1.0.0"
MAX_CONTROL_BYTES = 256 * 1024
MAX_PROMPT_BYTES = 1024 * 1024
MAX_RAW_EVENT_BYTES = 768 * 1024
MAX_OUTPUT_BYTES = 8 * 1024 * 1024
MAX_EVENTS = 10_000
ATTESTATION_TTL_SECONDS = 5 * 60
TERMINAL_TYPES = frozenset({"declined", "completed", "failed", "cancelled", "lost"})
CONTROL_IDS = (
    "corpus_read_scope",
    "filesystem_write_denied",
    "tool_network_denied",
    "local_ipc_denied",
    "credential_read_denied",
    "descendant_reaping",
    "evidence_sink_protected",
    "degraded_launch_denied",
)
OPAQUE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")
GIT_OBJECT_ID = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")
SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
HANDLE = re.compile(r"^provider-[0-9a-f]{32}$")

TEST_MODE = os.environ.get("LEXRUNNER_PROVIDER_TEST_MODE") == "1"


def configured_path(name: str, production: str) -> Path:
    override = os.environ.get(name)
    if override and not TEST_MODE:
        fail(f"{name} is a test-only override")
    return Path(override if override else production)


STATE_ROOT = configured_path("LEXRUNNER_PROVIDER_STATE_ROOT", "/var/lib/lexrunner-provider")
QUALIFICATION_PATH = configured_path(
    "LEXRUNNER_PROVIDER_QUALIFICATION", "/etc/lexrunner-provider/qualification.json"
)
CODEX_EXECUTABLE = configured_path("LEXRUNNER_PROVIDER_CODEX", "/opt/lexrunner/bin/codex")
BWRAP_EXECUTABLE = configured_path("LEXRUNNER_PROVIDER_BWRAP", "/usr/bin/bwrap")
SYSTEMD_RUN = configured_path("LEXRUNNER_PROVIDER_SYSTEMD_RUN", "/usr/bin/systemd-run")
SYSTEMCTL = configured_path("LEXRUNNER_PROVIDER_SYSTEMCTL", "/usr/bin/systemctl")
PROVIDER_EXECUTABLE = configured_path(
    "LEXRUNNER_PROVIDER_EXECUTABLE", "/opt/lexrunner/bin/governed-codex-provider"
)
MANAGED_REQUIREMENTS = configured_path(
    "LEXRUNNER_PROVIDER_REQUIREMENTS", "/etc/codex/requirements.toml"
)
SYNTHETIC_CORPUS = STATE_ROOT / "synthetic-corpus"
AUTH_SEED = STATE_ROOT / "credential-seed" / "auth.json"
ATTESTATIONS = STATE_ROOT / "attestations"
OPERATIONS = STATE_ROOT / "operations"


class ProviderError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise ProviderError(message)


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode(
        "utf-8"
    )


def canonical_hash(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_bytes(value)).hexdigest()


def content_hash(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def emit_json(value: Any) -> None:
    sys.stdout.buffer.write(canonical_bytes(value) + b"\n")
    sys.stdout.buffer.flush()


def read_stdin_bounded(limit: int) -> bytes:
    data = sys.stdin.buffer.read(limit + 1)
    if len(data) == 0 or len(data) > limit:
        fail("stdin payload is outside its bound")
    return data


def read_json_stdin(limit: int = MAX_CONTROL_BYTES) -> dict[str, Any]:
    try:
        value = json.loads(read_stdin_bounded(limit))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProviderError("stdin is not valid JSON") from error
    if not isinstance(value, dict):
        fail("stdin JSON must be an object")
    return value


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def instant(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_instant(value: Any, field: str) -> dt.datetime:
    if not isinstance(value, str):
        fail(f"{field} must be an instant")
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ProviderError(f"{field} must be an instant") from error
    if parsed.tzinfo is None:
        fail(f"{field} must include an offset")
    return parsed.astimezone(dt.timezone.utc)


def require_keys(value: dict[str, Any], required: Iterable[str], field: str) -> None:
    expected = set(required)
    actual = set(value)
    if actual != expected:
        fail(f"{field} has unexpected or missing fields")


def require_opaque(value: Any, field: str) -> str:
    if not isinstance(value, str) or not OPAQUE_ID.fullmatch(value):
        fail(f"{field} is not a bounded opaque identifier")
    return value


def require_hash(value: Any, field: str) -> str:
    if not isinstance(value, str) or not SHA256.fullmatch(value):
        fail(f"{field} is not a SHA-256 reference")
    return value


def require_git_id(value: Any, field: str) -> str:
    if not isinstance(value, str) or not GIT_OBJECT_ID.fullmatch(value):
        fail(f"{field} is not a Git object identifier")
    return value


def ensure_secure_directory(path: Path, *, create: bool = False) -> None:
    if create:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(path, 0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        fail("provider state path is not a real directory")
    if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
        fail("provider state directory authority is invalid")


def ensure_trusted_file(path: Path, *, root_owned: bool, max_bytes: int) -> bytes:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
        fail("trusted provider input is not a regular file")
    expected_uid = os.geteuid() if TEST_MODE or not root_owned else 0
    if info.st_uid != expected_uid or info.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        fail("trusted provider input has invalid ownership or mode")
    if info.st_size <= 0 or info.st_size > max_bytes:
        fail("trusted provider input is outside its bound")
    return path.read_bytes()


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_atomic(path: Path, data: bytes, mode: int = 0o600) -> None:
    ensure_secure_directory(path.parent, create=True)
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


def read_json_file(path: Path, limit: int = MAX_CONTROL_BYTES) -> dict[str, Any]:
    data = ensure_trusted_file(path, root_owned=False, max_bytes=limit)
    try:
        value = json.loads(data)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProviderError("provider state JSON is invalid") from error
    if not isinstance(value, dict):
        fail("provider state JSON must be an object")
    return value


def load_qualification() -> dict[str, Any]:
    data = ensure_trusted_file(QUALIFICATION_PATH, root_owned=True, max_bytes=MAX_CONTROL_BYTES)
    try:
        value = json.loads(data)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProviderError("qualification manifest is invalid") from error
    if not isinstance(value, dict):
        fail("qualification manifest must be an object")
    require_keys(
        value,
        (
            "schema_version",
            "provider_id",
            "environment_id",
            "topology_hash",
            "controls",
            "qualified_at",
            "expires_at",
        ),
        "qualification",
    )
    if value["schema_version"] != PROTOCOL_VERSION:
        fail("qualification schema version is unsupported")
    require_opaque(value["provider_id"], "provider_id")
    require_opaque(value["environment_id"], "environment_id")
    require_hash(value["topology_hash"], "topology_hash")
    controls = value["controls"]
    if not isinstance(controls, list) or len(controls) != len(CONTROL_IDS):
        fail("qualification must contain every denial control")
    seen: set[str] = set()
    for control in controls:
        if not isinstance(control, dict):
            fail("qualification control must be an object")
        require_keys(
            control,
            ("control", "status", "strength", "evidence_refs", "enforcement_owner"),
            "qualification control",
        )
        control_id = control["control"]
        if control_id not in CONTROL_IDS or control_id in seen:
            fail("qualification denial controls are not exact")
        seen.add(control_id)
        if control["status"] != "enforced" or control["strength"] not in (
            "host_enforced_indirect",
            "independently_enforced_verified",
        ):
            fail("qualification contains an unenforced or weak control")
        if not isinstance(control["evidence_refs"], list) or not control["evidence_refs"]:
            fail("qualification control lacks evidence")
        for reference in control["evidence_refs"]:
            require_hash(reference, "control evidence")
        require_opaque(control["enforcement_owner"], "enforcement_owner")
    qualified_at = parse_instant(value["qualified_at"], "qualified_at")
    expires_at = parse_instant(value["expires_at"], "expires_at")
    if expires_at <= qualified_at or expires_at <= now_utc():
        fail("qualification manifest is stale")
    return value


PHASE_ONE_DISABLED_FEATURES = (
    "apps",
    "auth_elicitation",
    "browser_use",
    "browser_use_external",
    "browser_use_full_cdp_access",
    "code_mode_host",
    "computer_use",
    "goals",
    "hooks",
    "image_generation",
    "multi_agent",
    "plugin_sharing",
    "plugins",
    "remote_plugin",
    "request_permissions_tool",
    "skill_mcp_dependency_install",
    "skill_search",
    "tool_suggest",
    "unified_exec",
)


def fixed_execution_profile() -> dict[str, Any]:
    return {
        "protocol": "lexrunner-provider-v1",
        "codex_protocol": "jsonl-stdin",
        "managed_requirements_hash": content_hash(
            ensure_trusted_file(MANAGED_REQUIREMENTS, root_owned=True, max_bytes=64 * 1024)
        ),
        "phase_one": {
            "corpus": "empty",
            "shell_tool": "stable-read-only-capability",
            "pre_decision_action": "qualification-fails-on-any-tool-event",
            "disabled_features": list(PHASE_ONE_DISABLED_FEATURES),
        },
        "phase_two": {
            "corpus": "synthetic-read-only",
            "sandbox": "read-only",
            "shell_tool": True,
            "network": "sandbox-default-deny",
        },
        "outer_boundary": {
            "bubblewrap": True,
            "filesystem": "read-only-root-with-sensitive-overlays",
            "ipc_namespace": "private",
            "pid_namespace": "private",
            "systemd_kill_mode": "control-group",
        },
    }


def codex_version() -> str:
    data = subprocess.run(
        [str(CODEX_EXECUTABLE), "--version"],
        check=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=10,
    ).stdout
    if len(data) == 0 or len(data) > 256:
        fail("Codex version output is outside its bound")
    text = data.decode("utf-8", errors="strict").strip()
    match = re.fullmatch(r"codex-cli ([A-Za-z0-9._+-]{1,128})", text)
    if not match:
        fail("Codex version output is not recognized")
    return match.group(1)


def executable_hash(path: Path) -> str:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
        fail("trusted executable is not a regular file")
    expected_uid = os.geteuid() if TEST_MODE else 0
    if info.st_uid != expected_uid or info.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        fail("trusted executable has invalid ownership or mode")
    if info.st_size <= 0 or info.st_size > 512 * 1024 * 1024:
        fail("trusted executable is outside its bound")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return "sha256:" + digest.hexdigest()


def attestation_expiry(observed: dt.datetime, qualification: dict[str, Any]) -> dt.datetime:
    qualified_expiry = parse_instant(qualification["expires_at"], "expires_at")
    result = min(observed + dt.timedelta(seconds=ATTESTATION_TTL_SECONDS), qualified_expiry)
    if result <= observed:
        fail("qualification cannot support a fresh attestation")
    return result


def current_executor_attestation(
    qualification: dict[str, Any], observed: dt.datetime | None = None
) -> dict[str, Any]:
    observed = observed or now_utc()
    profile = fixed_execution_profile()
    return {
        "schema_version": PROTOCOL_VERSION,
        "executor_id": "codex-linux-pinned",
        "executor_version": codex_version(),
        "executable_hash": executable_hash(CODEX_EXECUTABLE),
        "protocol": "jsonl-stdin",
        "configuration_hash": canonical_hash(profile),
        "tool_surface_hash": canonical_hash(
            {"phase_one": profile["phase_one"], "phase_two": profile["phase_two"]}
        ),
        "observed_at": instant(observed),
        "expires_at": instant(attestation_expiry(observed, qualification)),
    }


def hash_synthetic_tree() -> tuple[str, str]:
    ensure_secure_directory(SYNTHETIC_CORPUS)
    entries: list[dict[str, Any]] = []
    for path in sorted(SYNTHETIC_CORPUS.rglob("*"), key=lambda item: item.as_posix()):
        info = path.lstat()
        if stat.S_ISDIR(info.st_mode):
            continue
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            fail("synthetic corpus may contain only regular files and directories")
        relative = path.relative_to(SYNTHETIC_CORPUS).as_posix()
        data = path.read_bytes()
        if len(data) > 4 * 1024 * 1024:
            fail("synthetic corpus file exceeds its bound")
        entries.append(
            {
                "path": relative,
                "bytes": len(data),
                "content_hash": content_hash(data),
                "executable": bool(info.st_mode & stat.S_IXUSR),
            }
        )
    if not entries or len(entries) > 1024:
        fail("synthetic corpus is empty or too large")
    corpus_hash = canonical_hash({"kind": "synthetic-tree-v1", "entries": entries})
    selection_hash = canonical_hash(
        {"kind": "synthetic-selection-v1", "paths": [entry["path"] for entry in entries]}
    )
    return corpus_hash, selection_hash


def prepare_bundle(spec: dict[str, Any]) -> dict[str, Any]:
    require_keys(
        spec,
        ("environment_id", "repository_id", "base_object_id", "candidate_object_id"),
        "synthetic preparation",
    )
    qualification = load_qualification()
    environment_id = require_opaque(spec["environment_id"], "environment_id")
    if environment_id != qualification["environment_id"]:
        fail("requested environment does not match the qualified environment")
    repository_id = require_opaque(spec["repository_id"], "repository_id")
    base_object_id = require_git_id(spec["base_object_id"], "base_object_id")
    candidate_object_id = require_git_id(spec["candidate_object_id"], "candidate_object_id")
    if base_object_id == candidate_object_id:
        fail("synthetic candidate must differ from its base")
    observed = now_utc()
    expires = attestation_expiry(observed, qualification)
    corpus_hash, selection_hash = hash_synthetic_tree()
    workspace_id = "synthetic-" + canonical_hash(
        {
            "repository_id": repository_id,
            "base_object_id": base_object_id,
            "candidate_object_id": candidate_object_id,
            "corpus_hash": corpus_hash,
            "selection_hash": selection_hash,
        }
    ).removeprefix("sha256:")[:24]
    bundle = {
        "executor": current_executor_attestation(qualification, observed),
        "environment": {
            "schema_version": PROTOCOL_VERSION,
            "provider_id": qualification["provider_id"],
            "environment_id": environment_id,
            "topology_hash": qualification["topology_hash"],
            "controls": qualification["controls"],
            "observed_at": instant(observed),
            "expires_at": instant(expires),
        },
        "workspace": {
            "schema_version": PROTOCOL_VERSION,
            "workspace_id": workspace_id,
            "repository_id": repository_id,
            "base_object_id": base_object_id,
            "candidate_object_id": candidate_object_id,
            "corpus_hash": corpus_hash,
            "selection_hash": selection_hash,
            "corpus_kind": "synthetic",
            "observed_at": instant(observed),
            "expires_at": instant(expires),
        },
    }
    hashes = bundle_hashes(bundle)
    record = {"schema_version": PROTOCOL_VERSION, "hashes": hashes, "bundle": bundle}
    write_atomic(attestation_path(hashes), canonical_bytes(record) + b"\n")
    return bundle


def bundle_hashes(bundle: dict[str, Any]) -> dict[str, str]:
    return {
        "executor": canonical_hash(bundle["executor"]),
        "environment": canonical_hash(bundle["environment"]),
        "workspace": canonical_hash(bundle["workspace"]),
    }


def attestation_path(hashes: dict[str, str]) -> Path:
    key = canonical_hash(hashes).removeprefix("sha256:")
    return ATTESTATIONS / f"{key}.json"


def validate_authorization(value: dict[str, Any]) -> dict[str, Any]:
    required = (
        "schema_version",
        "authorization_id",
        "attempt_id",
        "delegation_id",
        "requirements_hash",
        "executor_attestation_hash",
        "environment_attestation_hash",
        "workspace_attestation_hash",
        "grant",
        "authorized_at",
        "expires_at",
        "binding_digest",
    )
    require_keys(value, required, "authorization")
    if value["schema_version"] != PROTOCOL_VERSION:
        fail("authorization schema version is unsupported")
    for field in ("authorization_id", "attempt_id", "delegation_id"):
        require_opaque(value[field], field)
    for field in (
        "requirements_hash",
        "executor_attestation_hash",
        "environment_attestation_hash",
        "workspace_attestation_hash",
        "binding_digest",
    ):
        require_hash(value[field], field)
    body = {key: candidate for key, candidate in value.items() if key != "binding_digest"}
    if canonical_hash(body) != value["binding_digest"]:
        fail("authorization binding digest is invalid")
    authorized_at = parse_instant(value["authorized_at"], "authorized_at")
    expires_at = parse_instant(value["expires_at"], "expires_at")
    if expires_at <= authorized_at:
        fail("authorization validity interval is invalid")
    grant = value["grant"]
    if not isinstance(grant, dict):
        fail("authorization grant must be an object")
    require_keys(
        grant,
        (
            "schema_version",
            "attempt_id",
            "delegation_id",
            "repository_id",
            "base_object_id",
            "candidate_object_id",
            "authorized_model_provider",
            "source_disclosure_allowed",
            "controls",
            "tools",
            "max_duration_ms",
            "max_output_bytes",
        ),
        "authorization grant",
    )
    if (
        grant["schema_version"] != PROTOCOL_VERSION
        or grant["authorized_model_provider"] != "openai"
        or grant["source_disclosure_allowed"] is not True
    ):
        fail("authorization grant is not an OpenAI source-disclosing grant")
    for field in ("attempt_id", "delegation_id", "repository_id"):
        require_opaque(grant.get(field), f"grant.{field}")
    require_git_id(grant.get("base_object_id"), "grant.base_object_id")
    require_git_id(grant.get("candidate_object_id"), "grant.candidate_object_id")
    if grant["attempt_id"] != value["attempt_id"] or grant["delegation_id"] != value["delegation_id"]:
        fail("authorization and grant identities differ")
    tools = grant.get("tools")
    if tools not in ([], ["read_only_shell"]):
        fail("provider accepts only an empty or read-only shell grant")
    controls = grant["controls"]
    if not isinstance(controls, list) or len(controls) != len(CONTROL_IDS):
        fail("authorization grant must contain every denial control")
    control_ids = [candidate.get("control") for candidate in controls if isinstance(candidate, dict)]
    if len(control_ids) != len(CONTROL_IDS) or set(control_ids) != set(CONTROL_IDS):
        fail("authorization grant denial controls are not exact")
    duration = grant.get("max_duration_ms")
    output = grant.get("max_output_bytes")
    if not isinstance(duration, int) or isinstance(duration, bool) or not 0 < duration <= 900_000:
        fail("grant duration is outside its bound")
    if not isinstance(output, int) or isinstance(output, bool) or not 0 < output <= MAX_OUTPUT_BYTES:
        fail("grant output is outside its bound")
    return value


def exact_attestation_bundle(authorization: dict[str, Any], *, require_live: bool) -> dict[str, Any]:
    authorization = validate_authorization(authorization)
    hashes = {
        "executor": authorization["executor_attestation_hash"],
        "environment": authorization["environment_attestation_hash"],
        "workspace": authorization["workspace_attestation_hash"],
    }
    record = read_json_file(attestation_path(hashes))
    require_keys(record, ("schema_version", "hashes", "bundle"), "attestation record")
    if record["schema_version"] != PROTOCOL_VERSION or record["hashes"] != hashes:
        fail("attestation record binding is invalid")
    bundle = record["bundle"]
    if not isinstance(bundle, dict) or bundle_hashes(bundle) != hashes:
        fail("attestation bundle content does not match its binding")
    workspace = bundle["workspace"]
    grant = authorization["grant"]
    for field in ("repository_id", "base_object_id", "candidate_object_id"):
        if workspace.get(field) != grant.get(field):
            fail("workspace and authorization grant identities differ")
    expires_at = min(
        parse_instant(bundle[name]["expires_at"], f"{name}.expires_at")
        for name in ("executor", "environment", "workspace")
    )
    if expires_at <= now_utc() or parse_instant(authorization["expires_at"], "expires_at") > expires_at:
        fail("bound attestation is stale for this authorization")
    if require_live:
        qualification = load_qualification()
        current_executor = current_executor_attestation(
            qualification,
            parse_instant(bundle["executor"]["observed_at"], "executor.observed_at"),
        )
        if current_executor != bundle["executor"]:
            fail("Codex executor changed after authorization")
        environment = bundle["environment"]
        if (
            environment["environment_id"] != qualification["environment_id"]
            or environment["topology_hash"] != qualification["topology_hash"]
            or environment["controls"] != qualification["controls"]
        ):
            fail("qualified environment changed after authorization")
        corpus_hash, selection_hash = hash_synthetic_tree()
        if (
            workspace["corpus_kind"] != "synthetic"
            or workspace["corpus_hash"] != corpus_hash
            or workspace["selection_hash"] != selection_hash
        ):
            fail("synthetic workspace changed after authorization")
    return bundle


def operation_directory(handle: str) -> Path:
    if not HANDLE.fullmatch(handle):
        fail("provider handle is invalid")
    return OPERATIONS / handle


def event_log(handle: str) -> Path:
    return operation_directory(handle) / "events.jsonl"


def existing_events(handle: str) -> list[dict[str, Any]]:
    path = event_log(handle)
    if not path.exists():
        return []
    data = ensure_trusted_file(path, root_owned=False, max_bytes=32 * 1024 * 1024)
    events: list[dict[str, Any]] = []
    for line in data.splitlines():
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as error:
            raise ProviderError("provider event spool is invalid") from error
        if not isinstance(event, dict):
            fail("provider event spool contains a non-object")
        events.append(event)
    return events


def terminal_event(handle: str) -> dict[str, Any] | None:
    for event in reversed(existing_events(handle)):
        if event.get("type") in TERMINAL_TYPES:
            return event
    return None


def append_event(
    handle: str,
    event_type: str,
    raw: bytes,
    frame_class: str,
    *,
    executor_event_type: str | None = None,
    reason_present: bool | None = None,
) -> dict[str, Any]:
    if len(raw) == 0 or len(raw) > MAX_RAW_EVENT_BYTES:
        fail("raw provider event is outside its bound")
    directory = operation_directory(handle)
    ensure_secure_directory(directory)
    lock_path = directory / ".event.lock"
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        events = existing_events(handle)
        if len(events) >= MAX_EVENTS:
            fail("provider event count exceeds its bound")
        if any(candidate.get("type") in TERMINAL_TYPES for candidate in events):
            fail("provider cannot emit after a terminal event")
        event: dict[str, Any] = {
            "type": event_type,
            "sequence": len(events) + 1,
            "observed_at": instant(now_utc()),
            "frame_class": frame_class,
            "raw_base64": base64.b64encode(raw).decode("ascii"),
        }
        if executor_event_type is not None:
            event["executor_event_type"] = executor_event_type[:128]
        if reason_present is not None:
            event["reason_present"] = reason_present
        line = canonical_bytes(event) + b"\n"
        stream_descriptor = os.open(event_log(handle), os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
        try:
            os.write(stream_descriptor, line)
            os.fsync(stream_descriptor)
        finally:
            os.close(stream_descriptor)
        fsync_directory(directory)
        return event
    finally:
        fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


def append_terminal(handle: str, event_type: str, payload: dict[str, Any]) -> None:
    if terminal_event(handle) is not None:
        return
    try:
        append_event(handle, event_type, canonical_bytes(payload), "provider_receipt")
    except ProviderError:
        if terminal_event(handle) is not None:
            return
        raise
    write_atomic(
        operation_directory(handle) / "terminal.json",
        canonical_bytes({"type": event_type, "observed_at": instant(now_utc())}) + b"\n",
    )


def provider_offer(authorization: dict[str, Any]) -> bytes:
    offer = {
        "attempt_id": authorization["attempt_id"],
        "delegation_id": authorization["delegation_id"],
        "requirements_hash": authorization["requirements_hash"],
        "authority_binding": authorization["binding_digest"],
    }
    text = (
        "You are being offered a governed synthetic read-only review delegation.\n"
        "No task corpus is mounted in this offer phase. The session has the same read-only shell "
        "capability it would retain after acceptance, but you do not need to use it to decide.\n"
        "You may freely decline. Reply with exactly ACCEPT or exactly NO.\n"
        "NO is complete and requires no explanation. Do not add punctuation or a reason.\n\n"
        "Offer binding:\n"
        + json.dumps(offer, sort_keys=True, separators=(",", ":"))
        + "\n"
    )
    return text.encode("utf-8")


def phase_two_prompt(prompt: bytes) -> bytes:
    prefix = (
        "This is the authorized synthetic read-only review you accepted.\n"
        "You retain the right to stop: a final response exactly equal to NO is a terminal refusal.\n"
        "Otherwise return only JSON conforming to the requested result schema.\n\n"
    ).encode("utf-8")
    if len(prefix) + len(prompt) > MAX_PROMPT_BYTES:
        fail("authorized prompt exceeds its bound after the autonomy prelude")
    return prefix + prompt


def initialize_codex_home(directory: Path) -> None:
    ensure_secure_directory(directory, create=True)
    data = ensure_trusted_file(AUTH_SEED, root_owned=False, max_bytes=2 * 1024 * 1024)
    write_atomic(directory / "auth.json", data, 0o600)


def parse_launch_frame() -> tuple[dict[str, Any], bytes]:
    data = read_stdin_bounded(4 + MAX_CONTROL_BYTES + MAX_PROMPT_BYTES)
    if len(data) < 5:
        fail("launch frame is truncated")
    metadata_length = struct.unpack(">I", data[:4])[0]
    if metadata_length == 0 or metadata_length > MAX_CONTROL_BYTES or len(data) <= 4 + metadata_length:
        fail("launch metadata length is invalid")
    try:
        metadata = json.loads(data[4 : 4 + metadata_length])
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProviderError("launch metadata is invalid") from error
    if not isinstance(metadata, dict):
        fail("launch metadata must be an object")
    prompt = data[4 + metadata_length :]
    if len(prompt) == 0 or len(prompt) > MAX_PROMPT_BYTES:
        fail("launch prompt is outside its bound")
    return metadata, prompt


def launch_operation(metadata: dict[str, Any], prompt: bytes) -> dict[str, Any]:
    require_keys(metadata, ("authorization", "output_schema", "mode"), "launch metadata")
    if metadata["mode"] != "synthetic_only":
        fail("provider is restricted to synthetic-only launch")
    authorization = metadata["authorization"]
    if not isinstance(authorization, dict):
        fail("launch authorization must be an object")
    exact_attestation_bundle(authorization, require_live=True)
    authorization = validate_authorization(authorization)
    if parse_instant(authorization["authorized_at"], "authorized_at") > now_utc():
        fail("authorization is not active yet")
    if parse_instant(authorization["expires_at"], "expires_at") <= now_utc():
        fail("authorization expired before launch")
    output_schema = metadata["output_schema"]
    if not isinstance(output_schema, dict) or len(canonical_bytes(output_schema)) > MAX_CONTROL_BYTES:
        fail("result schema is not a bounded JSON object")
    handle = "provider-" + uuid.uuid4().hex
    operation_id = "operation-" + uuid.uuid4().hex
    directory = operation_directory(handle)
    ensure_secure_directory(directory, create=True)
    codex_home = directory / "codex-home"
    initialize_codex_home(codex_home)
    (directory / "offer-workspace").mkdir(mode=0o700)
    write_atomic(directory / "prompt.bin", prompt)
    write_atomic(directory / "schema.json", canonical_bytes(output_schema) + b"\n")
    operation = {
        "schema_version": PROTOCOL_VERSION,
        "operation_id": operation_id,
        "provider_handle": handle,
        "unit": "lexrunner-" + handle + ".service",
        "started_at": instant(now_utc()),
        "authorization": authorization,
        "max_output_bytes": authorization["grant"]["max_output_bytes"],
        "max_duration_ms": authorization["grant"]["max_duration_ms"],
    }
    write_atomic(directory / "operation.json", canonical_bytes(operation) + b"\n")
    try:
        start_worker(operation)
    except (OSError, subprocess.SubprocessError):
        cleanup_operation_secrets(handle)
        append_terminal(handle, "failed", {"phase": "launch", "reason": "worker_start_failed"})
        raise
    return {
        "operationId": operation_id,
        "providerHandle": handle,
        "startedAt": operation["started_at"],
    }


def start_worker(operation: dict[str, Any]) -> None:
    handle = operation["provider_handle"]
    if TEST_MODE:
        subprocess.Popen(
            [sys.executable, str(Path(__file__).resolve()), "worker", "--provider-handle", handle],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            close_fds=True,
            env=dict(os.environ),
        )
        return
    seconds = max(1, math.ceil(operation["max_duration_ms"] / 1000))
    finalize = f"{PROVIDER_EXECUTABLE} finalize --provider-handle {handle}"
    command = [
        str(SYSTEMD_RUN),
        "--user",
        "--quiet",
        "--service-type=exec",
        "--unit",
        operation["unit"],
        "--property",
        "KillMode=control-group",
        "--property",
        f"RuntimeMaxSec={seconds}s",
        "--property",
        "TimeoutStopSec=10s",
        "--property",
        f"ExecStopPost={finalize}",
        str(PROVIDER_EXECUTABLE),
        "worker",
        "--provider-handle",
        handle,
    ]
    subprocess.run(
        command,
        check=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=20,
    )


def operation(handle: str) -> dict[str, Any]:
    directory = operation_directory(handle)
    ensure_secure_directory(directory)
    value = read_json_file(directory / "operation.json")
    if value.get("provider_handle") != handle:
        fail("operation record is bound to another handle")
    return value


def bwrap_command(handle: str, *, phase: str, thread_id: str | None = None) -> list[str]:
    record = operation(handle)
    directory = operation_directory(handle)
    workspace = directory / "offer-workspace" if phase == "offer" else SYNTHETIC_CORPUS
    command = [
        str(BWRAP_EXECUTABLE),
        "--die-with-parent",
        "--new-session",
        "--unshare-user",
        "--unshare-pid",
        "--unshare-ipc",
        "--unshare-uts",
        "--unshare-cgroup-try",
        "--ro-bind",
        "/",
        "/",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--tmpfs",
        "/tmp",
        "--tmpfs",
        "/run",
        "--tmpfs",
        "/mnt",
        "--tmpfs",
        "/media",
        "--tmpfs",
        "/home",
        "--tmpfs",
        "/root",
        "--tmpfs",
        str(STATE_ROOT),
        "--dir",
        "/home/lexrunner",
        "--dir",
        "/home/lexrunner/.codex",
        "--bind",
        str(directory / "codex-home"),
        "/home/lexrunner/.codex",
        "--dir",
        "/workspace",
        "--ro-bind",
        str(workspace),
        "/workspace",
        "--chdir",
        "/workspace",
        "--clearenv",
        "--setenv",
        "HOME",
        "/home/lexrunner",
        "--setenv",
        "CODEX_HOME",
        "/home/lexrunner/.codex",
        "--setenv",
        "PATH",
        "/opt/lexrunner/bin:/usr/bin:/bin",
        "--setenv",
        "LANG",
        "C.UTF-8",
    ]
    if phase == "review":
        command.extend(
            [
                "--ro-bind",
                str(directory / "schema.json"),
                "/run/lexrunner-output-schema.json",
            ]
        )
    command.extend([str(CODEX_EXECUTABLE), "exec"])
    if phase == "review":
        if thread_id is None or not re.fullmatch(r"[0-9a-fA-F-]{16,64}", thread_id):
            fail("Codex thread identity is invalid")
        command.extend(["resume", thread_id])
    command.extend(
        [
            "--json",
            "--ignore-user-config",
            "--ignore-rules",
            "--strict-config",
            "--skip-git-repo-check",
            "-c",
            'approval_policy="never"',
            "-c",
            'sandbox_mode="read-only"',
            "-c",
            'web_search="disabled"',
            "-c",
            "apps._default.enabled=false",
        ]
    )
    for feature in PHASE_ONE_DISABLED_FEATURES:
        command.extend(["--disable", feature])
    if phase == "review":
        command.extend(["--output-schema", "/run/lexrunner-output-schema.json"])
    command.extend(
        [
            "--enable" if record["authorization"]["grant"].get("tools") else "--disable",
            "shell_tool",
        ]
    )
    command.append("-")
    return command


def terminate_process_group(process: subprocess.Popen[bytes]) -> None:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=5)


def stream_codex(
    handle: str, command: list[str], prompt: bytes, max_output: int
) -> tuple[int, str | None, list[str], bool]:
    process = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
        close_fds=True,
    )
    assert process.stdin is not None and process.stdout is not None and process.stderr is not None
    process.stdin.write(prompt)
    process.stdin.close()
    selector = selectors.DefaultSelector()
    buffers: dict[int, bytearray] = {}
    streams: dict[int, tuple[BinaryIO, str]] = {}
    for stream, stream_name in ((process.stdout, "stdout"), (process.stderr, "stderr")):
        descriptor = stream.fileno()
        os.set_blocking(descriptor, False)
        selector.register(descriptor, selectors.EVENT_READ)
        buffers[descriptor] = bytearray()
        streams[descriptor] = (stream, stream_name)
    thread_id: str | None = None
    messages: list[str] = []
    declined = False
    observed_bytes = 0
    try:
        while selector.get_map():
            for key, _mask in selector.select():
                descriptor = key.fd
                try:
                    chunk = os.read(descriptor, 64 * 1024)
                except BlockingIOError:
                    continue
                if not chunk:
                    selector.unregister(descriptor)
                    pending = bytes(buffers[descriptor])
                    if pending:
                        candidate_thread, candidate_message = process_line(
                            handle, streams[descriptor][1], pending, messages
                        )
                        thread_id = candidate_thread or thread_id
                        if candidate_message is not None and candidate_message.strip() == "NO":
                            declined = True
                            terminate_process_group(process)
                            return process.returncode or 0, thread_id, messages, True
                    continue
                observed_bytes += len(chunk)
                if observed_bytes > max_output:
                    fail("Codex output exceeded its authorization")
                buffer = buffers[descriptor]
                buffer.extend(chunk)
                if len(buffer) > MAX_RAW_EVENT_BYTES and b"\n" not in buffer:
                    fail("Codex emitted an oversized unterminated event")
                while True:
                    newline = buffer.find(b"\n")
                    if newline < 0:
                        break
                    line = bytes(buffer[: newline + 1])
                    del buffer[: newline + 1]
                    candidate_thread, candidate_message = process_line(
                        handle, streams[descriptor][1], line, messages
                    )
                    thread_id = candidate_thread or thread_id
                    if candidate_message is not None and candidate_message.strip() == "NO":
                        declined = True
                        terminate_process_group(process)
                        return process.returncode or 0, thread_id, messages, True
        return process.wait(timeout=10), thread_id, messages, declined
    except BaseException:
        terminate_process_group(process)
        raise
    finally:
        selector.close()


def process_line(
    handle: str, stream_name: str, line: bytes, messages: list[str]
) -> tuple[str | None, str | None]:
    if stream_name == "stderr":
        append_event(
            handle,
            "executor_event",
            line,
            "executor_stderr",
            executor_event_type="codex.stderr",
        )
        return None, None
    event_type = "codex.invalid_json"
    thread_id: str | None = None
    message: str | None = None
    try:
        candidate = json.loads(line)
        if isinstance(candidate, dict):
            event_type = str(candidate.get("type", "codex.unknown"))[:128]
            if candidate.get("type") == "thread.started":
                value = candidate.get("thread_id")
                if isinstance(value, str):
                    thread_id = value
            if candidate.get("type") == "item.completed":
                item = candidate.get("item")
                if isinstance(item, dict) and item.get("type") == "agent_message":
                    text = item.get("text")
                    if isinstance(text, str):
                        message = text
                        messages.append(text)
    except (UnicodeDecodeError, json.JSONDecodeError):
        pass
    append_event(
        handle,
        "executor_event",
        line,
        "executor_stdout",
        executor_event_type=event_type,
    )
    return thread_id, message


def validate_result_schema(value: Any, schema: dict[str, Any]) -> None:
    try:
        import jsonschema  # type: ignore[import-not-found]
    except ImportError as error:
        raise ProviderError("python3-jsonschema is required by the provider image") from error
    try:
        jsonschema.Draft202012Validator.check_schema(schema)
        jsonschema.Draft202012Validator(schema).validate(value)
    except jsonschema.exceptions.SchemaError as error:
        raise ProviderError("result schema is invalid") from error
    except jsonschema.exceptions.ValidationError as error:
        raise ProviderError("Codex result does not satisfy its schema") from error


def task_outcome(value: Any) -> str:
    if not isinstance(value, dict):
        return "invalid"
    verdict = value.get("verdict", value.get("taskOutcome", value.get("task_outcome")))
    if isinstance(verdict, str):
        normalized = verdict.strip().lower()
        if normalized == "pass":
            return "pass"
        if normalized == "block":
            return "block"
    return "invalid"


def cleanup_operation_secrets(handle: str) -> None:
    directory = operation_directory(handle)
    prompt = directory / "prompt.bin"
    if prompt.exists():
        prompt.unlink()
    codex_home = directory / "codex-home"
    if codex_home.exists():
        shutil.rmtree(codex_home)
    fsync_directory(directory)


def run_worker(handle: str) -> None:
    record = operation(handle)
    authorization = validate_authorization(record["authorization"])
    exact_attestation_bundle(authorization, require_live=True)
    append_event(
        handle,
        "started",
        canonical_bytes(
            {
                "operation_id": record["operation_id"],
                "provider_handle": handle,
                "authorization_binding_digest": authorization["binding_digest"],
            }
        ),
        "provider_receipt",
    )
    maximum = record["max_output_bytes"]
    return_code, thread_id, messages, declined = stream_codex(
        handle, bwrap_command(handle, phase="offer"), provider_offer(authorization), maximum
    )
    if declined:
        append_terminal(handle, "declined", {"decision": "NO", "reason_present": False})
        cleanup_operation_secrets(handle)
        return
    decision = messages[-1].strip() if messages else ""
    if return_code != 0 or decision != "ACCEPT" or thread_id is None:
        append_terminal(handle, "failed", {"phase": "offer", "reason": "invalid_decision"})
        cleanup_operation_secrets(handle)
        return
    exact_attestation_bundle(authorization, require_live=True)
    prompt = ensure_trusted_file(
        operation_directory(handle) / "prompt.bin", root_owned=False, max_bytes=MAX_PROMPT_BYTES
    )
    return_code, _thread, messages, declined = stream_codex(
        handle,
        bwrap_command(handle, phase="review", thread_id=thread_id),
        phase_two_prompt(prompt),
        maximum,
    )
    if declined:
        append_terminal(handle, "declined", {"decision": "NO", "reason_present": False})
        cleanup_operation_secrets(handle)
        return
    if return_code != 0 or not messages:
        append_terminal(handle, "failed", {"phase": "review", "reason": "executor_failed"})
        cleanup_operation_secrets(handle)
        return
    try:
        result = json.loads(messages[-1])
        schema = read_json_file(operation_directory(handle) / "schema.json")
        validate_result_schema(result, schema)
        outcome = task_outcome(result)
    except (json.JSONDecodeError, ProviderError):
        outcome = "invalid"
        result = None
    write_atomic(
        operation_directory(handle) / "result.json",
        canonical_bytes({"taskOutcome": outcome}) + b"\n",
    )
    append_terminal(
        handle,
        "completed",
        {"task_outcome": outcome, "structured_result_present": result is not None},
    )
    cleanup_operation_secrets(handle)


def mark_cancel_requested(handle: str) -> None:
    write_atomic(
        operation_directory(handle) / "cancel-requested.json",
        canonical_bytes({"requested_at": instant(now_utc())}) + b"\n",
    )


def finalize_operation(handle: str) -> None:
    if terminal_event(handle) is not None:
        return
    cancelled = (operation_directory(handle) / "cancel-requested.json").exists()
    append_terminal(
        handle,
        "cancelled" if cancelled else "lost",
        {"cancel_requested": cancelled},
    )
    cleanup_operation_secrets(handle)


def cancel_operation(handle: str) -> None:
    record = operation(handle)
    if terminal_event(handle) is not None:
        return
    mark_cancel_requested(handle)
    if TEST_MODE:
        finalize_operation(handle)
        return
    subprocess.run(
        [str(SYSTEMCTL), "--user", "stop", record["unit"]],
        check=False,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=20,
    )
    finalize_operation(handle)


def inotify_wait(directory: Path) -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    init = libc.inotify_init1
    init.argtypes = [ctypes.c_int]
    init.restype = ctypes.c_int
    add = libc.inotify_add_watch
    add.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32]
    add.restype = ctypes.c_int
    descriptor = init(os.O_CLOEXEC)
    if descriptor < 0:
        fail("inotify initialization failed")
    try:
        mask = 0x00000002 | 0x00000008 | 0x00000100 | 0x00000080
        if add(descriptor, os.fsencode(directory), mask) < 0:
            fail("inotify watch failed")
        os.read(descriptor, 4096)
    finally:
        os.close(descriptor)


def observe_operation(handle: str, after_sequence: int) -> None:
    directory = operation_directory(handle)
    ensure_secure_directory(directory)
    last = after_sequence
    while True:
        events = existing_events(handle)
        for event in events:
            sequence = event.get("sequence")
            if not isinstance(sequence, int) or sequence <= 0:
                fail("provider event sequence is invalid")
            if sequence <= last:
                continue
            if sequence != last + 1:
                fail("provider event stream is not contiguous")
            emit_json(event)
            last = sequence
            if event.get("type") in TERMINAL_TYPES:
                return
        if terminal_event(handle) is not None:
            return
        # Establish the watch, then re-read before blocking to close the race.
        libc = ctypes.CDLL(None, use_errno=True)
        descriptor = libc.inotify_init1(os.O_CLOEXEC)
        if descriptor < 0:
            fail("inotify initialization failed")
        try:
            mask = 0x00000002 | 0x00000008 | 0x00000100 | 0x00000080
            if libc.inotify_add_watch(descriptor, os.fsencode(directory), mask) < 0:
                fail("inotify watch failed")
            if len(existing_events(handle)) > last:
                continue
            os.read(descriptor, 4096)
        finally:
            os.close(descriptor)


def collect_operation(handle: str) -> dict[str, str]:
    terminal = terminal_event(handle)
    if terminal is None:
        fail("provider result is unavailable before a terminal event")
    if terminal["type"] != "completed":
        return {"taskOutcome": "not_produced"}
    result = read_json_file(operation_directory(handle) / "result.json")
    outcome = result.get("taskOutcome")
    if outcome not in ("pass", "block", "not_produced", "invalid"):
        fail("provider result contains an invalid task outcome")
    return {"taskOutcome": outcome}


def release_operation(handle: str) -> None:
    directory = operation_directory(handle)
    if not directory.exists():
        return
    ensure_secure_directory(directory)
    if terminal_event(handle) is None:
        fail("provider operation cannot be released before a terminal event")
    cleanup_operation_secrets(handle)
    shutil.rmtree(directory)
    fsync_directory(OPERATIONS)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="governed-codex-provider")
    subparsers = parser.add_subparsers(dest="command", required=True)
    inspect = subparsers.add_parser("inspect")
    inspect.add_argument("--environment-id", required=True)
    for command in ("prepare", "attest"):
        child = subparsers.add_parser(command)
        child.add_argument("--stdin-format", choices=("canonical-json-v1",), required=True)
    launch = subparsers.add_parser("launch")
    launch.add_argument("--stdin-framing", choices=("lexrunner-provider-v1",), required=True)
    observe = subparsers.add_parser("observe")
    observe.add_argument("--provider-handle", required=True)
    observe.add_argument("--after-sequence", type=int, required=True)
    for command in ("cancel", "collect", "release", "worker", "finalize"):
        child = subparsers.add_parser(command)
        child.add_argument("--provider-handle", required=True)
    return parser


def dispatch(arguments: argparse.Namespace) -> None:
    ensure_secure_directory(STATE_ROOT, create=True)
    ensure_secure_directory(ATTESTATIONS, create=True)
    ensure_secure_directory(OPERATIONS, create=True)
    if arguments.command == "inspect":
        qualification = load_qualification()
        environment_id = require_opaque(arguments.environment_id, "environment_id")
        if qualification["environment_id"] != environment_id:
            fail("requested environment is not this qualified environment")
        emit_json(current_executor_attestation(qualification))
    elif arguments.command == "prepare":
        emit_json(prepare_bundle(read_json_stdin()))
    elif arguments.command == "attest":
        emit_json(exact_attestation_bundle(read_json_stdin(), require_live=True))
    elif arguments.command == "launch":
        metadata, prompt = parse_launch_frame()
        emit_json(launch_operation(metadata, prompt))
    elif arguments.command == "observe":
        if arguments.after_sequence < 0:
            fail("after-sequence must be non-negative")
        observe_operation(arguments.provider_handle, arguments.after_sequence)
    elif arguments.command == "cancel":
        cancel_operation(arguments.provider_handle)
        emit_json({"cancelled": True})
    elif arguments.command == "collect":
        emit_json(collect_operation(arguments.provider_handle))
    elif arguments.command == "release":
        release_operation(arguments.provider_handle)
        emit_json({"released": True})
    elif arguments.command == "worker":
        try:
            run_worker(arguments.provider_handle)
        except (ProviderError, OSError, subprocess.SubprocessError):
            if terminal_event(arguments.provider_handle) is None:
                append_terminal(
                    arguments.provider_handle,
                    "failed",
                    {"phase": "worker", "reason": "worker_exception"},
                )
            cleanup_operation_secrets(arguments.provider_handle)
            raise
    elif arguments.command == "finalize":
        finalize_operation(arguments.provider_handle)
    else:
        fail("unsupported provider command")


def main() -> int:
    try:
        dispatch(build_parser().parse_args())
        return 0
    except (ProviderError, OSError, subprocess.SubprocessError) as error:
        # Control stderr is intentionally content-free: detailed state belongs
        # in protected provider/evidence records, never the WSL bridge response.
        sys.stderr.write(f"governed-codex-provider: {type(error).__name__}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
