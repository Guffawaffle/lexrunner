import type { Command } from "commander";

export type CliAliasDisposition = "compatibility" | "deprecated";

export interface CliAliasPolicyEntry {
  path: string;
  disposition: CliAliasDisposition;
  replacement: string;
  /** Deprecated aliases are removed no earlier than this major release. */
  removeIn?: "2.0.0";
}

export const CLI_ALIAS_POLICY: readonly CliAliasPolicyEntry[] = [
  { path: "autopilot", disposition: "compatibility", replacement: "weave policy run" },
  {
    path: "bootstrap",
    disposition: "compatibility",
    replacement: "workspace init --non-interactive",
  },
  { path: "config:inspect", disposition: "compatibility", replacement: "config show" },
  { path: "deliverables:cleanup", disposition: "compatibility", replacement: "governance:cleanup" },
  { path: "deliverables:list", disposition: "compatibility", replacement: "weave report" },
  { path: "gate execute", disposition: "compatibility", replacement: "planned canonical gate run" },
  {
    path: "init-local",
    disposition: "compatibility",
    replacement: "workspace init --non-interactive",
  },
  { path: "merge", disposition: "compatibility", replacement: "weave apply" },
  {
    path: "migrate-profile",
    disposition: "compatibility",
    replacement: "planned workspace migrate",
  },
  { path: "discover", disposition: "deprecated", replacement: "weave discover", removeIn: "2.0.0" },
  { path: "doctor", disposition: "deprecated", replacement: "workspace doctor", removeIn: "2.0.0" },
  {
    path: "execute",
    disposition: "deprecated",
    replacement: "planned canonical gate run",
    removeIn: "2.0.0",
  },
  { path: "init", disposition: "deprecated", replacement: "workspace init", removeIn: "2.0.0" },
  {
    path: "merge-order",
    disposition: "deprecated",
    replacement: "weave merge-order",
    removeIn: "2.0.0",
  },
  {
    path: "orchestrate",
    disposition: "deprecated",
    replacement: "weave and fanout command groups",
    removeIn: "2.0.0",
  },
  {
    path: "orchestrate pin-toolchain",
    disposition: "deprecated",
    replacement: "workspace doctor",
    removeIn: "2.0.0",
  },
  {
    path: "orchestrate:analyze-issues",
    disposition: "deprecated",
    replacement: "fanout analyze",
    removeIn: "2.0.0",
  },
  {
    path: "orchestrate:assign-batch",
    disposition: "deprecated",
    replacement: "planned fanout assign",
    removeIn: "2.0.0",
  },
  {
    path: "orchestrate:generate-deliverables",
    disposition: "deprecated",
    replacement: "weave report",
    removeIn: "2.0.0",
  },
  {
    path: "orchestrate:plan-batch",
    disposition: "deprecated",
    replacement: "weave plan",
    removeIn: "2.0.0",
  },
  {
    path: "orchestrate:predict-conflicts",
    disposition: "deprecated",
    replacement: "weave fanout analyze",
    removeIn: "2.0.0",
  },
  { path: "plan", disposition: "deprecated", replacement: "weave plan", removeIn: "2.0.0" },
  { path: "report", disposition: "deprecated", replacement: "weave report", removeIn: "2.0.0" },
  { path: "status", disposition: "deprecated", replacement: "weave status", removeIn: "2.0.0" },
] as const;

const POLICY_BY_PATH = new Map(CLI_ALIAS_POLICY.map((entry) => [entry.path, entry]));

export function commandPath(command: Command): string {
  const components: string[] = [];
  let current: Command | null = command;
  while (current?.parent) {
    components.unshift(current.name());
    current = current.parent;
  }
  return components.join(" ");
}

export function aliasWarning(path: string): string | null {
  const policy = POLICY_BY_PATH.get(path);
  if (!policy) return null;
  return policy.disposition === "deprecated"
    ? `[lex-pr] deprecated alias "${path}"; use "${policy.replacement}"; removal: ${policy.removeIn}.`
    : `[lex-pr] compatibility alias "${path}"; use "${policy.replacement}"; supported through 1.x and reviewed at 2.0.0.`;
}

export function emitAliasWarning(
  command: Command,
  write: (message: string) => void = (message) => process.stderr.write(message)
): void {
  const warning = aliasWarning(commandPath(command));
  if (warning) write(`${warning}\n`);
}
