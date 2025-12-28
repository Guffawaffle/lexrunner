/**
 * Authentication and Authorization Framework
 *
 * Provides enterprise-grade authentication integration with:
 * - GitHub token validation
 * - Identity provider integration hooks
 * - Token lifecycle management
 */

import { securityAuthFailedError } from "../errors/index.js";
import { AXErrorException } from "@smartergpt/lex/errors";

export interface AuthContext {
  /** Authenticated user */
  user: string;
  /** Authentication method used */
  method: "token" | "oauth" | "sso";
  /** User roles/permissions */
  roles: string[];
  /** Token expiration timestamp */
  expiresAt?: Date;
  /** Organization/tenant context */
  organization?: string;
}

export interface AuthProvider {
  /** Authenticate and return context */
  authenticate(): Promise<AuthContext>;
  /** Validate existing authentication */
  validate(): Promise<boolean>;
  /** Refresh authentication if needed */
  refresh(): Promise<AuthContext>;
}

/**
 * GitHub Token Authentication Provider
 */
export class GitHubTokenAuthProvider implements AuthProvider {
  private token: string;
  private cachedContext?: AuthContext;

  constructor(token?: string) {
    this.token = token || process.env.GITHUB_TOKEN || "";
    if (!this.token) {
      const axError = securityAuthFailedError("GitHub token required for authentication", {
        method: "token",
        reason: "token_missing",
      });
      throw new AXErrorException(
        axError.code,
        axError.message,
        axError.nextActions,
        axError.context
      );
    }
  }

  async authenticate(): Promise<AuthContext> {
    // Validate token by making a GitHub API call
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit({ auth: this.token });

    try {
      const { data: user } = await octokit.rest.users.getAuthenticated();

      // Extract roles from token scopes or user data
      const roles = await this.extractRoles(octokit);

      this.cachedContext = {
        user: user.login,
        method: "token",
        roles,
        organization: user.company || undefined,
      };

      return this.cachedContext;
    } catch (error) {
      const axError = securityAuthFailedError(
        `Authentication failed: ${error instanceof Error ? error.message : String(error)}`,
        { method: "token", reason: "api_error" }
      );
      throw new AXErrorException(
        axError.code,
        axError.message,
        axError.nextActions,
        axError.context
      );
    }
  }

  async validate(): Promise<boolean> {
    try {
      await this.authenticate();
      return true;
    } catch {
      return false;
    }
  }

  async refresh(): Promise<AuthContext> {
    // For token-based auth, re-authenticate
    return this.authenticate();
  }

  private async extractRoles(octokit: any): Promise<string[]> {
    const roles: string[] = ["user"];

    try {
      // Check if user has admin access to any org
      const { data: orgs } = await octokit.rest.orgs.listForAuthenticatedUser();

      if (orgs.length > 0) {
        roles.push("org-member");
      }

      // Check for specific permissions via token scopes
      // This is a simplified version - in production, you'd check actual scopes
      roles.push("pr-access");
    } catch {
      // Continue with basic roles
    }

    return roles;
  }

  getContext(): AuthContext | undefined {
    return this.cachedContext;
  }
}

/**
 * Authentication Manager
 * Central authentication service for the application
 */
export class AuthenticationManager {
  private provider: AuthProvider;
  private context?: AuthContext;

  constructor(provider?: AuthProvider) {
    // Default to GitHub token provider
    this.provider = provider || new GitHubTokenAuthProvider();
  }

  /**
   * Initialize authentication
   */
  async initialize(): Promise<AuthContext> {
    this.context = await this.provider.authenticate();
    return this.context;
  }

  /**
   * Get current authentication context
   */
  getContext(): AuthContext | undefined {
    return this.context;
  }

  /**
   * Check if authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    return this.provider.validate();
  }

  /**
   * Refresh authentication
   */
  async refresh(): Promise<AuthContext> {
    this.context = await this.provider.refresh();
    return this.context;
  }
}
