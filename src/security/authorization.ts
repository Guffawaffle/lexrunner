/**
 * Role-Based Access Control (RBAC) for Autopilot Levels
 *
 * Implements permission checks and authorization for different autopilot operations
 */

import { AuthContext } from './authentication.js';
import { securityUnauthorizedError } from "../errors/index.js";
import { AXErrorException } from "@smartergpt/lex/errors";

/**
 * Permission types for autopilot operations
 */
export enum Permission {
	/** Read-only access - view plans and reports */
	READ = 'read',
	/** Can run Level 0-1 (report and artifacts) */
	ARTIFACTS = 'artifacts',
	/** Can run Level 2 (PR annotations) */
	ANNOTATE = 'annotate',
	/** Can run Level 3 (create branches and PRs) */
	CREATE_PR = 'create_pr',
	/** Can run Level 4 (full automation, merge PRs) */
	MERGE = 'merge',
	/** Administrative access */
	ADMIN = 'admin',
}

/**
 * Role definitions with associated permissions
 */
export interface Role {
	name: string;
	permissions: Permission[];
	description: string;
}

/**
 * Predefined roles
 */
export const ROLES: Record<string, Role> = {
	viewer: {
		name: 'viewer',
		permissions: [Permission.READ],
		description: 'Read-only access to plans and reports',
	},
	developer: {
		name: 'developer',
		permissions: [Permission.READ, Permission.ARTIFACTS, Permission.ANNOTATE],
		description: 'Can generate artifacts and annotate PRs',
	},
	integrator: {
		name: 'integrator',
		permissions: [Permission.READ, Permission.ARTIFACTS, Permission.ANNOTATE, Permission.CREATE_PR],
		description: 'Can create integration branches and PRs',
	},
	releaseManager: {
		name: 'release-manager',
		permissions: [Permission.READ, Permission.ARTIFACTS, Permission.ANNOTATE, Permission.CREATE_PR, Permission.MERGE],
		description: 'Can perform full automation including merges',
	},
	admin: {
		name: 'admin',
		permissions: [Permission.READ, Permission.ARTIFACTS, Permission.ANNOTATE, Permission.CREATE_PR, Permission.MERGE, Permission.ADMIN],
		description: 'Full administrative access',
	},
};

/**
 * Map autopilot levels to required permissions
 */
export const AUTOPILOT_LEVEL_PERMISSIONS: Record<number, Permission> = {
	0: Permission.READ,
	1: Permission.ARTIFACTS,
	2: Permission.ANNOTATE,
	3: Permission.CREATE_PR,
	4: Permission.MERGE,
};

/**
 * Authorization service for RBAC
 */
