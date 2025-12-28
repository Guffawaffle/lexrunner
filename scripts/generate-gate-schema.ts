#!/usr/bin/env tsx
/**
 * Generate JSON schema from Zod gate report schema
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import { GateReport } from "../src/schema/gateReport.js";
import * as fs from "fs";
import * as path from "path";

const schema = zodToJsonSchema(GateReport, {
  name: "GateReport",
  $refStrategy: "none",
});

// Add metadata
// Note: zodToJsonSchema generates draft-07 schemas, so we specify that here
// for consistency with the generated output
const jsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://example.com/schemas/gate-report.schema.json",
  title: "Gate Report Schema",
  description:
    "Schema for gate execution reports with stable keys and deterministic output. Supports schema versioning and artifact metadata.",
  version: "1.0.0",
  ...schema,
};

// Write to schemas directory
const schemaPath = path.join(process.cwd(), "schemas", "gate-report.schema.json");
fs.writeFileSync(schemaPath, JSON.stringify(jsonSchema, null, 2));

console.log(`✓ Generated gate-report.schema.json at ${schemaPath}`);
