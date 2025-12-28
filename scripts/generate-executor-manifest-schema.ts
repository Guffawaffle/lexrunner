#!/usr/bin/env tsx
/**
 * Generate JSON schema from Zod executor manifest schema
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import { ExecutorManifestSchema } from "../src/schemas/executorManifest.js";
import * as fs from "fs";
import * as path from "path";

const schema = zodToJsonSchema(ExecutorManifestSchema, {
  name: "ExecutorManifest",
  $refStrategy: "none",
});

// Add metadata
// Note: zodToJsonSchema generates draft-07 schemas
const jsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://example.com/schemas/executor-manifest.schema.json",
  title: "Executor Manifest Schema v1.0.0",
  description:
    "Schema for executor-manifest.yaml files - generated from Zod schema in src/schemas/executorManifest.ts. Based on v0.3.0 thesis: Section 3.3 (Executors as Operational Units)",
  ...schema,
};

// Write to schemas directory
const schemaPath = path.join(process.cwd(), "schemas", "executor-manifest.schema.json");
fs.writeFileSync(schemaPath, JSON.stringify(jsonSchema, null, 2));

console.log(`✓ Generated executor-manifest.schema.json at ${schemaPath}`);
