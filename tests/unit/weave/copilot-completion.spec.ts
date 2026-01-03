/**
 * Tests for Copilot PR completion detection utilities
 */

import { describe, it, expect } from "vitest";
import {
  hasAllChecklistItemsChecked,
  isCommitAgeAboveThreshold,
  isCopilotPRComplete,
} from "../../../src/weave/utils/copilot-completion.js";

describe("Copilot PR Completion Detection", () => {
  describe("hasAllChecklistItemsChecked", () => {
    it("returns true for PR with no body", () => {
      expect(hasAllChecklistItemsChecked(null)).toBe(true);
      expect(hasAllChecklistItemsChecked(undefined)).toBe(true);
      expect(hasAllChecklistItemsChecked("")).toBe(true);
    });

    it("returns true for PR with no checklist items", () => {
      const body = "This is a PR description without checklist items.";
      expect(hasAllChecklistItemsChecked(body)).toBe(true);
    });

    it("returns true when all checklist items are checked", () => {
      const body = `
## Checklist
- [x] Add feature X
- [x] Update tests
- [x] Update documentation
      `;
      expect(hasAllChecklistItemsChecked(body)).toBe(true);
    });

    it("returns false when some checklist items are unchecked", () => {
      const body = `
## Checklist
- [x] Add feature X
- [ ] Update tests
- [x] Update documentation
      `;
      expect(hasAllChecklistItemsChecked(body)).toBe(false);
    });

    it("returns false when all checklist items are unchecked", () => {
      const body = `
## Checklist
- [ ] Add feature X
- [ ] Update tests
- [ ] Update documentation
      `;
      expect(hasAllChecklistItemsChecked(body)).toBe(false);
    });

    it("handles mixed whitespace and indentation", () => {
      const body = `
  - [x] Task 1
    - [x] Subtask 1.1
- [x] Task 2
      `;
      expect(hasAllChecklistItemsChecked(body)).toBe(true);
    });

    it("handles checklist with unchecked item with whitespace", () => {
      const body = `
  - [ ] Task 1
  - [x] Task 2
      `;
      expect(hasAllChecklistItemsChecked(body)).toBe(false);
    });
  });

  describe("isCommitAgeAboveThreshold", () => {
    it("returns false for null or undefined commit date", () => {
      expect(isCommitAgeAboveThreshold(null)).toBe(false);
      expect(isCommitAgeAboveThreshold(undefined)).toBe(false);
    });

    it("returns false for recent commits (< threshold)", () => {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      expect(isCommitAgeAboveThreshold(twoMinutesAgo, 5)).toBe(false);
    });

    it("returns true for commits older than threshold", () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      expect(isCommitAgeAboveThreshold(tenMinutesAgo, 5)).toBe(true);
    });

    it("returns true for commits exactly at threshold", () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(isCommitAgeAboveThreshold(fiveMinutesAgo, 5)).toBe(true);
    });

    it("respects custom threshold values", () => {
      const eightMinutesAgo = new Date(Date.now() - 8 * 60 * 1000).toISOString();
      expect(isCommitAgeAboveThreshold(eightMinutesAgo, 10)).toBe(false);
      expect(isCommitAgeAboveThreshold(eightMinutesAgo, 5)).toBe(true);
    });
  });

  describe("isCopilotPRComplete", () => {
    it("returns true when all conditions are met", () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const result = isCopilotPRComplete({
        body: "- [x] Task completed",
        reviewRequested: true,
        lastCommitDate: tenMinutesAgo,
      });
      expect(result).toBe(true);
    });

    it("returns false when checklist is incomplete", () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const result = isCopilotPRComplete({
        body: "- [ ] Task not completed",
        reviewRequested: true,
        lastCommitDate: tenMinutesAgo,
      });
      expect(result).toBe(false);
    });

    it("returns false when review not requested", () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const result = isCopilotPRComplete({
        body: "- [x] Task completed",
        reviewRequested: false,
        lastCommitDate: tenMinutesAgo,
      });
      expect(result).toBe(false);
    });

    it("returns false when commit is too recent", () => {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const result = isCopilotPRComplete({
        body: "- [x] Task completed",
        reviewRequested: true,
        lastCommitDate: twoMinutesAgo,
      });
      expect(result).toBe(false);
    });

    it("returns false when commit date is missing", () => {
      const result = isCopilotPRComplete({
        body: "- [x] Task completed",
        reviewRequested: true,
        lastCommitDate: null,
      });
      expect(result).toBe(false);
    });

    it("respects custom commit age threshold", () => {
      const eightMinutesAgo = new Date(Date.now() - 8 * 60 * 1000).toISOString();

      // Default threshold (5 minutes) - should pass
      const resultDefault = isCopilotPRComplete({
        body: "- [x] Task completed",
        reviewRequested: true,
        lastCommitDate: eightMinutesAgo,
      });
      expect(resultDefault).toBe(true);

      // Custom threshold (10 minutes) - should fail
      const resultCustom = isCopilotPRComplete({
        body: "- [x] Task completed",
        reviewRequested: true,
        lastCommitDate: eightMinutesAgo,
        commitAgeThresholdMinutes: 10,
      });
      expect(resultCustom).toBe(false);
    });

    it("handles PR with no checklist (vacuously complete)", () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const result = isCopilotPRComplete({
        body: "Simple PR description without checklist",
        reviewRequested: true,
        lastCommitDate: tenMinutesAgo,
      });
      expect(result).toBe(true);
    });
  });
});
