/**
 * Parse common git remote URL formats and return { owner, repo }
 */
export function parseRemoteUrl(remoteUrl: string): { owner?: string; repo?: string } {
  if (!remoteUrl) return {};
  let url = remoteUrl.trim();
  if (url.endsWith('.git')) url = url.slice(0, -4);

  // SSH: git@github.com:owner/repo
  const sshMatch = url.match(/^git@github\.com:([^/]+)\/(.+)$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  // HTTPS: https://github.com/owner/repo
  const httpsMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/(.+)$/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  // Generic: contains github.com/owner/repo
  const generic = url.match(/github\.com[:\/]([^/]+)\/(.+)$/);
  if (generic) return { owner: generic[1], repo: generic[2] };

  return {};
}
