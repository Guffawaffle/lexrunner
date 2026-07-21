import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  IntegrationRecordCompatibilityError,
  IntegrationRecordCompatibilityService,
} from "../../src/application/integration-record-compatibility-service.js";
import { getRunDir } from "../../src/runs/storage.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("IntegrationRecord compatibility retirement", () => {
  it("labels legacy records as bounded non-authoritative IntegrationRuns", () => {
    const root = fixtureRoot();
    const service = new IntegrationRecordCompatibilityService(root);
    const started = service.start({
      mode: "senior-dev",
      procedure: "merge-weave-main",
      repo: "Guffawaffle/lexrunner",
    });
    const status = service.getStatus({ runId: started.runId });

    expect(started).toMatchObject({
      contract: "bounded-ax-v1",
      kind: "IntegrationRun",
      authority: "integration-record-only",
      deprecation: { tool: "lexrunner.startRun", removeIn: "2.0.0" },
      status: "planning",
      initialStatus: { state: "planning" },
    });
    expect(status).toMatchObject({
      contract: "bounded-ax-v1",
      kind: "IntegrationRun",
      authority: "integration-record-only",
      deprecation: { tool: "lexrunner.getStatus", removeIn: "2.0.0" },
      runId: started.runId,
      state: "planning",
    });
  });

  it("caps artifact metadata and permanently retires inline content", () => {
    const root = fixtureRoot();
    const service = new IntegrationRecordCompatibilityService(root);
    const started = service.start({ mode: "test", procedure: "test", repo: "owner/repo" });
    const reports = path.join(getRunDir(started.runId, root), "reports");
    fs.mkdirSync(reports, { recursive: true });
    for (let index = 0; index < 70; index += 1) {
      fs.writeFileSync(path.join(reports, `${index}.md`), `secret-content-${index}`);
    }

    const result = service.listArtifacts({ runId: started.runId, inline: true });

    expect(result).toMatchObject({
      contract: "bounded-ax-v1",
      kind: "IntegrationRun",
      authority: "integration-record-only",
      totalCount: 70,
      returnedCount: 64,
      truncated: true,
      inlineContentRetired: true,
    });
    expect(JSON.stringify(result)).not.toContain("secret-content");
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(64 * 1024);
  });

  it("rejects unbounded input with a stable compatibility error", () => {
    const service = new IntegrationRecordCompatibilityService(fixtureRoot());

    expect(() =>
      service.start({
        mode: "test",
        procedure: "test",
        repo: "owner/repo",
        params: { payload: "x".repeat(20 * 1024) },
      })
    ).toThrowError(
      expect.objectContaining<Partial<IntegrationRecordCompatibilityError>>({
        code: "INTEGRATION_RECORD_INVALID_INPUT",
      })
    );
  });
});

function fixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lexrunner-integration-record-"));
  roots.push(root);
  return root;
}
