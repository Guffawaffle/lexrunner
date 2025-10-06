import { describe, it, expect } from 'vitest';
import { AuthorizationService, Permission, ROLES, AUTOPILOT_LEVEL_PERMISSIONS } from '../src/security/authorization';
import { AuthContext } from '../src/security/authentication';

describe('Security - Authorization', () => {
	let authService: AuthorizationService;

	beforeEach(() => {
		authService = new AuthorizationService();
	});

	describe('Role Permissions', () => {
		it('should define viewer role correctly', () => {
			expect(ROLES.viewer.permissions).toEqual([Permission.READ]);
		});

		it('should define developer role correctly', () => {
			expect(ROLES.developer.permissions).toContain(Permission.READ);
			expect(ROLES.developer.permissions).toContain(Permission.ARTIFACTS);
			expect(ROLES.developer.permissions).toContain(Permission.ANNOTATE);
		});

		it('should define admin role with all permissions', () => {
			expect(ROLES.admin.permissions).toContain(Permission.ADMIN);
			expect(ROLES.admin.permissions).toContain(Permission.MERGE);
		});
	});

	describe('Permission Checks', () => {
		it('should grant permission when user has role', () => {
			const context: AuthContext = {
				user: 'test-user',
				method: 'token',
				roles: ['developer'],
			};

			expect(authService.hasPermission(context, Permission.READ)).toBe(true);
			expect(authService.hasPermission(context, Permission.ARTIFACTS)).toBe(true);
		});

		it('should deny permission when user lacks role', () => {
			const context: AuthContext = {
				user: 'test-user',
				method: 'token',
				roles: ['viewer'],
			};

			expect(authService.hasPermission(context, Permission.MERGE)).toBe(false);
		});

		it('should grant all permissions to admin', () => {
			const context: AuthContext = {
				user: 'admin-user',
				method: 'token',
				roles: ['admin'],
			};

			expect(authService.hasPermission(context, Permission.READ)).toBe(true);
			expect(authService.hasPermission(context, Permission.MERGE)).toBe(true);
			expect(authService.hasPermission(context, Permission.ADMIN)).toBe(true);
		});
	});

	describe('Autopilot Level Authorization', () => {
		it('should map autopilot levels to permissions correctly', () => {
			expect(AUTOPILOT_LEVEL_PERMISSIONS[0]).toBe(Permission.READ);
			expect(AUTOPILOT_LEVEL_PERMISSIONS[1]).toBe(Permission.ARTIFACTS);
			expect(AUTOPILOT_LEVEL_PERMISSIONS[2]).toBe(Permission.ANNOTATE);
			expect(AUTOPILOT_LEVEL_PERMISSIONS[3]).toBe(Permission.CREATE_PR);
			expect(AUTOPILOT_LEVEL_PERMISSIONS[4]).toBe(Permission.MERGE);
		});

		it('should allow viewer to execute level 0', () => {
			const context: AuthContext = {
				user: 'viewer',
				method: 'token',
				roles: ['viewer'],
			};

			expect(authService.canExecuteAutopilotLevel(context, 0)).toBe(true);
		});

		it('should not allow viewer to execute level 1', () => {
			const context: AuthContext = {
				user: 'viewer',
				method: 'token',
				roles: ['viewer'],
			};

			expect(authService.canExecuteAutopilotLevel(context, 1)).toBe(false);
		});

		it('should allow developer to execute levels 0-2', () => {
			const context: AuthContext = {
				user: 'developer',
				method: 'token',
				roles: ['developer'],
			};

			expect(authService.canExecuteAutopilotLevel(context, 0)).toBe(true);
			expect(authService.canExecuteAutopilotLevel(context, 1)).toBe(true);
			expect(authService.canExecuteAutopilotLevel(context, 2)).toBe(true);
			expect(authService.canExecuteAutopilotLevel(context, 3)).toBe(false);
		});

		it('should get maximum autopilot level for user', () => {
			const developerContext: AuthContext = {
				user: 'developer',
				method: 'token',
				roles: ['developer'],
			};

			expect(authService.getMaxAutopilotLevel(developerContext)).toBe(2);

			const releaseManagerContext: AuthContext = {
				user: 'release-manager',
				method: 'token',
				roles: ['releaseManager'],
			};

			expect(authService.getMaxAutopilotLevel(releaseManagerContext)).toBe(4);
		});
	});

	describe('Permission Enforcement', () => {
		it('should throw error when permission denied', () => {
			const context: AuthContext = {
				user: 'viewer',
				method: 'token',
				roles: ['viewer'],
			};

			expect(() => {
				authService.enforce(context, Permission.MERGE);
			}).toThrow(/Access denied/);
		});

		it('should not throw when permission granted', () => {
			const context: AuthContext = {
				user: 'admin',
				method: 'token',
				roles: ['admin'],
			};

			expect(() => {
				authService.enforce(context, Permission.MERGE);
			}).not.toThrow();
		});

		it('should throw error when autopilot level denied', () => {
			const context: AuthContext = {
				user: 'viewer',
				method: 'token',
				roles: ['viewer'],
			};

			expect(() => {
				authService.enforceAutopilotLevel(context, 4);
			}).toThrow(/cannot execute autopilot level 4/);
		});
	});

	describe('User Permissions', () => {
		it('should get all permissions for user', () => {
			const context: AuthContext = {
				user: 'developer',
				method: 'token',
				roles: ['developer'],
			};

			const permissions = authService.getUserPermissions(context);
			expect(permissions).toContain(Permission.READ);
			expect(permissions).toContain(Permission.ARTIFACTS);
			expect(permissions).toContain(Permission.ANNOTATE);
		});

		it('should aggregate permissions from multiple roles', () => {
			const context: AuthContext = {
				user: 'user',
				method: 'token',
				roles: ['viewer', 'developer'],
			};

			const permissions = authService.getUserPermissions(context);
			expect(permissions).toContain(Permission.READ);
			expect(permissions).toContain(Permission.ARTIFACTS);
		});
	});

	describe('Preflight Checks', () => {
		it('should pass preflight check when user has all permissions', () => {
			const context: AuthContext = {
				user: 'admin',
				method: 'token',
				roles: ['admin'],
			};

			const result = authService.preflightCheck(context, [Permission.READ, Permission.MERGE]);

			expect(result.allowed).toBe(true);
			expect(result.missingPermissions).toHaveLength(0);
		});

		it('should fail preflight check when permissions missing', () => {
			const context: AuthContext = {
				user: 'viewer',
				method: 'token',
				roles: ['viewer'],
			};

			const result = authService.preflightCheck(context, [Permission.MERGE, Permission.CREATE_PR]);

			expect(result.allowed).toBe(false);
			expect(result.missingPermissions).toContain(Permission.MERGE);
			expect(result.missingPermissions).toContain(Permission.CREATE_PR);
		});

		it('should provide role recommendations in preflight', () => {
			const context: AuthContext = {
				user: 'developer',
				method: 'token',
				roles: ['developer'],
			};

			const result = authService.preflightCheck(context, [Permission.MERGE]);

			expect(result.allowed).toBe(false);
			expect(result.recommendations).toBeDefined();
			expect(result.recommendations).toContain('releaseManager');
		});

		it('should return user permissions in preflight result', () => {
			const context: AuthContext = {
				user: 'integrator',
				method: 'token',
				roles: ['integrator'],
			};

			const result = authService.preflightCheck(context, [Permission.CREATE_PR]);

			expect(result.userPermissions).toContain(Permission.CREATE_PR);
			expect(result.userPermissions).toContain(Permission.READ);
		});
	});

	describe('Batch Preflight Checks', () => {
		it('should check multiple operations', () => {
			const context: AuthContext = {
				user: 'developer',
				method: 'token',
				roles: ['developer'],
			};

			const operations = [
				{ name: 'read_plan', permissions: [Permission.READ] },
				{ name: 'create_pr', permissions: [Permission.CREATE_PR] },
				{ name: 'annotate', permissions: [Permission.ANNOTATE] },
			];

			const results = authService.batchPreflightCheck(context, operations);

			expect(results).toHaveLength(3);
			expect(results.find(r => r.operation === 'read_plan')?.allowed).toBe(true);
			expect(results.find(r => r.operation === 'create_pr')?.allowed).toBe(false);
			expect(results.find(r => r.operation === 'annotate')?.allowed).toBe(true);
		});
	});

	describe('Permission Report', () => {
		it('should generate readable permission report', () => {
			const context: AuthContext = {
				user: 'test-user',
				method: 'token',
				roles: ['developer', 'integrator'],
			};

			const report = authService.generatePermissionReport(context);

			expect(report).toContain('test-user');
			expect(report).toContain('developer');
			expect(report).toContain('integrator');
			expect(report).toContain(Permission.READ);
			expect(report).toContain('Maximum Autopilot Level: 3');
		});
	});
});
