import { describe, it, expect, beforeEach, vi } from "vitest";
import { TTLCache, getIssueCache, resetIssueCache } from "../../../src/cache/issue-cache.js";

describe("TTLCache", () => {
  let cache: TTLCache<string, string>;

  beforeEach(() => {
    cache = new TTLCache({ ttl: 100, maxSize: 3 });
  });

  it("stores and retrieves values", () => {
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");
  });

  it("returns undefined for missing keys", () => {
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("expires values after TTL", async () => {
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(cache.get("key1")).toBeUndefined();
  });

  it("checks if key exists and is not expired", async () => {
    cache.set("key1", "value1");
    expect(cache.has("key1")).toBe(true);

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(cache.has("key1")).toBe(false);
  });

  it("deletes values", () => {
    cache.set("key1", "value1");
    expect(cache.has("key1")).toBe(true);

    cache.delete("key1");
    expect(cache.has("key1")).toBe(false);
  });

  it("clears all values", () => {
    cache.set("key1", "value1");
    cache.set("key2", "value2");
    expect(cache.size).toBe(2);

    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("evicts oldest entry when max size reached", () => {
    cache.set("key1", "value1");
    cache.set("key2", "value2");
    cache.set("key3", "value3");
    cache.set("key4", "value4"); // Should evict key1

    expect(cache.has("key1")).toBe(false);
    expect(cache.has("key2")).toBe(true);
    expect(cache.has("key3")).toBe(true);
    expect(cache.has("key4")).toBe(true);
  });

  it("reports correct size", () => {
    expect(cache.size).toBe(0);

    cache.set("key1", "value1");
    expect(cache.size).toBe(1);

    cache.set("key2", "value2");
    expect(cache.size).toBe(2);

    cache.delete("key1");
    expect(cache.size).toBe(1);
  });
});

describe("getIssueCache", () => {
  beforeEach(() => {
    resetIssueCache();
  });

  it("creates a global cache instance", () => {
    const cache1 = getIssueCache();
    const cache2 = getIssueCache();

    expect(cache1).toBe(cache2); // Same instance
  });

  it("accepts custom options", () => {
    const cache = getIssueCache({ ttl: 5000 });
    cache.set("test", {
      number: 1,
      title: "Test",
      body: null,
      state: "open",
      labels: [],
      user: { login: "user" },
      assignees: [],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });

    expect(cache.has("test")).toBe(true);
  });

  it("can be reset", () => {
    const cache1 = getIssueCache();
    cache1.set("test", {
      number: 1,
      title: "Test",
      body: null,
      state: "open",
      labels: [],
      user: { login: "user" },
      assignees: [],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });

    resetIssueCache();

    const cache2 = getIssueCache();
    expect(cache2.has("test")).toBe(false);
  });
});
