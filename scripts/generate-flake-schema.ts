#!/usr/bin/env tsx
/**
 * Generate JSON schema from Zod flake report schema
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import { FlakeReport } from "../src/schema/flakeReport.js";
import * as fs from "fs";
import * as path from "path";

const schema = zodToJsonSchema(FlakeReport, {
	name: "FlakeReport",
	$refStrategy: "none"
});

// Add metadata
const jsonSchema = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: "https://example.com/schemas/flake-report.schema.json",
	title: "Flake Report Schema",
	description: "Schema for tracking gate retry attempts and transient failures. Emitted when a gate requires multiple attempts to pass or ultimately fails after retries.",
	version: "1.0.0",
	...schema
};

// Write to schemas directory
const schemaPath = path.join(process.cwd(), "schemas", "flake-report.schema.json");
fs.writeFileSync(schemaPath, JSON.stringify(jsonSchema, null, 2));

console.log(`✓ Generated flake-report.schema.json at ${schemaPath}`);
