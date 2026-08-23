import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AxfCliAttemptAwaitableObserver } from "../../src/runs/axf-attempt-awaitable-observer.js";
import { ExternalAwaitableDescriptor_v1 } from "../../src/runs/attempt-awaitable-contract.js";

const fixture = fileURLToPath(new URL("../fixtures/fake-axf-await.mjs", import.meta.url));

describe("AxfCliAttemptAwaitableObserver", () => {
  it("invokes AXF without a shell and parses its bounded terminal data", async () => {
    let authorityResolutions = 0;
    const observer = new AxfCliAttemptAwaitableObserver({
      executable: process.execPath,
      executableArgs: [fixture],
      environment: () => {
        authorityResolutions += 1;
        return { ...process.env, FAKE_AXF_MODE: "success", GH_TOKEN: "host-only-test-token" };
      },
    });
    const result = await observer.observe({
      descriptor: descriptor(),
      deadlineMs: 12_345,
      signal: new AbortController().signal,
    });
    expect(authorityResolutions).toBe(1);
    expect(result).toMatchObject({
      provider: "github.required-checks",
      outcome: "satisfied",
      effectiveDeadlineMs: 12_345,
      evidence: {
        repository: "owner/repo",
        headSha: "a".repeat(40),
        requiredChecks: [{ name: "Windows", state: "completed", successful: true }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("host-only-test-token");
  });

  it("accepts AXF's structured observation-error data on a non-zero exit", async () => {
    const observer = new AxfCliAttemptAwaitableObserver({
      executable: process.execPath,
      executableArgs: [fixture],
      capabilityId: "global.await.external",
      environment: () => ({ ...process.env, FAKE_AXF_MODE: "observation-error" }),
    });
    await expect(
      observer.observe({
        descriptor: descriptor(),
        deadlineMs: 1_000,
        signal: new AbortController().signal,
      })
    ).resolves.toMatchObject({ outcome: "observation-error", terminal: true });
  });

  it("does not resolve host authority or launch when already cancelled", async () => {
    let authorityResolutions = 0;
    const controller = new AbortController();
    controller.abort();
    const observer = new AxfCliAttemptAwaitableObserver({
      executable: process.execPath,
      executableArgs: [fixture],
      environment: () => {
        authorityResolutions += 1;
        return process.env;
      },
    });
    await expect(
      observer.observe({
        descriptor: descriptor(),
        deadlineMs: 1_000,
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(authorityResolutions).toBe(0);
  });

  it("rejects an inconsistent AXF success envelope", async () => {
    const observer = new AxfCliAttemptAwaitableObserver({
      executable: process.execPath,
      executableArgs: [fixture],
      environment: () => ({ ...process.env, FAKE_AXF_MODE: "inconsistent" }),
    });
    await expect(
      observer.observe({
        descriptor: descriptor(),
        deadlineMs: 1_000,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/inconsistent result envelope/u);
  });
});

function descriptor() {
  return ExternalAwaitableDescriptor_v1.parse({
    schemaVersion: "axf/awaitable/v1",
    kind: "github.required-checks",
    subject: { repository: "owner/repo", headSha: "a".repeat(40) },
    condition: {
      type: "all-required-checks-terminal",
      requiredChecks: [{ source: "check-run", name: "Windows" }],
    },
  });
}
