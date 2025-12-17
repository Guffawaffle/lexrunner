/**
 * Tests for JSON envelope utilities
 */

import { describe, it, expect } from "vitest";
import {
	createSuccessEnvelope,
	createErrorEnvelope,
	errorToJsonError,
	type JsonSuccessEnvelope,
	type JsonErrorEnvelope,
} from "../src/cli/jsonEnvelope.js";

describe("JSON Envelope Utilities", () => {
	describe("createSuccessEnvelope", () => {
		it("should create a valid success envelope", () => {
			const data = { items: [1, 2, 3], total: 3 };
			const envelope = createSuccessEnvelope("weave discover", data);

			expect(envelope).toMatchObject({
				success: true,
				data,
				meta: {
					command: "weave discover",
					version: "0.5.0",
				},
			});
			expect(envelope.meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
		});

		it("should preserve data structure", () => {
			const complexData = {
				pullRequests: [
					{ number: 1, title: "PR 1" },
					{ number: 2, title: "PR 2" },
				],
				total: 2,
				authenticated: true,
			};
			const envelope = createSuccessEnvelope("weave discover", complexData);

			expect(envelope.data).toEqual(complexData);
		});
	});

	describe("createErrorEnvelope", () => {
		it("should create a valid error envelope", () => {
			const error = {
				code: "ENOTFOUND",
				message: "Plan file not found",
				details: { path: "/path/to/plan.json" },
			};
			const envelope = createErrorEnvelope("weave plan", error);

			expect(envelope).toMatchObject({
				success: false,
				error,
				meta: {
					command: "weave plan",
					version: "0.5.0",
				},
			});
			expect(envelope.meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
		});

		it("should handle error without details", () => {
			const error = {
				code: "EUNKNOWN",
				message: "Unknown error occurred",
			};
			const envelope = createErrorEnvelope("weave execute", error);

			expect(envelope.success).toBe(false);
			expect(envelope.error).toEqual(error);
		});
	});

	describe("errorToJsonError", () => {
		it("should convert Error object to JsonError", () => {
			const error = new Error("Test error");
			const jsonError = errorToJsonError(error, "ETEST");

			expect(jsonError).toMatchObject({
				code: "ETEST",
				message: "Test error",
				details: {
					name: "Error",
				},
			});
			expect(jsonError.details?.stack).toBeDefined();
		});

		it("should handle non-Error objects", () => {
			const error = "String error";
			const jsonError = errorToJsonError(error, "ESTRING");

			expect(jsonError).toEqual({
				code: "ESTRING",
				message: "String error",
				details: {},
			});
		});

		it("should use default error code", () => {
			const error = new Error("Test");
			const jsonError = errorToJsonError(error);

			expect(jsonError.code).toBe("EUNKNOWN");
		});
	});

	describe("envelope structure consistency", () => {
		it("should have consistent metadata structure", () => {
			const successEnv = createSuccessEnvelope("test", {});
			const errorEnv = createErrorEnvelope("test", {
				code: "E",
				message: "msg",
			});

			expect(successEnv.meta).toHaveProperty("command");
			expect(successEnv.meta).toHaveProperty("timestamp");
			expect(successEnv.meta).toHaveProperty("version");

			expect(errorEnv.meta).toHaveProperty("command");
			expect(errorEnv.meta).toHaveProperty("timestamp");
			expect(errorEnv.meta).toHaveProperty("version");
		});

		it("should always have success boolean field", () => {
			const successEnv = createSuccessEnvelope("test", {});
			const errorEnv = createErrorEnvelope("test", {
				code: "E",
				message: "msg",
			});

			expect(successEnv.success).toBe(true);
			expect(errorEnv.success).toBe(false);
		});
	});
});
