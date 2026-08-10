from __future__ import annotations

import json
import os
import shutil
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path


EXPORTER = Path(__file__).with_name("governed_repository_corpus_exporter.py")


class GovernedRepositoryCorpusExporterTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="lexrunner-corpus-exporter-")
        self.root = Path(self.temporary.name)
        self.repository = self.root / "repository"
        self.allocation = self.root / "worktrees"
        self.worktree = self.allocation / "attempt-1"
        self.allocation.mkdir()
        self.git("init", str(self.repository), cwd=self.root)
        self.git("config", "user.name", "LexRunner Test", cwd=self.repository)
        self.git("config", "user.email", "lexrunner@example.invalid", cwd=self.repository)
        (self.repository / "a.txt").write_text("base\n", encoding="utf-8")
        self.git("add", "a.txt", cwd=self.repository)
        self.git("commit", "-m", "base", cwd=self.repository)
        self.base = self.git("rev-parse", "HEAD", cwd=self.repository).strip()
        self.git(
            "worktree",
            "add",
            "-b",
            "agent/attempt-1",
            str(self.worktree),
            self.base,
            cwd=self.repository,
        )
        (self.worktree / "a.txt").write_text("candidate\n", encoding="utf-8")
        self.git("add", "a.txt", cwd=self.worktree)
        self.git("commit", "-m", "candidate", cwd=self.worktree)
        self.git(
            "remote",
            "add",
            "private-origin",
            "https://operator:credential-canary@example.invalid/private.git",
            cwd=self.repository,
        )
        git_directory = Path(
            self.git("rev-parse", "--absolute-git-dir", cwd=self.worktree).strip()
        )
        marker = {
            "schemaVersion": 1,
            "repositoryId": "owner/repository",
            "attemptId": "attempt-1",
            "hostId": "host-1",
            "gitRuntime": "wsl-test-git",
            "projectRoot": str(self.repository),
            "worktreePath": str(self.worktree),
            "branch": "agent/attempt-1",
            "baseSha": self.base,
        }
        (git_directory / "lexrunner-attempt.json").write_text(
            json.dumps(marker) + "\n", encoding="utf-8"
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def git(self, *arguments: str, cwd: Path) -> str:
        return subprocess.run(
            ["/usr/bin/git", *arguments],
            cwd=cwd,
            check=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        ).stdout

    @staticmethod
    def identity(path: Path) -> dict[str, str]:
        info = path.lstat()
        return {"device": str(info.st_dev), "inode": str(info.st_ino)}

    def request(self) -> dict:
        return {
            "schema_version": "1.0.0",
            "environment_id": "environment-1",
            "repository_id": "owner/repository",
            "attempt_id": "attempt-1",
            "workspace_lease_id": "workspace-1",
            "task_packet_hash": "sha256:" + "1" * 64,
            "launch_envelope_hash": "sha256:" + "2" * 64,
            "path_mapping_hash": "sha256:" + "3" * 64,
            "base_object_id": self.base,
            "host_id": "host-1",
            "git_runtime": "wsl-test-git",
            "branch": "agent/attempt-1",
            "repository_root": str(self.repository),
            "allocation_root": str(self.allocation),
            "worktree_root": str(self.worktree),
            "directory_identities": {
                "repository": self.identity(self.repository),
                "allocation": self.identity(self.allocation),
                "worktree": self.identity(self.worktree),
            },
        }

    def run_exporter(self, request: dict | None = None) -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            ["/usr/bin/python3", str(EXPORTER)],
            check=False,
            input=json.dumps(request or self.request()).encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
        )

    def test_exports_only_exact_git_objects_and_patch_without_repository_credentials(self) -> None:
        result = self.run_exporter()
        self.assertEqual(result.returncode, 0, result.stderr)
        header_length = struct.unpack(">I", result.stdout[:4])[0]
        header = json.loads(result.stdout[4 : 4 + header_length])
        payload = result.stdout[4 + header_length :]

        self.assertEqual(header["base_object_id"], self.base)
        self.assertEqual(
            header["candidate_object_id"], self.git("rev-parse", "HEAD", cwd=self.worktree).strip()
        )
        self.assertEqual([entry["path"] for entry in header["entries"]], ["a.txt"])
        self.assertEqual(
            header["entries"][0]["object_id"],
            self.git("rev-parse", "HEAD:a.txt", cwd=self.worktree).strip(),
        )
        self.assertEqual(payload[: header["candidate_tree_bytes"]], b"candidate\n")
        self.assertIn(b"diff --git a/a.txt b/a.txt", payload)
        self.assertNotIn(b"credential-canary", result.stdout)
        self.assertNotIn(b".git/config", result.stdout)

    def test_rejects_dirty_worktree_and_replaced_directory_identity(self) -> None:
        (self.worktree / "untracked.txt").write_text("dirty\n", encoding="utf-8")
        dirty = self.run_exporter()
        self.assertNotEqual(dirty.returncode, 0)
        self.assertEqual(dirty.stdout, b"")
        (self.worktree / "untracked.txt").unlink()

        request = self.request()
        request["directory_identities"]["worktree"]["inode"] = "1"
        replaced = self.run_exporter(request)
        self.assertNotEqual(replaced.returncode, 0)
        self.assertEqual(replaced.stdout, b"")

    def test_rejects_tracked_symlinks_instead_of_materializing_them(self) -> None:
        os.symlink("a.txt", self.worktree / "link.txt")
        self.git("add", "link.txt", cwd=self.worktree)
        self.git("commit", "-m", "add symlink", cwd=self.worktree)

        result = self.run_exporter()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b"")

    def test_rejects_git_replacement_objects_for_the_bound_candidate(self) -> None:
        candidate = self.git("rev-parse", "HEAD", cwd=self.worktree).strip()
        (self.worktree / "a.txt").write_text("replacement\n", encoding="utf-8")
        self.git("add", "a.txt", cwd=self.worktree)
        replacement_tree = self.git("write-tree", cwd=self.worktree).strip()
        replacement = self.git(
            "commit-tree",
            replacement_tree,
            "-p",
            self.base,
            "-m",
            "replacement",
            cwd=self.worktree,
        ).strip()
        self.git("reset", "--hard", candidate, cwd=self.worktree)
        self.git("replace", candidate, replacement, cwd=self.worktree)

        result = self.run_exporter()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b"")

    def test_rejects_blob_bytes_that_do_not_match_the_tree_object_id(self) -> None:
        candidate_blob = self.git("rev-parse", "HEAD:a.txt", cwd=self.worktree).strip()
        malicious_file = self.root / "malicious.txt"
        malicious_file.write_text("substituted\n", encoding="utf-8")
        malicious_blob = self.git(
            "hash-object", "-w", str(malicious_file), cwd=self.repository
        ).strip()
        object_root = Path(
            self.git("rev-parse", "--git-path", "objects", cwd=self.worktree).strip()
        ).resolve()
        shutil.copyfile(
            object_root / malicious_blob[:2] / malicious_blob[2:],
            object_root / candidate_blob[:2] / candidate_blob[2:],
        )

        result = self.run_exporter()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b"")


if __name__ == "__main__":
    unittest.main()
