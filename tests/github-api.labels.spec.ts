import { describe, it, expect } from "vitest";
import { extractLabelName } from "../src/github/api.js";

describe("extractLabelName", () => {
  it("returns empty string for falsy label", () => {
    expect(extractLabelName(null)).toBe("");
    expect(extractLabelName(undefined)).toBe("");
  });

  it("returns string labels unchanged", () => {
    expect(extractLabelName("bug")).toBe("bug");
  });

  it("returns name property from object label", () => {
    expect(extractLabelName({ name: "enhancement" })).toBe("enhancement");
  });

  it("returns empty string for object without name", () => {
    expect(extractLabelName({})).toBe("");
  });
});
