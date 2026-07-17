import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from "../../src/workspaces/command-runner.js";
import type { WorktreeTarget } from "../../src/workspaces/git-worktree-broker.js";
import { NodeGitWorktreeBroker } from "../../src/workspaces/node-git-worktree-broker.js";

let sandbox: string;
let repositoryRoot: string;
let worktreeRoot: string;
let target: WorktreeTarget;

describe("NodeGitWorktreeBroker command failures", () => {
  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), "lexrunner-worktree-errors-"));
    repositoryRoot = join(sandbox, "repo");
    worktreeRoot = join(sandbox, "trees");
    await mkdir(join(repositoryRoot, ".git"), { recursive: true });
    await mkdir(worktreeRoot);
    target = {
      repositoryId: "repo-1",
      hostId: "host-1",
      gitRuntime: "git-test",
      projectRoot: repositoryRoot,
      branch: "agent/test",
      worktreePath: join(worktreeRoot, "test"),
      attemptId: "attempt-1",
      baseSha: "a".repeat(40),
    };
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it.each([
    ["timeout", "timeout"],
    ["aborted", "aborted"],
  ] as const)("maps runner %s failures without claiming mutation", async (kind, reason) => {
    const runner = new StaticRunner(failure(kind));
    const broker = makeBroker(runner);

    const result = await broker.create(target);

    expect(result).toMatchObject({
      ok: false,
      operation: "create",
      reason,
      command: {
        executable: "git",
        args: expect.arrayContaining(["check-ref-format", "--branch", "agent/test"]),
        cwd: repositoryRoot,
        exitCode: null,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/\/proc\/\d+\/fd/);
    expect(runner.requests).toHaveLength(1);
  });

  it("distinguishes an invalid branch from a missing Git executable", async () => {
    const invalid = makeBroker(new StaticRunner(failure("nonzero_exit", 128)));
    const missing = makeBroker(new StaticRunner(failure("spawn_error")));

    await expect(invalid.create(target)).resolves.toMatchObject({
      ok: false,
      reason: "invalid_branch",
      command: { exitCode: 128 },
    });
    await expect(missing.create(target)).resolves.toMatchObject({
      ok: false,
      reason: "command_failed",
      command: { exitCode: null },
    });
  });

  it.each(["timeout", "aborted"] as const)(
    "does not treat a show-ref %s carrying exit code 1 as branch absence",
    async (kind) => {
      const runner = new QueueRunner([
        success(""),
        success(`${target.baseSha}\n`),
        success(""),
        failure(kind, 1),
      ]);
      const broker = makeBroker(runner);

      await expect(broker.create(target)).resolves.toMatchObject({
        ok: false,
        reason: kind,
        command: {
          exitCode: 1,
          args: expect.arrayContaining([
            "show-ref",
            "--verify",
            "--quiet",
            `refs/heads/${target.branch}`,
          ]),
        },
      });
      expect(runner.requests).toHaveLength(4);
    }
  );

  it("fails closed on malformed worktree registry output", async () => {
    const broker = makeBroker(
      new StaticRunner({
        ok: true,
        exitCode: 0,
        stdout: "worktree /truncated",
        stderr: "",
        durationMs: 1,
      })
    );

    await expect(broker.observe(target)).resolves.toMatchObject({
      ok: false,
      operation: "observe",
      reason: "identity_mismatch",
      command: { args: expect.arrayContaining(["worktree", "list", "--porcelain", "-z"]) },
    });
  });
});

class StaticRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];

  constructor(private readonly result: CommandResult) {}

  async run(request: CommandRequest): Promise<CommandResult> {
    this.requests.push(request);
    return this.result;
  }
}

class QueueRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];

  constructor(private readonly results: CommandResult[]) {}

  async run(request: CommandRequest): Promise<CommandResult> {
    this.requests.push(request);
    const result = this.results.shift();
    if (!result) throw new Error("unexpected command");
    return result;
  }
}

function makeBroker(runner: CommandRunner): NodeGitWorktreeBroker {
  return new NodeGitWorktreeBroker({
    repositoryId: "repo-1",
    repositoryRoot,
    worktreeRoot,
    hostId: "host-1",
    gitRuntime: "git-test",
    pathComparison: "case-sensitive",
    runner,
  });
}

function failure(
  kind: "nonzero_exit" | "spawn_error" | "timeout" | "aborted",
  exitCode: number | null = null
): CommandResult {
  return {
    ok: false,
    kind,
    exitCode,
    stdout: "stdout evidence",
    stderr: "stderr evidence",
    durationMs: 1,
    message: `${kind} failure`,
  };
}

function success(stdout: string): CommandResult {
  return { ok: true, exitCode: 0, stdout, stderr: "", durationMs: 1 };
}
