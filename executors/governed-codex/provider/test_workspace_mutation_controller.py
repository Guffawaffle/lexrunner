from __future__ import annotations

import base64
import importlib.util
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


TEMPORARY = tempfile.TemporaryDirectory(prefix="lexrunner-workspace-controller-test-")
ROOT = Path(TEMPORARY.name)
os.environ.update(
    {
        "LEXRUNNER_WORKSPACE_CONTROLLER_TEST_MODE": "1",
        "LEXRUNNER_WORKSPACE_CONTROLLER_STATE_ROOT": str(ROOT / "state"),
        "LEXRUNNER_WORKSPACE_CONTROLLER_OWNER": "current",
    }
)

MODULE_PATH = Path(__file__).with_name("workspace_mutation_controller.py")
SPEC = importlib.util.spec_from_file_location("workspace_mutation_controller", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
controller = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(controller)


def hash_of(label: str) -> str:
    return controller.canonical_hash({"label": label})


def prepare_request(*, writable_paths: list[str] | None = None) -> dict:
    content = b"sealed source\n"
    manifest = {
        "schema_version": "1.0.0",
        "entries": [
            {
                "path": "source.txt",
                "byte_length": len(content),
                "content_hash": controller.content_hash(content),
                "executable": False,
            }
        ],
    }
    read_scope = {"root": "/workspace", "paths": ["."]}
    write_scope = {
        "root": "/workspace",
        "paths": writable_paths or ["authorized"],
    }
    ownership = {
        "kind": "attempt_owned_workspace",
        "attempt_id": "attempt-write-1",
    }
    rollback_body = {
        "strategy": "discard_workspace",
        "controller_id": controller.CONTROLLER_ID,
        "ownership_scope_hash": controller.canonical_hash(ownership),
    }
    return {
        "schema_version": "1.0.0",
        "attempt_id": "attempt-write-1",
        "task_spec_hash": hash_of("task"),
        "environment_id": "environment-write-1",
        "prompt_hash": hash_of("prompt"),
        "source": {
            "schema_version": "1.0.0",
            "manifest_hash": controller.canonical_hash(manifest),
            "entries": [
                {
                    **manifest["entries"][0],
                    "content_base64": base64.b64encode(content).decode("ascii"),
                }
            ],
        },
        "workspace_read_scope": read_scope,
        "workspace_read_scope_hash": controller.canonical_hash(read_scope),
        "writable_path_set": write_scope,
        "writable_path_set_hash": controller.canonical_hash(write_scope),
        "ownership_scope": ownership,
        "ownership_scope_hash": controller.canonical_hash(ownership),
        "rollback": {
            **rollback_body,
            "binding_hash": controller.canonical_hash(rollback_body),
        },
        "ttl_seconds": 600,
    }


def discard_request(evidence: dict, *, reason: str = "worker_lost") -> dict:
    return {
        "schema_version": "1.0.0",
        "workspace_id": evidence["workspace_id"],
        "attempt_id": evidence["attempt_id"],
        "task_spec_hash": evidence["task_spec_hash"],
        "rollback_binding_hash": evidence["rollback"]["binding_hash"],
        "writable_root_identity_hash": evidence["writable_root_identity_hash"],
        "worker_absence_evidence_hash": hash_of("worker-absent"),
        "recovery_authorization_hash": hash_of("recovery-authorized"),
        "reason": reason,
    }


class WorkspaceMutationControllerTest(unittest.TestCase):
    def setUp(self) -> None:
        if controller.STATE_ROOT.exists():
            shutil.rmtree(controller.STATE_ROOT)

    def test_prepares_hash_bound_attempt_owned_workspace(self) -> None:
        result = controller.prepare_workspace(prepare_request())
        evidence = result["evidence"]
        workspace = controller.WORKSPACES / evidence["workspace_id"]

        self.assertTrue(result["prepared"])
        self.assertEqual((workspace / "source.txt").read_bytes(), b"sealed source\n")
        self.assertTrue((workspace / "authorized").is_dir())
        self.assertFalse((workspace / ".git").exists())
        body = {key: value for key, value in evidence.items() if key != "evidence_hash"}
        self.assertEqual(evidence["evidence_hash"], controller.canonical_hash(body))
        self.assertEqual(evidence["rollback"]["state"], "prepared")
        self.assertEqual(evidence["rollback"]["controller_authority"], "separate_process")
        self.assertEqual(
            controller.inspect_workspace(evidence["workspace_id"]),
            {
                "workspaceId": evidence["workspace_id"],
                "status": "prepared",
                "workspacePresent": True,
                "stagingPresent": False,
                "quarantinePresent": False,
                "preparedEvidenceHash": evidence["evidence_hash"],
                "recoveryReceiptHash": None,
            },
        )

    def test_discards_dirty_workspace_with_pre_post_and_patch_identity(self) -> None:
        evidence = controller.prepare_workspace(prepare_request())["evidence"]
        workspace = controller.WORKSPACES / evidence["workspace_id"]
        (workspace / "authorized" / "result.txt").write_text("changed\n", encoding="utf-8")

        request = discard_request(evidence)
        result = controller.discard_workspace(request)
        receipt = result["receipt"]

        self.assertTrue(result["discarded"])
        self.assertFalse(workspace.exists())
        self.assertEqual(receipt["result"], "discarded")
        self.assertTrue(receipt["workspace_absent"])
        self.assertEqual(receipt["evidence_status"], "complete")
        self.assertEqual(receipt["evidence_failure_reason"], "none")
        self.assertIn("authorized/result.txt", receipt["changed_paths"])
        recovery_evidence = controller.collect_workspace(evidence["workspace_id"])[
            "recoveryEvidence"
        ]
        self.assertEqual(
            receipt["recovery_evidence_hash"], recovery_evidence["evidence_hash"]
        )
        self.assertEqual(
            recovery_evidence["after_filesystem_manifest_hash"],
            controller.canonical_hash(
                recovery_evidence["after_filesystem_manifest"]
            ),
        )
        self.assertEqual(
            recovery_evidence["patch_identity_hash"],
            controller.canonical_hash(recovery_evidence["patch"]),
        )
        self.assertIn(
            "authorized/result.txt",
            [change["path"] for change in recovery_evidence["patch"]["changes"]],
        )
        self.assertNotEqual(
            receipt["before_filesystem_manifest_hash"],
            receipt["after_filesystem_manifest_hash"],
        )
        body = {key: value for key, value in receipt.items() if key != "receipt_hash"}
        self.assertEqual(receipt["receipt_hash"], controller.canonical_hash(body))
        self.assertEqual(controller.discard_workspace(request), result)
        self.assertEqual(
            controller.collect_workspace(evidence["workspace_id"]),
            {
                "workspaceId": evidence["workspace_id"],
                "status": "discarded",
                "preparedEvidence": evidence,
                "beforeFilesystemManifest": controller.read_record(
                    controller.RECORDS / f"{evidence['workspace_id']}.json"
                )["before_filesystem_manifest"],
                "beforeGitIdentity": controller.read_record(
                    controller.RECORDS / f"{evidence['workspace_id']}.json"
                )["before_git_identity"],
                "recoveryEvidence": recovery_evidence,
                "recoveryReceipt": receipt,
            },
        )

    def test_resumes_after_atomic_detach_without_relabeling_recovery(self) -> None:
        evidence = controller.prepare_workspace(prepare_request())["evidence"]
        workspace = controller.WORKSPACES / evidence["workspace_id"]
        (workspace / "authorized" / "dirty.txt").write_text("dirty\n", encoding="utf-8")
        request = discard_request(evidence, reason="client_lost")
        original = shutil.rmtree

        with patch.object(controller.shutil, "rmtree", side_effect=OSError("simulated crash")):
            with self.assertRaisesRegex(OSError, "simulated crash"):
                controller.discard_workspace(request)

        status = controller.inspect_workspace(evidence["workspace_id"])
        self.assertEqual(status["status"], "discarding")
        self.assertFalse(status["workspacePresent"])
        self.assertTrue(status["quarantinePresent"])

        with patch.object(controller.shutil, "rmtree", wraps=original):
            receipt = controller.discard_workspace(request)["receipt"]
        self.assertEqual(receipt["reason"], "client_lost")
        self.assertEqual(
            controller.inspect_workspace(evidence["workspace_id"])["status"],
            "discarded",
        )

    def test_preparation_journal_recovers_a_crash_before_final_exposure(self) -> None:
        with patch.object(controller.os, "rename", side_effect=OSError("simulated crash")):
            with self.assertRaisesRegex(OSError, "simulated crash"):
                controller.prepare_workspace(prepare_request())

        records = list(controller.RECORDS.glob("workspace-*.json"))
        self.assertEqual(len(records), 1)
        workspace_id = records[0].stem
        collected = controller.collect_workspace(workspace_id)
        evidence = collected["preparedEvidence"]
        status = controller.inspect_workspace(workspace_id)
        self.assertEqual(status["status"], "preparing")
        self.assertFalse(status["workspacePresent"])
        self.assertTrue(status["stagingPresent"])

        receipt = controller.discard_workspace(discard_request(evidence))["receipt"]
        self.assertTrue(receipt["workspace_absent"])
        self.assertEqual(
            controller.inspect_workspace(workspace_id)["status"], "discarded"
        )

    def test_resumes_when_detach_completed_before_discard_journal(self) -> None:
        evidence = controller.prepare_workspace(prepare_request())["evidence"]
        request = discard_request(evidence)
        original = controller.write_atomic
        crashed = False

        def fail_discard_record(path: Path, data: bytes, mode: int = 0o600) -> None:
            nonlocal crashed
            if (
                not crashed
                and path.parent == controller.RECORDS
                and b'"state":"discarding"' in data
            ):
                crashed = True
                raise OSError("simulated crash")
            original(path, data, mode)

        with patch.object(controller, "write_atomic", side_effect=fail_discard_record):
            with self.assertRaisesRegex(OSError, "simulated crash"):
                controller.discard_workspace(request)

        status = controller.inspect_workspace(evidence["workspace_id"])
        self.assertEqual(status["status"], "prepared")
        self.assertFalse(status["workspacePresent"])
        self.assertTrue(status["quarantinePresent"])

        receipt = controller.discard_workspace(request)["receipt"]
        self.assertTrue(receipt["workspace_absent"])

    def test_resumes_a_discarding_record_when_the_rename_was_missing(self) -> None:
        evidence = controller.prepare_workspace(prepare_request())["evidence"]
        request = discard_request(evidence)
        record_path, record = controller.workspace_record(evidence["workspace_id"])
        record = {
            **record,
            "state": "discarding",
            "pending_recovery": {
                "worker_absence_evidence_hash": request[
                    "worker_absence_evidence_hash"
                ],
                "recovery_authorization_hash": request[
                    "recovery_authorization_hash"
                ],
                "reason": request["reason"],
                "discarded_at": controller.instant(controller.now_utc()),
            },
        }
        controller.write_atomic(
            record_path, controller.canonical_bytes(record) + b"\n"
        )

        receipt = controller.discard_workspace(request)["receipt"]
        self.assertTrue(receipt["workspace_absent"])
        self.assertFalse(
            (controller.WORKSPACES / evidence["workspace_id"]).exists()
        )

    def test_rejects_scope_hash_drift_and_git_or_parent_traversal(self) -> None:
        request = prepare_request()
        request["writable_path_set"]["paths"] = ["different"]
        with self.assertRaisesRegex(
            controller.WorkspaceControllerError, "does not match its canonical body"
        ):
            controller.prepare_workspace(request)

        request = prepare_request()
        request["source"]["entries"][0]["path"] = "../escape"
        with self.assertRaisesRegex(
            controller.WorkspaceControllerError, "normalized non-Git path"
        ):
            controller.prepare_workspace(request)

        request = prepare_request(writable_paths=[".git"])
        with self.assertRaisesRegex(
            controller.WorkspaceControllerError, "normalized non-Git path"
        ):
            controller.prepare_workspace(request)

    def test_refuses_discard_of_a_replaced_root_or_changed_authorization(self) -> None:
        evidence = controller.prepare_workspace(prepare_request())["evidence"]
        workspace = controller.WORKSPACES / evidence["workspace_id"]
        moved = controller.WORKSPACES / ".moved"
        workspace.rename(moved)
        workspace.mkdir(mode=0o700)
        request = discard_request(evidence)

        with self.assertRaisesRegex(
            controller.WorkspaceControllerError, "root identity changed"
        ):
            controller.discard_workspace(request)

        workspace.rmdir()
        moved.rename(workspace)
        request["rollback_binding_hash"] = hash_of("wrong-rollback")
        with self.assertRaisesRegex(
            controller.WorkspaceControllerError, "does not match"
        ):
            controller.discard_workspace(request)

    def test_safely_records_symlink_evidence_and_rejects_overlapping_write_roots(self) -> None:
        evidence = controller.prepare_workspace(prepare_request())["evidence"]
        workspace = controller.WORKSPACES / evidence["workspace_id"]
        link = workspace / "authorized" / "escape-link"
        link.symlink_to("/etc/passwd")
        fifo = workspace / "authorized" / "pipe"
        os.mkfifo(fifo)
        request = discard_request(evidence)

        receipt = controller.discard_workspace(request)["receipt"]
        self.assertIn("authorized/escape-link", receipt["changed_paths"])
        self.assertIn("authorized/pipe", receipt["changed_paths"])
        self.assertFalse(workspace.exists())

        overlapping = prepare_request(writable_paths=["authorized", "authorized/nested"])
        with self.assertRaisesRegex(
            controller.WorkspaceControllerError, "non-overlapping"
        ):
            controller.prepare_workspace(overlapping)

    def test_discards_oversized_dirt_with_explicitly_incomplete_evidence(self) -> None:
        evidence = controller.prepare_workspace(prepare_request())["evidence"]
        workspace = controller.WORKSPACES / evidence["workspace_id"]
        oversized = workspace / "authorized" / "oversized.bin"
        with oversized.open("wb") as stream:
            stream.truncate(controller.MAX_SOURCE_FILE_BYTES + 1)

        receipt = controller.discard_workspace(discard_request(evidence))["receipt"]
        self.assertEqual(receipt["evidence_status"], "incomplete")
        self.assertEqual(
            receipt["evidence_failure_reason"], "file_size_limit_exceeded"
        )
        self.assertEqual(receipt["changed_paths"], [])
        self.assertFalse(workspace.exists())


if __name__ == "__main__":
    unittest.main()
