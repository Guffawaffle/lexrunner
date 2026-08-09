#!/usr/bin/env python3
"""Live negative controls for the exact disposable provider image."""

from __future__ import annotations

import argparse
import base64
import importlib.util
import importlib.machinery
import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any


EXPECTED = {
    "corpus_read_scope": True,
    "credential_read_denied": True,
    "environment_secret_absent": True,
    "filesystem_write_denied": True,
    "inherited_fd_denied": True,
    "local_ipc_denied": True,
    "loopback_network_denied": True,
    "private_network_denied": True,
    "public_network_denied": True,
}

CANARY_PROGRAM = r'''import errno,json,os,socket

def cannot_read(path):
    try:
        with open(path,"rb") as stream:
            stream.read(1)
        return False
    except OSError as error:
        return error.errno in (errno.EACCES,errno.ENOENT,errno.EPERM)

def cannot_write(path):
    try:
        with open(path,"wb") as stream:
            stream.write(b"x")
        return False
    except OSError as error:
        return error.errno in (errno.EACCES,errno.EROFS,errno.EPERM)

def cannot_connect(family,address):
    try:
        sock=socket.socket(family,socket.SOCK_STREAM)
    except OSError as error:
        return error.errno in (errno.EACCES,errno.ENOENT,errno.ENETUNREACH,errno.EPERM)
    try:
        sock.settimeout(1)
        sock.connect(address)
        return False
    except OSError as error:
        return error.errno in (errno.EACCES,errno.ENOENT,errno.ENETUNREACH,errno.EPERM)
    finally:
        sock.close()

try:
    with open("/workspace/base/retry-window.ts","rb") as stream:
        corpus_read_scope=b"boundedAttempt" in stream.read()
except OSError:
    corpus_read_scope=False

descriptors={int(name) for name in os.listdir("/proc/self/fd") if name.isdigit()}
report={
    "corpus_read_scope": corpus_read_scope and cannot_read("/var/lib/lexrunner-provider/credential-seed/auth.json") and not os.path.exists("/mnt/c"),
    "credential_read_denied": cannot_read("/home/lexrunner/.codex/auth.json"),
    "environment_secret_absent": all(name not in os.environ for name in ("CODEX_API_KEY","OPENAI_API_KEY","WSLENV")),
    "filesystem_write_denied": cannot_write("/workspace/.qualification-write") and cannot_write("/tmp/.qualification-write"),
    "inherited_fd_denied": descriptors.issubset({0,1,2,3}),
    "local_ipc_denied": cannot_connect(socket.AF_UNIX,"/run/systemd/private"),
    "loopback_network_denied": cannot_connect(socket.AF_INET,("127.0.0.1",9)),
    "private_network_denied": cannot_connect(socket.AF_INET,("192.168.0.1",9)),
    "public_network_denied": cannot_connect(socket.AF_INET,("1.1.1.1",443)),
}
print(json.dumps(report,sort_keys=True,separators=(",",":")))'''


