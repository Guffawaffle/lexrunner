/**
 * Token expansion utilities for dynamic path and prompt resolution
 */

/**
 * Expand tokens in string template
 * 
 * Supported tokens:
 * - {timestamp} - ISO 8601 timestamp (safe for filenames)
 * - {date} - YYYY-MM-DD
 * - {repo} - Repository name (owner/repo)
 * - {owner} - Repository owner
 * - {user} - GitHub username
 * - {branch} - Current git branch
 * 
 * @param template - String with tokens
 * @param context - Token values
 * @returns - Expanded string
 */
export function expandTokens(template: string, context: TokenContext): string {
  return template
    .replace(/{timestamp}/g, context.timestamp || new Date().toISOString().replace(/[:.]/g, '-'))
    .replace(/{date}/g, context.date || new Date().toISOString().split('T')[0])
    .replace(/{repo}/g, context.repo || '')
    .replace(/{owner}/g, context.owner || context.repo?.split('/')[0] || '')
    .replace(/{user}/g, context.user || '')
    .replace(/{branch}/g, context.branch || '');
}

export interface TokenContext {
  timestamp?: string;
  date?: string;
  repo?: string;
  owner?: string;
  user?: string;
  branch?: string;
}

/**
 * Get current git context for token expansion
 */
export async function getGitContext(cwd: string): Promise<Partial<TokenContext>> {
  const { execa } = await import('execa');
  
  try {
    const { stdout: branch } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    return { branch };
  } catch {
    return {};
  }
}
