import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PlanArtifactRegistrationError,
  PlanArtifactRegistrationService,
} from "../../src/application/plan-artifact-registration-service.js";
import { PlanArtifactService } from "../../src/application/plan-artifact-service.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("PlanArtifactRegistrationService", () => {
  it("publishes exact canonical bytes append-only and replays idempotently", async () => {
    const root = await fixtureRoot();
    const source = join(root, "source.json");
    const store = join(root, "store");
    await writePlan(source, plan("registered"));
    const artifact = new PlanArtifactService().resolve({ planFile: source }).artifact;
    const service = new PlanArtifactRegistrationService();

    const first = service.register({ artifact, storeDirectory: store, scope: scope("tenant-a") });
    const second = service.register({ artifact, storeDirectory: store, scope: scope("tenant-a") });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(first.reference).toEqual(second.reference);
    expect(first.reference.retrieval.kind).toBe("registered");
    expect(first.reference.scope).toEqual(scope("tenant-a"));
    expect(first.storage).toEqual({
      assurance: "service-no-replace-verified",
      authority: "unverified",
    });
    expect(await readFile(first.reference.retrieval.reference, "utf8")).toBe(
      artifact.canonicalBytes
    );
    expect((await readdir(store)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps scope outside portable content identity", async () => {
    const root = await fixtureRoot();
    const source = join(root, "source.json");
    const store = join(root, "store");
    await writePlan(source, plan("portable"));
    const artifact = new PlanArtifactService().resolve({ planFile: source }).artifact;
    const service = new PlanArtifactRegistrationService();

    const first = service.register({ artifact, storeDirectory: store, scope: scope("tenant-a") });
    const second = service.register({ artifact, storeDirectory: store, scope: scope("tenant-b") });

    expect(first.artifact.identity).toEqual(second.artifact.identity);
    expect(first.reference.scope).not.toEqual(second.reference.scope);
  });

  it("fails closed on a corrupt object already stored under the digest key", async () => {
    const root = await fixtureRoot();
    const source = join(root, "source.json");
    const store = join(root, "store");
    await writePlan(source, plan("expected"));
    const artifact = new PlanArtifactService().resolve({ planFile: source }).artifact;
    const digestName = `${artifact.identity.digest.slice("sha256:".length)}.json`;
    await mkdir(store);
    await writePlan(join(store, digestName), plan("different"));

    expect(() =>
      new PlanArtifactRegistrationService().register({ artifact, storeDirectory: store })
    ).toThrowError(
      expect.objectContaining<Partial<PlanArtifactRegistrationError>>({
        code: "PLAN_REGISTRATION_CONFLICT",
      })
    );
  });

  it("rejects a hard-linked persisted object and never replaces it", async () => {
    const root = await fixtureRoot();
    const source = join(root, "source.json");
    const store = join(root, "store");
    await writePlan(source, plan("linked"));
    const artifact = new PlanArtifactService().resolve({ planFile: source }).artifact;
    const service = new PlanArtifactRegistrationService();
    const registered = service.register({ artifact, storeDirectory: store });
    await link(registered.reference.retrieval.reference, join(root, "alias.json"));

    expect(() => service.register({ artifact, storeDirectory: store })).toThrowError(
      expect.objectContaining<Partial<PlanArtifactRegistrationError>>({
        code: "PLAN_REGISTRATION_VERIFY_FAILED",
      })
    );
  });

  it("rejects caller artifacts whose bytes and identity do not agree", async () => {
    const root = await fixtureRoot();
    const source = join(root, "source.json");
    await writePlan(source, plan("valid"));
    const artifact = new PlanArtifactService().resolve({ planFile: source }).artifact;
    const invalid = {
      ...artifact,
      canonicalBytes: artifact.canonicalBytes.replace("valid", "other"),
    };

    expect(() =>
      new PlanArtifactRegistrationService().register({
        artifact: invalid,
        storeDirectory: join(root, "store"),
      })
    ).toThrowError(
      expect.objectContaining<Partial<PlanArtifactRegistrationError>>({
        code: "PLAN_REGISTRATION_INVALID",
      })
    );
  });

  it("rejects invalid scope before creating the store or publishing bytes", async () => {
    const root = await fixtureRoot();
    const source = join(root, "source.json");
    const store = join(root, "must-not-exist");
    await writePlan(source, plan("scope"));
    const artifact = new PlanArtifactService().resolve({ planFile: source }).artifact;

    for (const invalidScope of [
      { ...scope("tenant"), tenant: "" },
      { ...scope("tenant"), tenant: "é".repeat(300) },
      { tenant: "tenant" },
      { ...scope("tenant"), unexpected: "field" },
    ]) {
      expect(() =>
        new PlanArtifactRegistrationService().register({
          artifact,
          storeDirectory: store,
          scope: invalidScope as ReturnType<typeof scope>,
        })
      ).toThrowError(
        expect.objectContaining<Partial<PlanArtifactRegistrationError>>({
          code: "PLAN_REGISTRATION_INVALID",
        })
      );
      expect(await pathExists(store)).toBe(false);
    }
  });

  it("rejects a linked store ancestor before creating anything through it", async () => {
    const root = await fixtureRoot();
    const outside = join(root, "outside");
    const linked = join(root, "linked-store");
    const source = join(root, "source.json");
    await mkdir(outside);
    await symlink(outside, linked, process.platform === "win32" ? "junction" : "dir");
    await writePlan(source, plan("store-boundary"));
    const artifact = new PlanArtifactService().resolve({ planFile: source }).artifact;

    expect(() =>
      new PlanArtifactRegistrationService().register({
        artifact,
        storeDirectory: join(linked, "must-not-exist"),
      })
    ).toThrowError(
      expect.objectContaining<Partial<PlanArtifactRegistrationError>>({
        code: "PLAN_REGISTRATION_UNSAFE",
      })
    );
    expect(await pathExists(join(outside, "must-not-exist"))).toBe(false);
  });

  it("waits for clean concurrent publication but never deletes an ambiguous alias", async () => {
    const root = await fixtureRoot();
    const source = join(root, "source.json");
    const store = join(root, "store");
    await writePlan(source, plan("concurrent"));
    const artifact = new PlanArtifactService().resolve({ planFile: source }).artifact;
    const service = new PlanArtifactRegistrationService();
    const created = service.register({ artifact, storeDirectory: store });
    expect(created.created).toBe(true);
    const transientAlias = join(store, "concurrent-publisher.tmp");
    const child = spawn(
      process.execPath,
      [
        "-e",
        "const fs=require('node:fs');fs.linkSync(process.argv[1],process.argv[2]);process.stdout.write('linked\\n');setTimeout(()=>fs.unlinkSync(process.argv[2]),100);",
        created.reference.retrieval.reference,
        transientAlias,
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    await waitForOutput(child.stdout!, "linked");
    const concurrent = service.register({ artifact, storeDirectory: store });
    expect(concurrent.created).toBe(false);
    expect(await waitForExit(child)).toBe(0);
    expect(await pathExists(transientAlias)).toBe(false);

    const forgedAlias = join(store, ".plan-00000000-0000-4000-8000-000000000000.tmp");
    await link(created.reference.retrieval.reference, forgedAlias);
    expect(() => service.register({ artifact, storeDirectory: store })).toThrowError(
      expect.objectContaining<Partial<PlanArtifactRegistrationError>>({
        code: "PLAN_REGISTRATION_VERIFY_FAILED",
      })
    );
    expect(await pathExists(forgedAlias)).toBe(true);
  });
});

function plan(itemName: string) {
  return {
    schemaVersion: "1.0.0",
    target: "main",
    items: [{ name: itemName, deps: [], gates: [] }],
  };
}

function scope(tenant: string) {
  return {
    tenant,
    workspace: "workspace",
    repository: "owner/repository",
    refNamespace: "refs/heads/main",
    policy: "policy-v1",
  };
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lexrunner-plan-registration-"));
  roots.push(root);
  return root;
}

async function writePlan(filePath: string, value: object): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitForOutput(stream: NodeJS.ReadableStream, expected: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = "";
    stream.on("data", (chunk) => {
      output += String(chunk);
      if (output.includes(expected)) resolve();
    });
    stream.on("error", reject);
  });
}

async function waitForExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  return await new Promise((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
}
