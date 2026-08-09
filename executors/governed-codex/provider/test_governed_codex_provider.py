from __future__ import annotations

import datetime as dt
import importlib.util
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path


TEMPORARY = tempfile.TemporaryDirectory(prefix="lexrunner-provider-test-")
ROOT = Path(TEMPORARY.name)
STATE = ROOT / "state"
QUALIFICATION = ROOT / "qualification.json"
CODEX = ROOT / "codex"
REQUIREMENTS = ROOT / "requirements.toml"
os.environ.update(
    {
        "LEXRUNNER_PROVIDER_TEST_MODE": "1",
        "LEXRUNNER_PROVIDER_STATE_ROOT": str(STATE),
        "LEXRUNNER_PROVIDER_QUALIFICATION": str(QUALIFICATION),
        "LEXRUNNER_PROVIDER_CODEX": str(CODEX),
        "LEXRUNNER_PROVIDER_REQUIREMENTS": str(REQUIREMENTS),
        "LEXRUNNER_PROVIDER_EXECUTABLE": str(
            Path(__file__).with_name("governed_codex_provider.py")
        ),
    }
)

MODULE_PATH = Path(__file__).with_name("governed_codex_provider.py")
SPEC = importlib.util.spec_from_file_location("governed_codex_provider", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
provider = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(provider)


def when(seconds: int) -> str:
    value = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=seconds)
    return provider.instant(value)


class GovernedCodexProviderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        STATE.mkdir(mode=0o700)
        (STATE / "synthetic-corpus").mkdir(mode=0o700)
        (STATE / "synthetic-corpus" / "README.md").write_text(
            "Synthetic review corpus.\n", encoding="utf-8"
        )
        CODEX.write_text("#!/bin/sh\necho 'codex-cli 0.145.0'\n", encoding="utf-8")
        CODEX.chmod(0o700)
        REQUIREMENTS.write_text(
            '[permissions.filesystem]\ndeny_read=["/home/lexrunner/.codex/**"]\n',
            encoding="utf-8",
        )
        REQUIREMENTS.chmod(0o600)
        qualification = {
            "schema_version": "1.0.0",
            "provider_id": "lexrunner.wsl2-bwrap",
            "environment_id": "disposable-environment-1",
            "topology_hash": provider.canonical_hash({"topology": "qualified"}),
            "controls": [
                {
                    "control": control,
                    "status": "enforced",
                    "strength": "independently_enforced_verified",
                    "evidence_refs": [provider.canonical_hash({"control": control})],
                    "enforcement_owner": "host-verifier",
                }
                for control in provider.CONTROL_IDS
            ],
            "qualified_at": when(-60),
            "expires_at": when(3600),
        }
        QUALIFICATION.write_text(json.dumps(qualification), encoding="utf-8")
        QUALIFICATION.chmod(0o600)

    def authorization(self) -> tuple[dict, dict]:
        bundle = provider.prepare_bundle(
            {
                "environment_id": "disposable-environment-1",
                "repository_id": "synthetic-repository",
                "base_object_id": "1" * 40,
                "candidate_object_id": "2" * 40,
            }
        )
        hashes = provider.bundle_hashes(bundle)
        grant = {
            "schema_version": "1.0.0",
            "attempt_id": "attempt-1",
            "delegation_id": "delegation-1",
            "repository_id": "synthetic-repository",
            "base_object_id": "1" * 40,
            "candidate_object_id": "2" * 40,
            "authorized_model_provider": "openai",
            "source_disclosure_allowed": True,
            "controls": [
                {"control": control, "minimum_strength": "host_enforced_indirect"}
                for control in provider.CONTROL_IDS
            ],
            "tools": ["read_only_shell"],
            "max_duration_ms": 60_000,
            "max_output_bytes": 1_000_000,
        }
        body = {
            "schema_version": "1.0.0",
            "authorization_id": "authorization-1",
            "attempt_id": "attempt-1",
            "delegation_id": "delegation-1",
            "requirements_hash": provider.canonical_hash({"requirements": 1}),
            "executor_attestation_hash": hashes["executor"],
            "environment_attestation_hash": hashes["environment"],
            "workspace_attestation_hash": hashes["workspace"],
            "grant": grant,
            "authorized_at": when(0),
            "expires_at": when(60),
        }
        return bundle, {**body, "binding_digest": provider.canonical_hash(body)}

    def test_prepares_and_reloads_the_exact_pre_authorization_bundle(self) -> None:
        bundle, authorization = self.authorization()
        self.assertEqual(
            provider.exact_attestation_bundle(authorization, require_live=True), bundle
        )

        corpus = STATE / "synthetic-corpus" / "README.md"
        corpus.write_text("tampered\n", encoding="utf-8")
        with self.assertRaisesRegex(provider.ProviderError, "workspace changed"):
            provider.exact_attestation_bundle(authorization, require_live=True)
        corpus.write_text("Synthetic review corpus.\n", encoding="utf-8")

    def test_continuation_requires_durable_accept_and_exact_authorization(self) -> None:
        handle = "provider-" + "d" * 32
        directory = provider.operation_directory(handle)
        directory.mkdir(mode=0o700, parents=True)
        _, authorization = self.authorization()
        provider.write_atomic(
            directory / "operation.json",
            provider.canonical_bytes(
                {
                    "provider_handle": handle,
                    "operation_id": "operation-1",
                    "authorization": authorization,
                }
            )
            + b"\n",
        )

        with self.assertRaises(provider.ProviderError):
            provider.continue_operation(handle, authorization)
        self.assertFalse((directory / "continue.json").exists())

        provider.write_atomic(directory / "accepted-state.json", b"{}\n")
        provider.append_event(
            handle,
            "accepted",
            provider.canonical_bytes({"decision": "ACCEPT"}),
            "provider_receipt",
        )
        conflicting = dict(authorization)
        conflicting["authorization_id"] = "authorization-2"
        conflicting_body = {
            key: value for key, value in conflicting.items() if key != "binding_digest"
        }
        conflicting["binding_digest"] = provider.canonical_hash(conflicting_body)
        with self.assertRaisesRegex(provider.ProviderError, "does not match"):
            provider.continue_operation(handle, conflicting)

        provider.continue_operation(handle, authorization)
        provider.continue_operation(handle, authorization)
        continuation = provider.read_json_file(directory / "continue.json")
        self.assertEqual(
            continuation["authorization_binding_digest"], authorization["binding_digest"]
        )

    def test_terminal_event_closes_the_provider_stream(self) -> None:
        handle = "provider-" + "a" * 32
        directory = provider.operation_directory(handle)
        directory.mkdir(mode=0o700, parents=True)
        provider.append_event(handle, "started", b"{}", "provider_receipt")
        provider.append_terminal(handle, "declined", {"decision": "NO"})
        with self.assertRaisesRegex(provider.ProviderError, "terminal"):
            provider.append_event(
                handle,
                "executor_event",
                b"later",
                "executor_stdout",
                executor_event_type="item.completed",
            )
        self.assertEqual(provider.terminal_event(handle)["type"], "declined")

    def test_review_keeps_exact_no_reachable_and_leaves_schema_validation_to_verifiers(
        self,
    ) -> None:
        handle = "provider-" + "b" * 32
        directory = provider.operation_directory(handle)
        directory.mkdir(mode=0o700, parents=True)
        (directory / "offer-workspace").mkdir(mode=0o700)
        provider.write_atomic(directory / "schema.json", b"{}\n")
        provider.write_atomic(
            directory / "operation.json",
            provider.canonical_bytes(
                {
                    "provider_handle": handle,
                    "authorization": {"grant": {"tools": ["read_only_shell"]}},
                }
            )
            + b"\n",
        )

        offer = provider.bwrap_command(handle, phase="offer")
        review = provider.bwrap_command(
            handle, phase="review", thread_id="12345678-1234-1234-1234-123456789abc"
        )

        self.assertNotIn("--output-schema", offer)
        self.assertNotIn("/run/lexrunner-output-schema.json", offer)
        self.assertNotIn("--output-schema", review)
        self.assertNotIn("/run/lexrunner-output-schema.json", review)
        self.assertNotIn(str(directory / "schema.json"), review)
        resumed_prompt = provider.phase_two_prompt(
            b"Review the bounded candidate.",
            {"type": "object", "required": ["verdict"]},
        ).decode("utf-8")
        self.assertIn("final response exactly equal to NO", resumed_prompt)
        self.assertIn(
            '{"required":["verdict"],"type":"object"}', resumed_prompt
        )

    def test_release_requires_terminal_state_and_removes_the_transient_spool(self) -> None:
        handle = "provider-" + "c" * 32
        directory = provider.operation_directory(handle)
        directory.mkdir(mode=0o700, parents=True)
        provider.append_event(handle, "started", b"{}", "provider_receipt")
        with self.assertRaisesRegex(provider.ProviderError, "terminal"):
            provider.release_operation(handle)
        provider.append_terminal(handle, "completed", {"task_outcome": "pass"})

        provider.release_operation(handle)
        self.assertFalse(directory.exists())
        provider.release_operation(handle)


if __name__ == "__main__":
    unittest.main()
