/**
 * Tests for Feature Spec v0 Schema validation
 *
 * Run with: npx tsx --test tests/feature-spec-v0.test.ts
 */

import { test, describe } from "node:test";
import assert from "node:assert";
import { FeatureSpecV0Schema } from "../.smartergpt/schemas/feature-spec-v0.js";

describe("FeatureSpecV0Schema", () => {
  test("validates valid spec", () => {
    const validSpec = {
      schemaVersion: "0.1.0",
      title: "Test Feature",
      description: "Test description",
      acceptanceCriteria: ["AC1", "AC2"],
      repo: "owner/repo",
      createdAt: "2025-11-09T14:30:00.000Z",
    };

    const result = FeatureSpecV0Schema.safeParse(validSpec);
    assert.ok(result.success, "Valid spec should parse successfully");
  });

  test("validates spec with optional fields", () => {
    const validSpec = {
      schemaVersion: "0.1.0",
      title: "Test Feature",
      description: "Test description",
      acceptanceCriteria: ["AC1", "AC2"],
      technicalContext: "Some technical context",
      constraints: "Some constraints",
      repo: "owner/repo",
      createdAt: "2025-11-09T14:30:00.000Z",
    };

    const result = FeatureSpecV0Schema.safeParse(validSpec);
    assert.ok(result.success, "Valid spec with optional fields should parse successfully");
  });

  test("rejects missing title", () => {
    const invalidSpec = {
      schemaVersion: "0.1.0",
      description: "Test",
      acceptanceCriteria: ["AC1"],
      repo: "owner/repo",
      createdAt: "2025-11-09T14:30:00.000Z",
    };

    const result = FeatureSpecV0Schema.safeParse(invalidSpec);
    assert.ok(!result.success, "Spec without title should fail");
  });

  test("rejects invalid repo format", () => {
    const invalidSpec = {
      schemaVersion: "0.1.0",
      title: "Test",
      description: "Test",
      acceptanceCriteria: ["AC1"],
      repo: "invalid-repo",
      createdAt: "2025-11-09T14:30:00.000Z",
    };

    const result = FeatureSpecV0Schema.safeParse(invalidSpec);
    assert.ok(!result.success, "Spec with invalid repo format should fail");
  });

  test("rejects empty acceptance criteria array", () => {
    const invalidSpec = {
      schemaVersion: "0.1.0",
      title: "Test",
      description: "Test",
      acceptanceCriteria: [],
      repo: "owner/repo",
      createdAt: "2025-11-09T14:30:00.000Z",
    };

    const result = FeatureSpecV0Schema.safeParse(invalidSpec);
    assert.ok(!result.success, "Spec with empty acceptance criteria should fail");
  });

  test("rejects title exceeding max length", () => {
    const invalidSpec = {
      schemaVersion: "0.1.0",
      title: "a".repeat(201),
      description: "Test",
      acceptanceCriteria: ["AC1"],
      repo: "owner/repo",
      createdAt: "2025-11-09T14:30:00.000Z",
    };

    const result = FeatureSpecV0Schema.safeParse(invalidSpec);
    assert.ok(!result.success, "Spec with title exceeding max length should fail");
  });

  test("rejects invalid schema version", () => {
    const invalidSpec = {
      schemaVersion: "1.0.0",
      title: "Test",
      description: "Test",
      acceptanceCriteria: ["AC1"],
      repo: "owner/repo",
      createdAt: "2025-11-09T14:30:00.000Z",
    };

    const result = FeatureSpecV0Schema.safeParse(invalidSpec);
    assert.ok(!result.success, "Spec with wrong schema version should fail");
  });

  test("rejects invalid datetime format", () => {
    const invalidSpec = {
      schemaVersion: "0.1.0",
      title: "Test",
      description: "Test",
      acceptanceCriteria: ["AC1"],
      repo: "owner/repo",
      createdAt: "invalid-date",
    };

    const result = FeatureSpecV0Schema.safeParse(invalidSpec);
    assert.ok(!result.success, "Spec with invalid datetime should fail");
  });

  test("validates acceptance criteria with max items", () => {
    const validSpec = {
      schemaVersion: "0.1.0",
      title: "Test",
      description: "Test",
      acceptanceCriteria: Array(20).fill("AC"),
      repo: "owner/repo",
      createdAt: "2025-11-09T14:30:00.000Z",
    };

    const result = FeatureSpecV0Schema.safeParse(validSpec);
    assert.ok(result.success, "Spec with 20 acceptance criteria should succeed");
  });

  test("rejects acceptance criteria exceeding max items", () => {
    const invalidSpec = {
      schemaVersion: "0.1.0",
      title: "Test",
      description: "Test",
      acceptanceCriteria: Array(21).fill("AC"),
      repo: "owner/repo",
      createdAt: "2025-11-09T14:30:00.000Z",
    };

    const result = FeatureSpecV0Schema.safeParse(invalidSpec);
    assert.ok(!result.success, "Spec with 21 acceptance criteria should fail");
  });
});
