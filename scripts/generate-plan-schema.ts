#!/usr/bin/env tsx
/**
 * Generate JSON schema from Zod plan schema
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import { Plan } from "../src/schema.js";
import * as fs from "fs";
import * as path from "path";

const schema = zodToJsonSchema(Plan, {
	name: "Plan",
	$refStrategy: "none"
});

// Add metadata
// Note: zodToJsonSchema generates draft-07 schemas, so we specify that here
// for consistency with the generated output
const jsonSchema = {
	$schema: "http://json-schema.org/draft-07/schema#",
	$id: "https://example.com/schemas/plan.schema.json",
	title: "lex-pr plan schema v1",
	description: "Schema for plan.json files - generated from Zod schema in src/schema.ts",
	...schema
};

// Write to schemas directory
const schemaPath = path.join(process.cwd(), "schemas", "plan.schema.json");
fs.writeFileSync(schemaPath, JSON.stringify(jsonSchema, null, 2));

console.log(`✓ Generated plan.schema.json at ${schemaPath}`);