import { InMemoryCoordinationStore } from "../../../src/store/inmemory/coordination-store.js";
import { runCoordinationStoreBehaviorTests } from "../coordination-store.behavior.js";

runCoordinationStoreBehaviorTests({
  name: "InMemoryCoordinationStore",
  async create() {
    const store = new InMemoryCoordinationStore();
    return {
      primary: store,
      secondary: store,
      async cleanup() {
        await store.close();
      },
    };
  },
});
