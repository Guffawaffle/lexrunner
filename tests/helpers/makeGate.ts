import type { Gate } from '../../src/schema.js';

type GateOverrides = Partial<Gate> & Pick<Gate, 'name' | 'run'>;

/** Minimal, type-safe gate factory for tests */
export function makeGate(overrides: GateOverrides): Gate {
  const base: Gate = {
    // Minimal fields to satisfy the Gate type used in tests
    name: 'test-gate',
    description: '',
    run: 'echo "ok"',
    runtime: 'local' as any,
    timeoutMs: 30000,
    env: {},
    artifacts: [],
  } as unknown as Gate;

  return { ...base, ...overrides } as Gate;
}
