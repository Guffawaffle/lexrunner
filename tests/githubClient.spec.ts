import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitHubClientImpl } from '../src/github/client.js';

function makeFakePR(n: number) {
  return {
    number: n,
    title: `PR ${n}`,
    body: '',
    head: { ref: `branch-${n}`, sha: `sha-${n}` },
    base: { ref: 'main', sha: `base-${n}` },
    state: 'open',
    labels: [],
    draft: false,
    mergeable: true,
    user: { login: 'author' },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

describe('GitHubClientImpl (pagination & discovery)', () => {
  const realEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...realEnv };
    (process as any).__FAKE_OCTOKIT = undefined;
  });

  it('aggregates paginated PRs via paginate', async () => {
    // Create fake octokit with paginate that returns two pages
    const prsPage1 = Array.from({ length: 100 }, (_, i) => makeFakePR(i + 1));
    const prsPage2 = [makeFakePR(101), makeFakePR(102)];

    const fakeOctokit = {
      rest: {
        pulls: {
          list: () => ({ data: prsPage1 })
        }
      },
      paginate: async (_fn: any, _params: any) => {
        return [...prsPage1, ...prsPage2];
      }
    };

    (process as any).__FAKE_OCTOKIT = fakeOctokit;
    process.env.LEX_PR_FAKE_OCTOKIT = '1';

    const client = await new GitHubClientImpl({ owner: 'Owner', repo: 'Repo' } as any);
    // override octokit via fake
    (client as any).octokit = fakeOctokit;

    const prs = await client.listOpenPRs({});
    expect(prs.length).toBe(102);
    expect(prs[0].number).toBe(1);
    expect(prs[101].number).toBe(102);
  });

  it('returns empty array for no PRs', async () => {
    const fakeOctokit = {
      rest: {
        pulls: { list: () => ({ data: [] }) }
      },
      paginate: async () => []
    };
    (process as any).__FAKE_OCTOKIT = fakeOctokit;
    process.env.LEX_PR_FAKE_OCTOKIT = '1';

    const client = await new GitHubClientImpl({ owner: 'Owner', repo: 'Repo' } as any);
    (client as any).octokit = fakeOctokit;

    const prs = await client.listOpenPRs({});
    expect(prs).toEqual([]);
  });
});
