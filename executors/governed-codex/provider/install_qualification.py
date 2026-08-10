#!/usr/bin/env python3
"""Seal live provider and host evidence into a short-lived root-owned manifest."""

from __future__ import annotations

import argparse
import datetime as dt
import importlib.machinery
import importlib.util
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


PROTOCOL_VERSION = "1.0.0"
MAX_REPORT_BYTES = 256 * 1024
MAX_TTL_HOURS = 72
PROVIDER_ID = "lexrunner.wsl2-bwrap"
QUALIFICATION_DIRECTORY = Path("/etc/lexrunner-provider")
QUALIFICATION_PATH = QUALIFICATION_DIRECTORY / "qualification.json"
EVIDENCE_PATH = QUALIFICATION_DIRECTORY / "qualification-evidence.json"
SYSTEMD_EXECUTABLE = Path("/usr/lib/systemd/systemd")
WSL_CONFIGURATION = Path("/etc/wsl.conf")
RESOLVER_CONFIGURATION = Path("/etc/resolv.conf")
SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
OPAQUE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")

EXPECTED_CONTROLS = frozenset(
    {
        "canary_command_evidenced",
        "corpus_read_scope",
        "credential_read_denied",
        "degraded_launch_denied",
        "descendant_reaping",
        "environment_secret_absent",
        "exact_thread_resumed",
        "filesystem_write_denied",
        "inherited_fd_denied",
        "local_ipc_denied",
        "loopback_network_denied",
        "offer_action_free",
        "private_network_denied",
        "public_network_denied",
    }
)


class QualificationError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise QualificationError(message)


