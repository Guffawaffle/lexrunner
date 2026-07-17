import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/cli.ts",
    "src/sdk/index.ts",
    "src/frames/index.ts",
    "src/hooks/events.ts",
    "src/errors/index.ts",
  ],
  format: ["esm", "cjs"],
  dts: {
    // tsup 8.5.1 injects the TypeScript 6-deprecated baseUrl option into DTS builds.
    compilerOptions: { ignoreDeprecations: "6.0" },
  },
  outDir: "dist",
  clean: true,
  // Suppress expected warnings about import.meta in CJS builds
  // See src/cli.ts entry point detection comments for rationale
  esbuildOptions(options) {
    options.logOverride = {
      ...options.logOverride,
      "empty-import-meta": "silent",
    };
  },
});
