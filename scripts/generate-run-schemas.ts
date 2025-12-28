#!/usr/bin/env tsx
/**
 * Generate JSON schemas from Zod run-centric schemas
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  StatusResponseSchema,
  NextOptionSchema,
  PersonaSnapshotSchema,
} from "../src/schemas/runCentric.js";
import * as fs from "fs";
import * as path from "path";

const schemasDir = path.join(process.cwd(), "schemas");

// Generate PersonaSnapshot schema
const personaSnapshotJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://example.com/schemas/persona-snapshot.schema.json",
  title: "Persona Snapshot Schema",
  description:
    "Schema for persona snapshot objects that capture the current persona mode and constraints.",
  version: "1.0.0",
  ...zodToJsonSchema(PersonaSnapshotSchema, {
    name: "PersonaSnapshot",
    $refStrategy: "none",
  }),
};

// Generate NextOption schema
const nextOptionJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://example.com/schemas/next-option.schema.json",
  title: "Next Option Schema",
  description:
    "Schema for next option objects that represent available actions in tool-grounded interactions.",
  version: "1.0.0",
  ...zodToJsonSchema(NextOptionSchema, {
    name: "NextOption",
    $refStrategy: "none",
  }),
};

// Generate StatusResponse schema
const statusResponseJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://example.com/schemas/status-response.schema.json",
  title: "Status Response Schema",
  description:
    "Schema for status response objects - the canonical response format for run status queries.",
  version: "1.0.0",
  ...zodToJsonSchema(StatusResponseSchema, {
    name: "StatusResponse",
    $refStrategy: "none",
  }),
};

// Write schemas to files
const personaPath = path.join(schemasDir, "persona-snapshot.schema.json");
fs.writeFileSync(personaPath, JSON.stringify(personaSnapshotJsonSchema, null, 2));
console.log(`✓ Generated persona-snapshot.schema.json at ${personaPath}`);

const nextOptionPath = path.join(schemasDir, "next-option.schema.json");
fs.writeFileSync(nextOptionPath, JSON.stringify(nextOptionJsonSchema, null, 2));
console.log(`✓ Generated next-option.schema.json at ${nextOptionPath}`);

const statusResponsePath = path.join(schemasDir, "status-response.schema.json");
fs.writeFileSync(statusResponsePath, JSON.stringify(statusResponseJsonSchema, null, 2));
console.log(`✓ Generated status-response.schema.json at ${statusResponsePath}`);
