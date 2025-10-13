import { describe, it, expect } from 'vitest';
import { parseRemoteUrl } from '../src/git/parseRemote.js';

describe('parseRemoteUrl', () => {
  const cases: Array<[string, string]> = [
    ['git@github.com:Owner/Repo.git', 'Owner/Repo'],
    ['git@github.com:Owner/Repo', 'Owner/Repo'],
    ['https://github.com/Owner/Repo.git', 'Owner/Repo'],
    ['https://github.com/Owner/Repo', 'Owner/Repo'],
    ['ssh://git@github.com/Owner/Repo.git', 'Owner/Repo']
  ];

  for (const [input, expected] of cases) {
    it(`parses ${input} -> ${expected}`, () => {
      const res = parseRemoteUrl(input);
      expect(`${res.owner}/${res.repo}`).toBe(expected);
    });
  }

  it('returns empty for unknown formats', () => {
    const res = parseRemoteUrl('git@example.com:some/repo.git');
    expect(res.owner).toBeUndefined();
    expect(res.repo).toBeUndefined();
  });
});