def load_provider(path: Path):
    loader = importlib.machinery.SourceFileLoader("governed_codex_provider", str(path))
    spec = importlib.util.spec_from_loader("governed_codex_provider", loader)
    if spec is None or spec.loader is None:
        fail("provider module could not be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_report() -> dict[str, Any]:
    data = sys.stdin.buffer.read(MAX_REPORT_BYTES + 1)
    if not data or len(data) > MAX_REPORT_BYTES:
        fail("qualification report is outside its bound")
    try:
        report = json.loads(data)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise QualificationError("qualification report is not valid JSON") from error
    if not isinstance(report, dict):
        fail("qualification report must be an object")
    return report


def validate_report(report: dict[str, Any], provider: Any) -> None:
    expected_fields = {
        "schema_version",
        "codex_version",
        "provider_hash",
        "codex_hash",
        "bwrap_hash",
        "repository_exporter_hash",
        "git_hash",
        "git_version",
        "controls",
        "diagnostics",
        "passed",
    }
    if set(report) != expected_fields or report.get("schema_version") != PROTOCOL_VERSION:
        fail("qualification report contract is invalid")
    controls = report.get("controls")
    if not isinstance(controls, dict) or set(controls) != EXPECTED_CONTROLS:
        fail("qualification report controls are not exact")
    if report.get("passed") is not True or any(value is not True for value in controls.values()):
        fail("qualification report did not pass every control")
    diagnostics = report.get("diagnostics")
    if (
        not isinstance(diagnostics, dict)
        or diagnostics.get("retained_handle") is not None
        or diagnostics.get("final_message_is_object") is not True
        or not isinstance(diagnostics.get("command_outputs"), int)
        or diagnostics["command_outputs"] < 1
    ):
        fail("qualification report diagnostics do not prove the live canary")
    live = {
        "provider_hash": provider.executable_hash(Path(provider.__file__).resolve()),
        "codex_hash": provider.executable_hash(provider.CODEX_EXECUTABLE),
        "bwrap_hash": provider.executable_hash(provider.BWRAP_EXECUTABLE),
        "repository_exporter_hash": provider.executable_hash(provider.REPOSITORY_EXPORTER),
        "git_hash": provider.executable_hash(provider.GIT_EXECUTABLE),
        "git_version": provider.git_version(),
        "codex_version": provider.codex_version(),
    }
    for field, value in live.items():
        if report.get(field) != value:
            fail(f"qualification report {field} no longer matches the installed image")


def trusted_configuration_hash(provider: Any, path: Path) -> str:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
        fail("qualified configuration is not a regular file")
    if info.st_uid != 0 or info.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        fail("qualified configuration authority is invalid")
    if info.st_size <= 0 or info.st_size > 64 * 1024:
        fail("qualified configuration is outside its bound")
    return provider.content_hash(path.read_bytes())


def systemd_version() -> str:
    output = subprocess.run(
        [str(SYSTEMD_EXECUTABLE), "--version"],
        check=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=10,
    ).stdout
    first_line = output.splitlines()[0].decode("ascii", errors="strict") if output else ""
    if not re.fullmatch(r"systemd [0-9]{1,6}(?: \([^\r\n]{1,128}\))?", first_line):
        fail("systemd version output is not recognized")
    return first_line


def ensure_qualification_directory() -> None:
    QUALIFICATION_DIRECTORY.mkdir(parents=True, mode=0o755, exist_ok=True)
    info = QUALIFICATION_DIRECTORY.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_uid != 0:
        fail("qualification directory authority is invalid")
    if stat.S_IMODE(info.st_mode) != 0o755:
        os.chmod(QUALIFICATION_DIRECTORY, 0o755)


def write_atomic(path: Path, data: bytes, mode: int) -> None:
    ensure_qualification_directory()
    descriptor, temporary = tempfile.mkstemp(prefix=".pending-", dir=QUALIFICATION_DIRECTORY)
    try:
        os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "wb", closefd=True) as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(QUALIFICATION_DIRECTORY, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def control(control: str, evidence_refs: list[str]) -> dict[str, Any]:
    return {
        "control": control,
        "status": "enforced",
        "strength": "independently_enforced_verified",
        "evidence_refs": evidence_refs,
        "enforcement_owner": "host-verifier",
    }


def install(arguments: argparse.Namespace) -> dict[str, Any]:
    if os.geteuid() != 0:
        fail("qualification installation requires root")
    if not OPAQUE_ID.fullmatch(arguments.environment_id):
        fail("environment id is not a bounded opaque identifier")
    windows_refs = arguments.windows_evidence_ref
    if len(windows_refs) != 2 or len(set(windows_refs)) != 2:
        fail("exactly two distinct Windows evidence references are required")
    if any(not SHA256.fullmatch(reference) for reference in windows_refs):
        fail("Windows evidence reference is not a SHA-256 reference")

    provider = load_provider(Path(arguments.provider))
    report = read_report()
    validate_report(report, provider)
    qualified_at = provider.now_utc()
    expires_at = qualified_at + dt.timedelta(hours=arguments.ttl_hours)
    canary_hash = provider.canonical_hash(report)
    topology = {
        "kind": "qualified-wsl2-systemd-bwrap-codex@1",
        "provider_hash": report["provider_hash"],
        "codex_version": report["codex_version"],
        "codex_hash": report["codex_hash"],
        "bwrap_hash": report["bwrap_hash"],
        "repository_exporter_hash": report["repository_exporter_hash"],
        "git_hash": report["git_hash"],
        "git_version": report["git_version"],
        "systemd_version": systemd_version(),
        "systemd_hash": provider.executable_hash(SYSTEMD_EXECUTABLE),
        "wsl_configuration_hash": trusted_configuration_hash(provider, WSL_CONFIGURATION),
        "resolver_configuration_hash": trusted_configuration_hash(
            provider, RESOLVER_CONFIGURATION
        ),
        "managed_requirements_hash": trusted_configuration_hash(
            provider, provider.MANAGED_REQUIREMENTS
        ),
        "execution_profile_hash": provider.canonical_hash(provider.fixed_execution_profile()),
    }
    evidence_record = {
        "schema_version": PROTOCOL_VERSION,
        "kind": "governed-codex-qualification-evidence",
        "provider_id": PROVIDER_ID,
        "environment_id": arguments.environment_id,
        "qualified_at": provider.instant(qualified_at),
        "expires_at": provider.instant(expires_at),
        "topology": topology,
        "canary_report": report,
        "canary_report_hash": canary_hash,
        "windows_evidence_refs": windows_refs,
    }
    evidence_bytes = provider.canonical_bytes(evidence_record) + b"\n"
    evidence_hash = provider.content_hash(evidence_bytes)
    live_refs = [canary_hash, evidence_hash]
    controls = [
        control("corpus_read_scope", live_refs),
        control("filesystem_write_denied", live_refs),
        control("tool_network_denied", live_refs),
        control("local_ipc_denied", live_refs),
        control("credential_read_denied", live_refs),
        control("descendant_reaping", live_refs),
        control("evidence_sink_protected", [*windows_refs, evidence_hash]),
        control("degraded_launch_denied", live_refs),
    ]
    manifest = {
        "schema_version": PROTOCOL_VERSION,
        "provider_id": PROVIDER_ID,
        "environment_id": arguments.environment_id,
        "topology_hash": provider.canonical_hash(topology),
        "execution_profile_hash": topology["execution_profile_hash"],
        "controls": controls,
        "qualified_at": provider.instant(qualified_at),
        "expires_at": provider.instant(expires_at),
    }
    write_atomic(EVIDENCE_PATH, evidence_bytes, 0o600)
    write_atomic(QUALIFICATION_PATH, provider.canonical_bytes(manifest) + b"\n", 0o644)
    return {
        "schema_version": PROTOCOL_VERSION,
        "provider_id": PROVIDER_ID,
        "environment_id": arguments.environment_id,
        "topology_hash": manifest["topology_hash"],
        "qualification_evidence_hash": evidence_hash,
        "qualified_at": manifest["qualified_at"],
        "expires_at": manifest["expires_at"],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--provider", default="/opt/lexrunner/bin/governed-codex-provider"
    )
    parser.add_argument("--environment-id", required=True)
    parser.add_argument("--windows-evidence-ref", action="append", required=True)
    parser.add_argument("--ttl-hours", type=int, default=24)
    arguments = parser.parse_args()
    if not 0 < arguments.ttl_hours <= MAX_TTL_HOURS:
        parser.error(f"--ttl-hours must be between 1 and {MAX_TTL_HOURS}")
    try:
        result = install(arguments)
    except (QualificationError, OSError, subprocess.SubprocessError) as error:
        sys.stderr.write(f"install-qualification: {type(error).__name__}\n")
        return 1
    sys.stdout.buffer.write(json.dumps(result, sort_keys=True, separators=(",", ":")).encode())
    sys.stdout.buffer.write(b"\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
