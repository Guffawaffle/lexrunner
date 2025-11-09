/**
 * Validation Utilities Tests
 */

import { describe, it, expect } from "vitest";
import { validate, ValidationError } from "../../src/utils/validation.js";
import { z } from "zod";

describe("Validation Utilities", () => {
	describe("validate", () => {
		const testSchema = z.object({
			name: z.string(),
			age: z.number(),
			email: z.string().email()
		});

		it("should validate correct data", () => {
			const data = {
				name: "John Doe",
				age: 30,
				email: "john@example.com"
			};

			const result = validate(data, testSchema);
			expect(result).toEqual(data);
		});

		it("should throw ValidationError for invalid data", () => {
			const data = {
				name: "John Doe",
				age: "not a number",
				email: "invalid-email"
			};

			expect(() => validate(data, testSchema)).toThrow(ValidationError);
		});

		it("should include error details in ValidationError", () => {
			const data = {
				name: "John Doe",
				age: "not a number",
				email: "invalid-email"
			};

			try {
				validate(data, testSchema);
				expect.fail("Should have thrown ValidationError");
			} catch (error) {
				expect(error).toBeInstanceOf(ValidationError);
				expect((error as ValidationError).message).toContain("Schema validation failed");
			}
		});

		it("should apply defaults from schema", () => {
			const schemaWithDefaults = z.object({
				name: z.string(),
				role: z.string().default("user")
			});

			const data = { name: "John Doe" };
			const result = validate(data, schemaWithDefaults);
			
			expect(result).toEqual({
				name: "John Doe",
				role: "user"
			});
		});

		it("should validate nested objects", () => {
			const nestedSchema = z.object({
				user: z.object({
					name: z.string(),
					email: z.string().email()
				}),
				active: z.boolean()
			});

			const data = {
				user: {
					name: "John Doe",
					email: "john@example.com"
				},
				active: true
			};

			const result = validate(data, nestedSchema);
			expect(result).toEqual(data);
		});

		it("should validate arrays", () => {
			const arraySchema = z.object({
				items: z.array(z.string()).min(1)
			});

			const data = {
				items: ["item1", "item2", "item3"]
			};

			const result = validate(data, arraySchema);
			expect(result).toEqual(data);
		});

		it("should reject empty arrays when minimum is set", () => {
			const arraySchema = z.object({
				items: z.array(z.string()).min(1)
			});

			const data = {
				items: []
			};

			expect(() => validate(data, arraySchema)).toThrow(ValidationError);
		});
	});
});
