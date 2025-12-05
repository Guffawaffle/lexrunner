/**
 * Tests for the doctor command module
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Command } from "commander";
import { registerDoctorCommand } from "../../src/commands/doctor.js";

describe("Doctor Command", () => {
	let program: Command;

	beforeEach(() => {
		// Create fresh Command instance for each test
		program = new Command();
	});

	it("should register doctor command with correct configuration", () => {
		registerDoctorCommand(program, () => false);

		const doctorCommand = program.commands.find(
			(cmd) => cmd.name() === "doctor"
		);
		expect(doctorCommand).toBeDefined();
		expect(doctorCommand?.name()).toBe("doctor");
		expect(doctorCommand?.description()).toBe(
			"Environment and config sanity checks (canonical: lex-pr workspace doctor)"
		);

		// Check options
		const opts = doctorCommand?.options;
		const bootstrapOption = opts?.find((opt) => opt.long === "--bootstrap");
		expect(bootstrapOption).toBeDefined();
		expect(bootstrapOption?.description).toBe(
			"Create minimal workspace configuration if missing"
		);

		const jsonOption = opts?.find((opt) => opt.long === "--json");
		expect(jsonOption).toBeDefined();
		expect(jsonOption?.description).toBe("Output JSON format");
		
		const environmentQualityOption = opts?.find(opt => opt.long === "--environment-quality");
		expect(environmentQualityOption).toBeDefined();
		expect(environmentQualityOption?.description).toBe("Run environmental hostility scoring");
	});

	it("should have no required arguments", () => {
		registerDoctorCommand(program, () => false);

		const doctorCommand = program.commands.find(
			(cmd) => cmd.name() === "doctor"
		);
		const args = (doctorCommand as any)._args;
		expect(args).toHaveLength(0);
	});

	it("should register with program successfully", () => {
		const initialCommandCount = program.commands.length;
		registerDoctorCommand(program, () => false);

		expect(program.commands.length).toBe(initialCommandCount + 1);
		expect(program.commands.some((cmd) => cmd.name() === "doctor")).toBe(
			true
		);
	});
});
