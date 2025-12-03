import * as fs from 'fs';
import * as path from 'path';
import { securityCommandBlockedError } from "../errors/index.js";
import { AXErrorException } from "@smartergpt/lex/errors";

export interface CommandWhitelist {
	version: string;
	mode: 'strict' | 'permissive';
	defaults: Record<string, {
		commands: string[];
		allow_args: string[];
		deny_args: string[];
	}>;
	custom: Record<string, {
		binary: string;
		allow_args: string[];
		deny_args: string[];
	}>;
	policy: {
		allow_shell_operators: boolean;
		allow_env_vars: string[];
		max_command_length: number;
		hallucination_threshold: number;
		dry_run_mode: boolean;
	};
}

export class CommandValidationError extends Error {
	public readonly command: string;
	public readonly reason: 'not_whitelisted' | 'dangerous_args' | 'shell_operators' | 'too_long';

	constructor(command: string, reason: CommandValidationError['reason']) {
		const messages = {
			not_whitelisted: 'Command not in whitelist. Add to .smartergpt/allowed-commands.json if legitimate.',
			dangerous_args: 'Command contains dangerous arguments that are explicitly denied.',
			shell_operators: 'Command contains shell operators (|, >, <, &&, ||) which are not allowed.',
			too_long: 'Command exceeds maximum allowed length.'
		};
		super(`Command validation failed: ${messages[reason]}\nCommand: ${command}`);
		this.name = 'CommandValidationError';
		this.command = command;
		this.reason = reason;
	}
}

export class CommandValidator {
	private whitelist: CommandWhitelist;
	private hallucinationCount = 0;

	constructor(whitelistPath?: string) {
		const defaultPath = path.join(process.cwd(), '.smartergpt/allowed-commands.json');
		const resolvedPath = whitelistPath ?? defaultPath;

		try {
			this.whitelist = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
		} catch (err) {
			console.warn(`Failed to load command whitelist from ${resolvedPath}, using permissive mode`);
			this.whitelist = this.getDefaultWhitelist();
		}
	}

	/**
	 * Validates a command before execution
	 * @throws {CommandValidationError} if command is not allowed
	 */
	public validate(command: string): void {
		// In permissive mode, only log warnings
		if (this.whitelist.mode === 'permissive') {
			return;
		}

		// Check length
		if (command.length > this.whitelist.policy.max_command_length) {
			this.recordHallucination(command, 'too_long');
			throw new CommandValidationError(command, 'too_long');
		}

		// Check for shell operators
		if (!this.whitelist.policy.allow_shell_operators) {
			const shellOperators = ['|', '>', '<', '&&', '||', ';', '`', '$((', '$('];
			if (shellOperators.some(op => command.includes(op))) {
				this.recordHallucination(command, 'shell_operators');
				throw new CommandValidationError(command, 'shell_operators');
			}
		}

		// Parse command
		const [binary, ...args] = command.split(/\s+/);

		// Check against whitelist
		const isDefault = this.whitelist.defaults[binary];
		const isCustom = this.whitelist.custom[binary];

		if (!isDefault && !isCustom) {
			this.recordHallucination(command, 'not_whitelisted');
			throw new CommandValidationError(command, 'not_whitelisted');
		}

		// Validate args
		const allowedArgs = isDefault?.allow_args ?? isCustom?.allow_args ?? [];
		const deniedArgs = isDefault?.deny_args ?? isCustom?.deny_args ?? [];

		for (const arg of args) {
			if (deniedArgs.some(denied => arg.startsWith(denied))) {
				this.recordHallucination(command, 'dangerous_args');
				throw new CommandValidationError(command, 'dangerous_args');
			}
		}

		// In dry-run mode, log but don't throw
		if (this.whitelist.policy.dry_run_mode) {
			console.info(`[DRY RUN] Command validated: ${command}`);
		}
	}

	private recordHallucination(command: string, reason: string): void {
		this.hallucinationCount++;

		console.error('Command hallucination detected', {
			command,
			reason,
			count: this.hallucinationCount,
			threshold: this.whitelist.policy.hallucination_threshold
		});

		if (this.hallucinationCount >= this.whitelist.policy.hallucination_threshold) {
			this.escalateToHuman();
		}
	}

	private escalateToHuman(): void {
		console.error(`⏸️  AGENT PAUSED: Hallucination threshold reached (${this.hallucinationCount} attempts)`);
		// TODO: Create GitHub issue, send notification
		const axError = securityCommandBlockedError(
			`Agent paused after ${this.hallucinationCount} hallucinated commands. Human review required.`,
			{
				command: 'multiple',
				reason: 'hallucination_threshold',
				hallucinationCount: this.hallucinationCount,
				threshold: this.whitelist.policy.hallucination_threshold,
			}
		);
		throw new AXErrorException(axError.code, axError.message, axError.nextActions, axError.context);
	}

	public resetHallucinationCount(): void {
		this.hallucinationCount = 0;
	}

	public getHallucinationCount(): number {
		return this.hallucinationCount;
	}

	private getDefaultWhitelist(): CommandWhitelist {
		return {
			version: '1.0.0',
			mode: 'permissive',
			defaults: {
				npm: { commands: ['test', 'run build', 'run lint'], allow_args: [], deny_args: [] },
				git: { commands: ['status', 'diff'], allow_args: [], deny_args: [] }
			},
			custom: {},
			policy: {
				allow_shell_operators: false,
				allow_env_vars: ['NODE_ENV', 'CI'],
				max_command_length: 500,
				hallucination_threshold: 3,
				dry_run_mode: false
			}
		};
	}
}

// Singleton instance
let validator: CommandValidator | null = null;

export function getCommandValidator(whitelistPath?: string): CommandValidator {
	if (!validator) {
		validator = new CommandValidator(whitelistPath);
	}
	return validator;
}

export function resetCommandValidator(): void {
	validator = null;
}
