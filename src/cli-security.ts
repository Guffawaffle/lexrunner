import { Command } from 'commander';
import chalk from 'chalk';

/**
 * Security CLI Registration (B5 Documentation Placeholder)
 *
 * Output Controls:
 * --format text|json  (default text)
 *   json: stable key ordering: {command,status,exitCode,findings,timestamp}
 * --no-color disables ANSI styling (text mode only)
 *
 * Exit Codes:
 * 0 success (no findings)
 * 1 findings (policy or validation issues discovered)
 * 2 internal error (unexpected failure path)
 *
 * Determinism: JSON output uses explicit property ordering & canonical sort of findings
 */
export interface SecurityCommandResult {
  exitCode: number;
  report: string;
  findings?: any;
  status: 'ok' | 'findings' | 'error';
}

type ResultLike = { exitCode: number; report: string; findings?: any; status: string };

function outputSecurityResult(command: string, result: ResultLike, format: string, color: boolean) {
  if (format === 'json') {
    const payload = {
      command,
      status: result.status,
      exitCode: result.exitCode,
      findings: normalizeFindings(result.findings),
      timestamp: new Date().toISOString()
    };
    const ordered = { command: payload.command, status: payload.status, exitCode: payload.exitCode, findings: payload.findings, timestamp: payload.timestamp };
    process.stdout.write(JSON.stringify(ordered, null, 2) + '\n');
    process.exit(result.exitCode);
  }
  const useColor = color && process.stdout.isTTY;
  if (useColor) {
    if (result.status === 'ok') console.log(chalk.green(result.report));
    else if (result.status === 'findings') console.log(chalk.yellow(result.report));
    else console.log(chalk.red(result.report));
  } else {
    console.log(result.report);
  }
  process.exit(result.exitCode);
}

function normalizeFindings(findings: any) {
  if (!findings) return [];
  if (Array.isArray(findings)) return findings;
  if (findings.items && Array.isArray(findings.items)) {
    const items = [...findings.items].sort((a, b) => {
      const an = a?.pattern?.name || '';
      const bn = b?.pattern?.name || '';
      if (an !== bn) return an.localeCompare(bn);
      return (a.line || 0) - (b.line || 0);
    });
    return { ...findings, items };
  }
  return findings;
}

export async function registerSecurityCommands(program: Command) {
  program
    .command('security')
    .description('Security operations: token rotation, secrets scanning, validation')
    .addCommand(
      new Command('check-rotation')
        .description('Check if secrets need rotation based on age')
        .argument('[secrets...]', 'Secret IDs to check (without LEX_PR_ prefix)', ['GITHUB_TOKEN'])
        .option('--max-age <days>', 'Maximum age in days before rotation needed', '90')
        .option('--format <format>', 'Output format: text or json', 'text')
        .option('--no-color', 'Disable ANSI colors in text output')
        .action(async (secretIds: string[], opts: { maxAge: string; format: string; color?: boolean }) => {
          const { checkRotation } = await import('./commands/security.js');
          const result = await checkRotation(secretIds, parseInt(opts.maxAge));
          outputSecurityResult('check-rotation', result, opts.format, opts.color !== false);
        })
    )
    .addCommand(
      new Command('scan-plan')
        .description('Scan plan file for accidentally exposed secrets')
        .argument('[plan-file]', 'Path to plan file', 'plan.json')
        .option('--format <format>', 'Output format: text or json', 'text')
        .option('--no-color', 'Disable ANSI colors in text output')
        .action(async (planFile: string, opts: { format: string; color?: boolean }) => {
          const { scanPlan } = await import('./commands/security.js');
          const result = await scanPlan(planFile);
          outputSecurityResult('scan-plan', result, opts.format, opts.color !== false);
        })
    )
    .addCommand(
      new Command('validate-secrets')
        .description('Validate that required secrets are present')
        .argument('<secrets...>', 'Required secret IDs (without LEX_PR_ prefix)')
        .option('--format <format>', 'Output format: text or json', 'text')
        .option('--no-color', 'Disable ANSI colors in text output')
        .action(async (secretIds: string[], opts: { format: string; color?: boolean }) => {
          const { validateSecrets } = await import('./commands/security.js');
          const result = await validateSecrets(secretIds);
          outputSecurityResult('validate-secrets', result, opts.format, opts.color !== false);
        })
    );
}