export class AuthorizationService {
	/**
	 * Check if user has a specific permission
	 */
	hasPermission(context: AuthContext, permission: Permission): boolean {
		// Admin role has all permissions
		if (context.roles.includes('admin')) {
			return true;
		}

		// Check each role for the permission
		for (const roleName of context.roles) {
			const role = ROLES[roleName];
			if (role && role.permissions.includes(permission)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Check if user can execute a specific autopilot level
	 */
	canExecuteAutopilotLevel(context: AuthContext, level: number): boolean {
		const requiredPermission = AUTOPILOT_LEVEL_PERMISSIONS[level];

		if (!requiredPermission) {
			// Unknown level, deny access
			return false;
		}

		return this.hasPermission(context, requiredPermission);
	}

	/**
	 * Get maximum autopilot level user can execute
	 */
	getMaxAutopilotLevel(context: AuthContext): number {
		for (let level = 4; level >= 0; level--) {
			if (this.canExecuteAutopilotLevel(context, level)) {
				return level;
			}
		}
		return -1; // No access
	}

	/**
	 * Check if user has any of the specified permissions
	 */
	hasAnyPermission(context: AuthContext, permissions: Permission[]): boolean {
		return permissions.some(permission => this.hasPermission(context, permission));
	}

	/**
	 * Check if user has all of the specified permissions
	 */
	hasAllPermissions(context: AuthContext, permissions: Permission[]): boolean {
		return permissions.every(permission => this.hasPermission(context, permission));
	}

	/**
	 * Get all permissions for a user
	 */
	getUserPermissions(context: AuthContext): Permission[] {
		const permissions = new Set<Permission>();

		// Admin has all permissions
		if (context.roles.includes('admin')) {
			return Object.values(Permission);
		}

		// Aggregate permissions from all roles
		for (const roleName of context.roles) {
			const role = ROLES[roleName];
			if (role) {
				role.permissions.forEach(p => permissions.add(p));
			}
		}

		return Array.from(permissions);
	}

	/**
	 * Enforce permission check (throws if not authorized)
	 */
	enforce(context: AuthContext, permission: Permission): void {
		if (!this.hasPermission(context, permission)) {
			const axError = securityUnauthorizedError(
				`Access denied: User '${context.user}' does not have '${permission}' permission`,
				{
					user: context.user,
					permission,
					roles: context.roles,
				}
			);
			throw new AXErrorException(axError.code, axError.message, axError.nextActions, axError.context);
		}
	}

	/**
	 * Enforce autopilot level check (throws if not authorized)
	 */
	enforceAutopilotLevel(context: AuthContext, level: number): void {
		if (!this.canExecuteAutopilotLevel(context, level)) {
			const maxLevel = this.getMaxAutopilotLevel(context);
			const axError = securityUnauthorizedError(
				`Access denied: User '${context.user}' cannot execute autopilot level ${level}`,
				{
					user: context.user,
					roles: context.roles,
					level,
					maxLevel,
				}
			);
			throw new AXErrorException(axError.code, axError.message, axError.nextActions, axError.context);
		}
	}

	/**
	 * Preflight check for operations before execution
	 * Returns validation result with detailed permissions info
	 */
	preflightCheck(context: AuthContext, requiredPermissions: Permission[]): {
		allowed: boolean;
		missingPermissions: Permission[];
		userPermissions: Permission[];
		recommendations?: string;
	} {
		const userPermissions = this.getUserPermissions(context);
		const missingPermissions = requiredPermissions.filter(
			required => !userPermissions.includes(required)
		);

		let recommendations: string | undefined;
		if (missingPermissions.length > 0) {
			// Suggest roles that would grant missing permissions
			const suggestedRoles: string[] = [];
			for (const [roleName, role] of Object.entries(ROLES)) {
				const wouldGrant = missingPermissions.some(p => role.permissions.includes(p));
				if (wouldGrant && !context.roles.includes(roleName)) {
					suggestedRoles.push(roleName);
				}
			}

			if (suggestedRoles.length > 0) {
				recommendations = `Consider adding role(s): ${suggestedRoles.join(', ')}`;
			}
		}

		return {
			allowed: missingPermissions.length === 0,
			missingPermissions,
			userPermissions,
			recommendations,
		};
	}

	/**
	 * Batch preflight check for multiple operations
	 */
	batchPreflightCheck(context: AuthContext, operations: {
		name: string;
		permissions: Permission[];
	}[]): {
		operation: string;
		allowed: boolean;
		missingPermissions: Permission[];
	}[] {
		return operations.map(op => {
			const check = this.preflightCheck(context, op.permissions);
			return {
				operation: op.name,
				allowed: check.allowed,
				missingPermissions: check.missingPermissions,
			};
		});
	}

	/**
	 * Recommend minimal covering set of roles for given permissions
	 * Returns roles in priority order: admin > release-manager > integrator > developer > viewer
	 *
	 * @param requiredPermissions - Permissions that need to be satisfied
	 * @returns Minimal set of role names that cover all required permissions
	 */
	recommendMinimalRoles(requiredPermissions: Permission[]): string[] {
		if (requiredPermissions.length === 0) {
			return [];
		}

		// Try each role from lowest to highest privilege to find minimal covering set
		const rolePriority: (keyof typeof ROLES)[] = [
			'viewer',
			'developer',
			'integrator',
			'releaseManager',
			'admin',
		];

		// Find the single lowest-privilege role that covers all permissions
		for (const roleKey of rolePriority) {
			const role = ROLES[roleKey];
			const coversAll = requiredPermissions.every(p => role.permissions.includes(p));

			if (coversAll) {
				return [role.name];
			}
		}

		// If no single role covers all, this shouldn't happen with our current role hierarchy
		// but return admin as fallback
		return ['admin'];
	}

	/**
	 * Generate permission report for user
	 */
	generatePermissionReport(context: AuthContext): string {
		const lines: string[] = [];

		lines.push(`Permission Report for: ${context.user}`);
		lines.push(`Roles: ${context.roles.join(', ')}`);
		lines.push('');

		const permissions = this.getUserPermissions(context);
		lines.push(`Granted Permissions (${permissions.length}):`);
		for (const permission of permissions) {
			lines.push(`  ✓ ${permission}`);
		}

		lines.push('');
		lines.push(`Maximum Autopilot Level: ${this.getMaxAutopilotLevel(context)}`);

		return lines.join('\n');
	}
}

