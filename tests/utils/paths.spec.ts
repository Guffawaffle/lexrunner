/**
 * Path Utilities Tests
 */

import { describe, it, expect } from "vitest";
import { normalizePath, isSafeArtifactPath } from "../../src/utils/paths.js";
import * as path from "path";

describe("Path Utilities", () => {
	describe("normalizePath", () => {
		it("should return absolute path for absolute input", () => {
			const absolutePath = "/tmp/test/file.txt";
			const result = normalizePath(absolutePath);
			expect(path.isAbsolute(result)).toBe(true);
			expect(result).toBe(path.normalize(absolutePath));
		});

		it("should resolve relative path to absolute", () => {
			const relativePath = "./test/file.txt";
			const result = normalizePath(relativePath);
			expect(path.isAbsolute(result)).toBe(true);
		});

		it("should handle Windows-style paths", () => {
			const windowsPath = "C:\\Users\\test\\file.txt";
			const result = normalizePath(windowsPath);
			expect(path.isAbsolute(result)).toBe(true);
		});

		it("should use custom base directory", () => {
			const relativePath = "file.txt";
			const baseDir = "/custom/base";
			const result = normalizePath(relativePath, baseDir);
			expect(result).toBe(path.resolve(baseDir, relativePath));
		});

		it("should normalize paths with multiple slashes", () => {
			const messyPath = "./test//nested///file.txt";
			const result = normalizePath(messyPath);
			expect(path.isAbsolute(result)).toBe(true);
		});
	});

	describe("isSafeArtifactPath", () => {
		it("should allow safe paths", () => {
			expect(isSafeArtifactPath("/tmp/output/plan.json")).toBe(true);
			expect(isSafeArtifactPath(".smartergpt.local/deliverables/_session/plan.json")).toBe(true);
			expect(isSafeArtifactPath("/home/user/projects/file.txt")).toBe(true);
		});

		it("should reject paths with pr- directory (Unix)", () => {
			expect(isSafeArtifactPath("/tmp/pr-123/file.txt")).toBe(false);
			expect(isSafeArtifactPath(".smartergpt.local/pr-456/plan.json")).toBe(false);
		});

		it("should reject paths with pr- directory (Windows)", () => {
			expect(isSafeArtifactPath("C:\\projects\\pr-123\\file.txt")).toBe(false);
		});

		it("should reject paths with PR- directory (case-sensitive)", () => {
			expect(isSafeArtifactPath("/tmp/PR-123/file.txt")).toBe(false);
			expect(isSafeArtifactPath("C:\\projects\\PR-456\\file.txt")).toBe(false);
		});

		it("should allow paths with pr- in filename but not directory", () => {
			expect(isSafeArtifactPath("/tmp/output/pr-123-plan.json")).toBe(true);
		});
	});
});
