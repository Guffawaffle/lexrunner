/** Resolve executable defaults without manufacturing evidence for unknown checks. */
export function getStandardGateCommand(gateName: string): string {
  const commands: Record<string, string> = {
    lint: "npm run lint",
    test: "npm test",
    unit: "npm test",
    typecheck: "npm run typecheck",
    build: "npm run build",
    format: "npm run format",
  };
  if (!Object.prototype.hasOwnProperty.call(commands, gateName)) {
    throw new Error(
      `No executable command is defined for gate ${JSON.stringify(gateName)}. ` +
        "Author an explicit gate run command in a manual plan, or select a supported standard gate."
    );
  }
  return commands[gateName];
}
