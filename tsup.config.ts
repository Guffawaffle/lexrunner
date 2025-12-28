import { defineConfig } from "tsup";

export default defineConfig({
  // Suppress expected warnings about import.meta in CJS builds
  // See src/cli.ts entry point detection comments for rationale
  esbuildOptions(options) {
    options.logOverride = {
      ...options.logOverride,
      "empty-import-meta": "silent",
    };
  },
});
