#!/usr/bin/env tsx
/**
 * Generate JSON schema from Zod plan schema
 */
import { z } from "zod";
import { Plan } from "../src/schema.js";
import * as fs from "fs";
import * as path from "path";

const schema = z.toJSONSchema(Plan, { target: "draft-7", io: "input" });
if (schema.type !== "object" || !schema.properties?.gitInputs) {
  throw new Error("Generated plan schema is missing its object contract or frozen Git inputs");
}

// Add metadata
// Keep the existing public definition reference while using the installed Zod 4 exporter.
const jsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://example.com/schemas/plan.schema.json",
  title: "lex-pr plan schema v1",
  description: "Schema for plan.json files - generated from Zod schema in src/schema.ts",
  $ref: "#/definitions/Plan",
  definitions: { Plan: schema },
};

// Write to schemas directory
const schemaPath = path.join(process.cwd(), "schemas", "plan.schema.json");
fs.writeFileSync(schemaPath, `${JSON.stringify(jsonSchema, null, 2)}\n`);

console.log(`✓ Generated plan.schema.json at ${schemaPath}`);
