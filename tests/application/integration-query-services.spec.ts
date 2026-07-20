import { describe, expect, it, vi } from "vitest";

import {
  DiscoveryQueryService,
  IntegrationQueryServiceError,
  IntegrationStatusQueryService,
  MergeOrderQueryService,
  PlanCreationService,
} from "../../src/application/integration-query-services.js";
import type { GitHubAPI } from "../../src/github/api.js";
import type { InputConfig } from "../../src/core/inputs.js";

describe("integration query services", () => {
  it("bounds discovery and excludes PR bodies from the agent-facing result", async () => {
    const github = {
      config: { owner: "owner", repo: "repo" },
      checkAuth: vi.fn(async () => ({ authenticated: true, user: "agent" })),
      discoverPullRequests: vi.fn(async () => [
        {
          number: 1,
          title: "First",
          branch: "feature",
          sha: "a".repeat(40),
          state: "open",
          labels: ["ready"],
          author: "guff",
          baseBranch: "main",
          createdAt: "2026-07-20T00:00:00.000Z",
          updatedAt: "2026-07-20T00:00:00.000Z",
          body: "unbounded body must not be returned",
        },
      ]),
    } as unknown as GitHubAPI;
    const result = await new DiscoveryQueryService().run({ github, state: "open" });
    expect(result).toMatchObject({ contract: "bounded-ax-v1", total: 1, authenticated: true });
    expect(JSON.stringify(result)).not.toContain("unbounded body");
  });

  it("creates, validates, and bounds config-backed plans", () => {
    const inputs: InputConfig = {
      version: 1,
      target: "main",
      items: [
        { name: "one", deps: [], strategy: "merge-weave", gates: [] },
        { name: "two", deps: ["one"], strategy: "merge-weave", gates: [] },
      ],
      sources: [],
    };
    const plan = new PlanCreationService().fromInputs(inputs);
    expect(plan.items.map(({ name }) => name)).toEqual(["one", "two"]);
  });

  it("gives status and merge order the same bounded-ax-v1 contract", () => {
    const plan = new PlanCreationService().fromInputs({
      version: 1,
      target: "main",
      items: [
        { name: "one", deps: [], strategy: "merge-weave", gates: [] },
        { name: "two", deps: ["one"], strategy: "merge-weave", gates: [] },
      ],
      sources: [],
    });
    expect(new IntegrationStatusQueryService().run(plan)).toMatchObject({
      contract: "bounded-ax-v1",
      plan: { itemCount: 2 },
    });
    expect(new MergeOrderQueryService().run(plan)).toEqual({
      contract: "bounded-ax-v1",
      levels: [["one"], ["two"]],
      totalItems: 2,
      maxParallelism: 1,
    });
  });

  it("fails with a stable code when a collection exceeds its bound", () => {
    const inputs: InputConfig = {
      version: 1,
      target: "main",
      items: Array.from({ length: 257 }, (_, index) => ({
        name: `item-${index}`,
        deps: [],
        strategy: "merge-weave" as const,
        gates: [],
      })),
      sources: [],
    };
    expect(() => new PlanCreationService().fromInputs(inputs)).toThrowError(
      expect.objectContaining<Partial<IntegrationQueryServiceError>>({
        code: "QUERY_RESULT_LIMIT_EXCEEDED",
      })
    );
  });
});
