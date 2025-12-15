# Examples

This directory contains minimal examples demonstrating lexrunner usage.

## Files

- **`sample-plan.json`**: Example plan with schema v1.0.0, showing dependency relationships and gate definitions
- **`sample-stack.yml`**: Input configuration that would generate the sample plan
- **`expected-snapshot.md`**: Expected snapshot output for the sample plan

## Usage

```bash
# Validate the sample plan
npm run cli -- schema validate examples/sample-plan.json

# Compute merge order from sample plan
npm run cli -- merge-order examples/sample-plan.json

# Generate plan from sample stack configuration
cd examples && npm run cli -- plan --out ./output
```
