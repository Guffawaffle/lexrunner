import { describe, it, expect } from "vitest";
import { FeatureSpecV0Schema } from "../.smartergpt/schemas/feature-spec-v0.js";

describe("FeatureSpecV0Schema", () => {
  it("validates valid spec", () => {
    const validSpec = {
      schemaVersion: "0.1.0",
      title: "Test Feature",
      description: "Test description",
      acceptanceCriteria: ["AC1", "AC2"],
      repo: "owner/repo",
      createdAt: "2025-11-09T14:30:00.000Z",
    };

    const result = FeatureSpecV0Schema.safeParse(validSpec);
    expect(result.success).toBe(true);
  });

  it("validates spec with optional fields", () => {
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
    expect(result.success).toBe(true);
  });

  it("rejects missing title", () => {
    const invalidSpec = {
      schemaVersion: "0.1.0",
      description: "Test",
      acceptanceCriteria: ["AC1"],
      repo: "owner/repo",
      createdAt: "2025-11-09T14:30:00.000Z",
    };

    const result = FeatureSpecV0Schema.safeParse(invalidSpec);
    expect(result.success).toBe(false);
  });

  it("rejects invalid repo format", () => {
    const invalidSpec = {
      schemaVersion: "0.1.0",
      title: "Test",
      description: "Test",
      acceptanceCriteria: ["AC1"],
      repo: "invalid-repo",
      createdAt: "2025-11-09T14:30:00.000Z",
    };

    const result = FeatureSpecV0Schema.safeParse(invalidSpec);
    expect(result.success).toBe(false);
  });

  it("rejects empty acceptance criteria array", () => {
    const invalidSpec = {
      schemaVersion: "0.1.0",
      title: "Test",
      description: "Test",
      acceptanceCriteria: [],
      repo: "owner/repo",
      createdAt: "2025-11-09T14:30:00.000Z",
    };

    const result = FeatureSpecV0Schema.safeParse(invalidSpec);
    expect(result.success).toBe(false);
  });

  it("rejects title exceeding max length", () => {
    const invalidSpec = {
      schemaVersion: "0.1.0",
      title: "a".repeat(201),
      description: "Test",
      acceptanceCriteria: ["AC1"],
      repo: "owner/repo",
      createdAt: "2025-11-09T14:30:00.000Z",
    };

    const result = FeatureSpecV0Schema.safeParse(invalidSpec);
    expect(result.success).toBe(false);
  });

  it("rejects invalid schema version", () => {
    const invalidSpec = {
      schemaVersion: "1.0.0",
      title: "Test",
      description: "Test",
      acceptanceCriteria: ["AC1"],
      repo: "owner/repo",
      createdAt: "2025-11-09T14:30:00.000Z",
    };

    const result = FeatureSpecV0Schema.safeParse(invalidSpec);
    expect(result.success).toBe(false);
  });

  it("rejects invalid datetime format", () => {
    const invalidSpec = {
      schemaVersion: "0.1.0",
      title: "Test",
      description: "Test",
      acceptanceCriteria: ["AC1"],
      repo: "owner/repo",
      createdAt: "invalid-date",
    };

    const result = FeatureSpecV0Schema.safeParse(invalidSpec);
    expect(result.success).toBe(false);
  });

  it("validates acceptance criteria with max items", () => {
    const validSpec = {
      schemaVersion: "0.1.0",
      title: "Test",
      description: "Test",
      acceptanceCriteria: Array(20).fill("AC"),
      repo: "owner/repo",
      createdAt: "2025-11-09T14:30:00.000Z",
    };

    const result = FeatureSpecV0Schema.safeParse(validSpec);
    expect(result.success).toBe(true);
  });

  it("rejects acceptance criteria exceeding max items", () => {
    const invalidSpec = {
      schemaVersion: "0.1.0",
      title: "Test",
      description: "Test",
      acceptanceCriteria: Array(21).fill("AC"),
      repo: "owner/repo",
      createdAt: "2025-11-09T14:30:00.000Z",
    };

    const result = FeatureSpecV0Schema.safeParse(invalidSpec);
    expect(result.success).toBe(false);
  });
});
