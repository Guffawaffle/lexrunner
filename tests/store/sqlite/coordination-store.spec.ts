import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteCoordinationStore } from "../../../src/store/sqlite/coordination-store.js";
import { runCoordinationStoreBehaviorTests } from "../coordination-store.behavior.js";

runCoordinationStoreBehaviorTests({
  name: "SqliteCoordinationStore",
  async create() {
    const directory = await mkdtemp(join(tmpdir(), "lexrunner-coordination-"));
    const databasePath = join(directory, "coordination.db");
    const primary = new SqliteCoordinationStore(databasePath);
    const secondary = new SqliteCoordinationStore(databasePath);
    return {
      primary,
      secondary,
      async cleanup() {
        await primary.close();
        await secondary.close();
        await rm(directory, { recursive: true, force: true });
      },
    };
  },
});
