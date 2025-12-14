/**
 * Token expansion utilities for dynamic path and prompt resolution
 */

/**
 * Token expansion mode for missing tokens
 */
export type MissingTokenMode = 'skip' | 'error' | 'default';

export interface TokenContext {
  timestamp?: string;
  date?: string;
  repo?: string;
  owner?: string;
  user?: string;
  branch?: string;
  commit?: string;
  author?: string;
}

/**
 * Expand tokens in string template
 * 
 * Supported token formats:
 * - {{VAR}} or {VAR} - Token to replace
 * 
 * Supported tokens:
 * - {{timestamp}} - ISO 8601 timestamp (safe for filenames)
 * - {{date}} - YYYY-MM-DD
 * - {{repo}} - Repository name (owner/repo)
 * - {{owner}} - Repository owner
 * - {{user}} - GitHub username
 * - {{branch}} - Current git branch
 * - {{commit}} - Current git commit SHA
 * - {{author}} - Git commit author
 * 
 * @param template - String with tokens
 * @param context - Token values
 * @param options - Expansion options
 * @returns - Expanded string
 */
export function expandTokens(
  template: string, 
  context: TokenContext,
  options: { mode?: MissingTokenMode } = {}
): string {
  const mode = options.mode || 'default';
  
  let result = template;
  
  // Helper to get token value with mode handling
  const getTokenValue = (key: string, isDoubleBrace: boolean): string => {
    const value = context[key as keyof TokenContext];
    if (value !== undefined) {
      return value;
    }
    
    // Handle special default values
    if (mode === 'default') {
      if (key === 'timestamp') {
        return new Date().toISOString().replace(/[:.]/g, '-');
      }
      if (key === 'date') {
        return new Date().toISOString().split('T')[0];
      }
      if (key === 'owner' && context.repo) {
        return context.repo.split('/')[0] || '';
      }
      return '';
    }
    
    if (mode === 'error') {
      throw new Error(`Missing required token: ${key}`);
    }
    
    // mode === 'skip': return original token format
    return isDoubleBrace ? `{{${key}}}` : `{${key}}`;
  };
  
  // First, replace double-brace tokens {{VAR}}
  result = result.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return getTokenValue(key, true);
  });
  
  // Then, replace single-brace tokens {VAR} (for backward compatibility)
  result = result.replace(/\{(\w+)\}/g, (match, key) => {
    return getTokenValue(key, false);
  });
  
  return result;
}

/**
 * Get current git context for token expansion
 * 
 * @param cwd - Working directory
 * @returns Git context (repo, branch, commit, author)
 */
export async function getGitContext(cwd: string): Promise<Partial<TokenContext>> {
  const { execa } = await import('execa');
  
  const context: Partial<TokenContext> = {};
  
  try {
    // Get current branch
    const { stdout: branch } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    context.branch = branch;
  } catch {
    // Ignore errors
  }
  
  try {
    // Get current commit SHA
    const { stdout: commit } = await execa('git', ['rev-parse', 'HEAD'], { cwd });
    context.commit = commit.slice(0, 7); // Short SHA
  } catch {
    // Ignore errors
  }
  
  try {
    // Get commit author
    const { stdout: author } = await execa('git', ['log', '-1', '--pretty=format:%an'], { cwd });
    context.author = author;
  } catch {
    // Ignore errors
  }
  
  try {
    // Get remote repo (owner/repo format)
    const { stdout: remoteUrl } = await execa('git', ['config', '--get', 'remote.origin.url'], { cwd });
    const repoMatch = remoteUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (repoMatch) {
      context.repo = repoMatch[1];
      context.owner = context.repo.split('/')[0];
    }
  } catch {
    // Ignore errors
  }
  
  try {
    // Get git user name as fallback for user
    const { stdout: user } = await execa('git', ['config', '--get', 'user.name'], { cwd });
    context.user = user;
  } catch {
    // Ignore errors
  }
  
  return context;
}