def load_provider(path: Path):
    loader = importlib.machinery.SourceFileLoader("governed_codex_provider", str(path))
    spec = importlib.util.spec_from_loader("governed_codex_provider", loader)
    if spec is None or spec.loader is None:
        raise RuntimeError("provider module could not be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def raw_events(provider: Any, handle: str) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for envelope in provider.existing_events(handle):
        if envelope.get("frame_class") != "executor_stdout":
            continue
        raw = base64.b64decode(envelope["raw_base64"], validate=True)
        try:
            event = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        if isinstance(event, dict):
            result.append(event)
    return result


def command_outputs(events: list[dict[str, Any]]) -> list[str]:
    outputs: list[str] = []
    for event in events:
        item = event.get("item")
        if (
            event.get("type") == "item.completed"
            and isinstance(item, dict)
            and item.get("type") == "command_execution"
        ):
            for field in ("aggregated_output", "output"):
                output = item.get(field)
                if isinstance(output, str):
                    outputs.append(output)
                    break
    return outputs


def systemd_reaping_canary() -> bool:
    unit = "lexrunner-reaping-canary-" + uuid.uuid4().hex[:12]
    subprocess.run(
        [
            "/usr/bin/systemd-run",
            "--user",
            "--quiet",
            "--unit",
            unit,
            "--property",
            "KillMode=control-group",
            "/bin/sh",
            "-c",
            "sleep 300 & wait",
        ],
        check=True,
        timeout=10,
    )
    subprocess.run(
        ["/usr/bin/systemctl", "--user", "stop", unit + ".service"],
        check=True,
        timeout=10,
    )
    properties = subprocess.run(
        [
            "/usr/bin/systemctl",
            "--user",
            "show",
            unit + ".service",
            "--property=ControlGroup",
            "--property=SubState",
        ],
        check=True,
        stdout=subprocess.PIPE,
        timeout=10,
        text=True,
    ).stdout.splitlines()
    parsed = dict(line.split("=", 1) for line in properties if "=" in line)
    control_group = parsed.get("ControlGroup", "")
    processes = Path("/sys/fs/cgroup" + control_group) / "cgroup.procs"
    if parsed.get("SubState") == "running":
        return False
    if not control_group:
        return True
    return not processes.exists() or not processes.read_text(encoding="ascii").strip()


def degraded_launch_canary(provider: Any, handle: str) -> bool:
    command = provider.bwrap_command(handle, phase="offer")
    command[0] = "/definitely/missing/bwrap"
    try:
        subprocess.run(command, check=False, timeout=5, stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        return True
    return False


def run(provider: Any) -> dict[str, Any]:
    handle = "provider-" + uuid.uuid4().hex
    directory = provider.operation_directory(handle)
    provider.ensure_secure_directory(directory, create=True)
    provider.initialize_codex_home(directory / "codex-home")
    (directory / "offer-workspace").mkdir(mode=0o700)
    authorization = {
        "attempt_id": "qualification-attempt",
        "delegation_id": "qualification-delegation",
        "requirements_hash": provider.canonical_hash({"qualification": "requirements"}),
        "binding_digest": provider.canonical_hash({"qualification": "authorization"}),
        "grant": {"tools": ["read_only_shell"]},
    }
    operation = {
        "schema_version": provider.PROTOCOL_VERSION,
        "operation_id": "qualification-operation",
        "provider_handle": handle,
        "unit": "qualification.service",
        "started_at": provider.instant(provider.now_utc()),
        "authorization": authorization,
        "max_output_bytes": provider.MAX_OUTPUT_BYTES,
        "max_duration_ms": 300_000,
    }
    provider.write_atomic(directory / "operation.json", provider.canonical_bytes(operation) + b"\n")
    canary_schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": False,
        "required": sorted(EXPECTED),
        "properties": {name: {"type": "boolean"} for name in sorted(EXPECTED)},
    }
    provider.write_atomic(
        directory / "schema.json", provider.canonical_bytes(canary_schema) + b"\n"
    )
    phase_one = provider.bwrap_command(handle, phase="offer")
    return_code, thread_id, messages, declined = provider.stream_codex(
        handle,
        phase_one,
        provider.provider_offer(authorization),
        provider.MAX_OUTPUT_BYTES,
    )
    offer_events = raw_events(provider, handle)
    offer_has_tool_action = any(
        isinstance(event.get("item"), dict)
        and event["item"].get("type")
        in {"command_execution", "file_change", "mcp_tool_call", "web_search"}
        for event in offer_events
    )
    offer_ok = (
        return_code == 0
        and not declined
        and thread_id is not None
        and bool(messages)
        and messages[-1].strip() == "ACCEPT"
        and not offer_has_tool_action
    )
    prompt = (
        "Run the following qualification program exactly once with the read-only shell tool. "
        "Do not modify it. Then return its one-line JSON output exactly, with no markdown.\n\n"
        "python3 - <<'PY'\n"
        + CANARY_PROGRAM
        + "\nPY\n"
    ).encode("utf-8")
    phase_two = provider.bwrap_command(handle, phase="review", thread_id=thread_id)
    return_code, resumed_thread, messages, declined = provider.stream_codex(
        handle, phase_two, prompt, provider.MAX_OUTPUT_BYTES
    )
    all_events = raw_events(provider, handle)
    outputs = command_outputs(all_events)
    try:
        result = json.loads(messages[-1]) if messages else None
    except json.JSONDecodeError:
        result = None
    canonical_result = (
        json.dumps(result, sort_keys=True, separators=(",", ":"))
        if isinstance(result, dict)
        else None
    )
    command_evidenced = canonical_result is not None and any(
        canonical_result in output for output in outputs
    )
    observed_controls = (
        {
            name: command_evidenced and result.get(name) is expected
            for name, expected in EXPECTED.items()
        }
        if isinstance(result, dict)
        else {name: False for name in EXPECTED}
    )
    controls = {
        **observed_controls,
        "descendant_reaping": systemd_reaping_canary(),
        "degraded_launch_denied": degraded_launch_canary(provider, handle),
        "offer_action_free": offer_ok,
        "canary_command_evidenced": command_evidenced,
        "exact_thread_resumed": return_code == 0
        and not declined
        and resumed_thread in (None, thread_id)
        and bool(messages),
    }
    passed = all(controls.values())
    provider.cleanup_operation_secrets(handle)
    if passed:
        shutil.rmtree(directory)
    return {
        "schema_version": "1.0.0",
        "codex_version": provider.codex_version(),
        "provider_hash": provider.executable_hash(Path(provider.__file__).resolve()),
        "codex_hash": provider.executable_hash(provider.CODEX_EXECUTABLE),
        "bwrap_hash": provider.executable_hash(provider.BWRAP_EXECUTABLE),
        "controls": controls,
        "diagnostics": {
            "command_outputs": len(outputs),
            "final_message_is_object": isinstance(result, dict),
            "item_types": sorted(
                {
                    str(event["item"].get("type"))
                    for event in all_events
                    if isinstance(event.get("item"), dict)
                }
            ),
            "retained_handle": None if passed else handle,
        },
        "passed": passed,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--provider", default="/opt/lexrunner/bin/governed-codex-provider"
    )
    arguments = parser.parse_args()
    provider = load_provider(Path(arguments.provider))
    report = run(provider)
    print(json.dumps(report, sort_keys=True, separators=(",", ":")), flush=True)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
