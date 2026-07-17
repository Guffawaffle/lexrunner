import type { Command } from "commander";

export interface RegisteredCliCommand {
  path: string;
  kind: "group" | "operation";
  description: string;
}

/** Read-only inventory of the Commander tree used by architecture drift tests. */
export function collectRegisteredCliSurface(root: Command): RegisteredCliCommand[] {
  const entries: RegisteredCliCommand[] = [];
  const visit = (parent: Command, prefix: readonly string[]): void => {
    for (const command of parent.commands) {
      const components = [...prefix, command.name()];
      entries.push({
        path: components.join(" "),
        kind: command.commands.length > 0 ? "group" : "operation",
        description: command.description(),
      });
      visit(command, components);
    }
  };
  visit(root, []);
  return entries.sort((left, right) => left.path.localeCompare(right.path, "en-US"));
}
