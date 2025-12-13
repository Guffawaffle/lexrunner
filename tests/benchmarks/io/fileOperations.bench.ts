/**
 * File Operations Performance Benchmarks
 * Measures performance of plan file I/O and schema validation
 */

import { describe, bench, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import { generateGraph } from '../utils/graphGenerator.js';
import type { Plan } from '../../../src/schema.js';

describe('File Operations Performance', () => {
  const tmpDir = path.join(os.tmpdir(), 'lex-pr-runner-bench-files');
  
  beforeAll(() => {
    // Create temp directory
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Cleanup temp directory
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('JSON operations', () => {
    const smallPlan = generateGraph({ nodes: 10, pattern: 'complex' });
    const mediumPlan = generateGraph({ nodes: 50, pattern: 'complex' });
    const largePlan = generateGraph({ nodes: 100, pattern: 'complex' });

    bench('write small plan (10 items)', () => {
      const filePath = path.join(tmpDir, 'small-plan.json');
      fs.writeFileSync(filePath, JSON.stringify(smallPlan, null, 2));
    });

    bench('read small plan (10 items)', () => {
      const filePath = path.join(tmpDir, 'small-plan.json');
      fs.writeFileSync(filePath, JSON.stringify(smallPlan, null, 2));
      const content = fs.readFileSync(filePath, 'utf-8');
      JSON.parse(content);
    });

    bench('write medium plan (50 items)', () => {
      const filePath = path.join(tmpDir, 'medium-plan.json');
      fs.writeFileSync(filePath, JSON.stringify(mediumPlan, null, 2));
    });

    bench('read medium plan (50 items)', () => {
      const filePath = path.join(tmpDir, 'medium-plan.json');
      fs.writeFileSync(filePath, JSON.stringify(mediumPlan, null, 2));
      const content = fs.readFileSync(filePath, 'utf-8');
      JSON.parse(content);
    });

    bench('write large plan (100 items)', () => {
      const filePath = path.join(tmpDir, 'large-plan.json');
      fs.writeFileSync(filePath, JSON.stringify(largePlan, null, 2));
    });

    bench('read large plan (100 items)', () => {
      const filePath = path.join(tmpDir, 'large-plan.json');
      fs.writeFileSync(filePath, JSON.stringify(largePlan, null, 2));
      const content = fs.readFileSync(filePath, 'utf-8');
      JSON.parse(content);
    });
  });

  describe('YAML operations', () => {
    const gateConfig = {
      gates: [
        { name: 'lint', run: 'npm run lint', env: {} },
        { name: 'test', run: 'npm test', env: {} },
        { name: 'build', run: 'npm run build', env: {} },
        { name: 'e2e', run: 'npm run e2e', env: {} },
        { name: 'security', run: 'npm audit', env: {} }
      ]
    };

    bench('write gates config', () => {
      const filePath = path.join(tmpDir, 'gates.yml');
      fs.writeFileSync(filePath, yaml.stringify(gateConfig));
    });

    bench('read gates config', () => {
      const filePath = path.join(tmpDir, 'gates.yml');
      fs.writeFileSync(filePath, yaml.stringify(gateConfig));
      const content = fs.readFileSync(filePath, 'utf-8');
      yaml.parse(content);
    });

    bench('read and write gates config', () => {
      const filePath = path.join(tmpDir, 'gates.yml');
      fs.writeFileSync(filePath, yaml.stringify(gateConfig));
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = yaml.parse(content);
      fs.writeFileSync(filePath, yaml.stringify(parsed));
    });
  });

  describe('Multiple file operations', () => {
    const plans = Array.from({ length: 10 }, (_, i) => 
      generateGraph({ nodes: 10, pattern: 'complex' })
    );

    bench('write 10 plan files', () => {
      plans.forEach((plan, i) => {
        const filePath = path.join(tmpDir, `plan-${i}.json`);
        fs.writeFileSync(filePath, JSON.stringify(plan, null, 2));
      });
    });

    bench('read 10 plan files', () => {
      // Setup
      plans.forEach((plan, i) => {
        const filePath = path.join(tmpDir, `plan-${i}.json`);
        fs.writeFileSync(filePath, JSON.stringify(plan, null, 2));
      });

      // Benchmark
      plans.forEach((_, i) => {
        const filePath = path.join(tmpDir, `plan-${i}.json`);
        const content = fs.readFileSync(filePath, 'utf-8');
        JSON.parse(content);
      });
    });
  });
});
