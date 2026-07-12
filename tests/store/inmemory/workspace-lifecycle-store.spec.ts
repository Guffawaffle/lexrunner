import { InMemoryWorkspaceLifecycleStore } from "../../../src/store/inmemory/workspace-lifecycle-store.js";
import { runWorkspaceLifecycleStoreBehaviorTests } from "../workspace-lifecycle-store.behavior.js";

runWorkspaceLifecycleStoreBehaviorTests({
  name: "InMemoryWorkspaceLifecycleStore",
  async create() {
    return new InMemoryWorkspaceLifecycleStore();
  },
});
