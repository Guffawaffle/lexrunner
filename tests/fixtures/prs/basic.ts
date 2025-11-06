/**
 * Basic PR factory and mock PR types
 */

export interface MockPR {
  number: number;
  title: string;
  body: string | null;
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes?: number;
    patch?: string;
  }>;
  state?: 'open' | 'closed';
  merged?: boolean;
  base?: {
    ref: string;
    sha?: string;
  };
  head?: {
    ref: string;
    sha?: string;
  };
  labels?: Array<{ name: string; color?: string }>;
  created_at?: string;
  updated_at?: string;
}

export interface BasicPROptions {
  number: number;
  title: string;
  body?: string | null;
  files?: string[];
  state?: 'open' | 'closed';
  merged?: boolean;
  baseRef?: string;
  headRef?: string;
  labels?: string[];
}

/**
 * Create a basic mock PR with sensible defaults
 */
export function basic(options: BasicPROptions): MockPR {
  const {
    number,
    title,
    body = null,
    files = [],
    state = 'open',
    merged = false,
    baseRef = 'main',
    headRef = `pr-${number}`,
    labels = []
  } = options;

  return {
    number,
    title,
    body,
    state,
    merged,
    base: {
      ref: baseRef,
      sha: `base-sha-${number}`
    },
    head: {
      ref: headRef,
      sha: `head-sha-${number}`
    },
    files: files.map(filename => ({
      filename,
      status: 'modified',
      additions: 10,
      deletions: 5,
      changes: 15
    })),
    labels: labels.map(name => ({ name })),
    created_at: new Date(Date.UTC(2024, 0, 1 + number - 100)).toISOString(),
    updated_at: new Date(Date.UTC(2024, 0, 2 + number - 100)).toISOString()
  };
}

/**
 * Create a batch of basic PRs
 */
export function batch(count: number): MockPR[] {
  return Array.from({ length: count }, (_, i) => {
    const number = 100 + i;
    return basic({
      number,
      title: `Feature ${i + 1}: Add component ${String.fromCharCode(65 + i)}`,
      files: [
        `src/components/Component${String.fromCharCode(65 + i)}.ts`,
        `tests/components/Component${String.fromCharCode(65 + i)}.spec.ts`
      ]
    });
  });
}

/**
 * Create a PR with specific file patterns
 */
export function withFiles(options: {
  number: number;
  title: string;
  files: Array<{
    filename: string;
    status?: 'added' | 'modified' | 'removed' | 'renamed';
    additions?: number;
    deletions?: number;
  }>;
}): MockPR {
  const pr = basic({
    number: options.number,
    title: options.title
  });

  pr.files = options.files.map(file => ({
    filename: file.filename,
    status: file.status ?? 'modified',
    additions: file.additions ?? 10,
    deletions: file.deletions ?? 5,
    changes: (file.additions ?? 10) + (file.deletions ?? 5),
    patch: file.status === 'added' ? '+' : file.status === 'removed' ? '-' : '~'
  }));

  return pr;
}

/**
 * Create a PR with specific labels
 */
export function withLabels(options: {
  number: number;
  title: string;
  labels: string[];
}): MockPR {
  return basic({
    ...options
  });
}

/**
 * Fixed base timestamp for deterministic fixture dates
 * 2024-01-01T00:00:00.000Z
 */
const FIXTURE_BASE_TIMESTAMP = '2024-01-01T00:00:00.000Z';

/**
 * Create a closed/merged PR
 */
export function closed(options: {
  number: number;
  title: string;
  merged?: boolean;
}): MockPR {
  return basic({
    ...options,
    state: 'closed',
    merged: options.merged ?? true
  });
}

/**
 * Create a PR with large changeset (for testing performance)
 */
export function largeChangeset(number: number): MockPR {
  const fileCount = 50;
  const files = Array.from({ length: fileCount }, (_, i) => 
    `src/module-${Math.floor(i / 10)}/file-${i}.ts`
  );

  return basic({
    number,
    title: `Large refactor: Update ${fileCount} files`,
    files
  });
}
