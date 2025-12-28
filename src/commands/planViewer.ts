/**
 * Interactive plan viewer with navigation and filtering
 */

import * as readline from "readline";
import { Plan } from "../schema.js";
import { computeMergeOrder } from "../mergeOrder.js";
import { ExecutionState } from "../executionState.js";
import { MergeEligibilityEvaluator } from "../mergeEligibility.js";
import chalk from "chalk";

export interface ViewerOptions {
  filter?: string;
  showDeps?: boolean;
  showGates?: boolean;
}

export class InteractivePlanViewer {
  private plan: Plan;
  private currentIndex = 0;
  private filterText = "";
  private showDeps = true;
  private showGates = true;
  private filteredItems: string[];
  private levels: string[][];
  private executionState?: ExecutionState;
  private evaluator?: MergeEligibilityEvaluator;

  constructor(plan: Plan, options: ViewerOptions = {}) {
    this.plan = plan;
    this.filterText = options.filter || "";
    this.showDeps = options.showDeps !== false;
    this.showGates = options.showGates !== false;
    this.levels = computeMergeOrder(plan);
    this.executionState = new ExecutionState(plan);
    this.evaluator = new MergeEligibilityEvaluator(plan, this.executionState);
    this.filteredItems = this.applyFilter();
  }

  private applyFilter(): string[] {
    let items = this.plan.items.map((item) => item.name);

    if (this.filterText) {
      const lower = this.filterText.toLowerCase();
      items = items.filter((name) => name.toLowerCase().includes(lower));
    }

    return items;
  }

  private getMergeLevel(itemName: string): number {
    for (let i = 0; i < this.levels.length; i++) {
      if (this.levels[i].includes(itemName)) {
        return i + 1;
      }
    }
    return -1;
  }

  private renderItem(itemName: string, isSelected: boolean): string {
    const item = this.plan.items.find((i) => i.name === itemName);
    if (!item) return "";

    const prefix = isSelected ? chalk.cyan("►") : " ";
    const level = this.getMergeLevel(itemName);
    const levelStr = level > 0 ? chalk.gray(`[L${level}]`) : "";

    let output = `${prefix} ${chalk.bold(itemName)} ${levelStr}`;

    if (this.showDeps && item.deps.length > 0) {
      output += `\n   ${chalk.gray("Deps:")} ${item.deps.join(", ")}`;
    }

    if (this.showGates && item.gates.length > 0) {
      const gateNames = item.gates.map((g) => g.name).join(", ");
      output += `\n   ${chalk.gray("Gates:")} ${gateNames}`;
    }

    return output;
  }

  private render(): void {
    console.clear();
    console.log(chalk.bold.cyan("📋 Interactive Plan Viewer"));
    console.log(chalk.gray("─".repeat(60)));
    console.log(
      `Plan: ${this.plan.target} | Items: ${this.filteredItems.length}/${this.plan.items.length}`
    );

    if (this.filterText) {
      console.log(chalk.yellow(`Filter: "${this.filterText}"`));
    }

    console.log(chalk.gray("─".repeat(60)));

    // Show items around current selection
    const windowSize = 10;
    const start = Math.max(0, this.currentIndex - Math.floor(windowSize / 2));
    const end = Math.min(this.filteredItems.length, start + windowSize);

    for (let i = start; i < end; i++) {
      console.log(this.renderItem(this.filteredItems[i], i === this.currentIndex));
    }

    console.log(chalk.gray("─".repeat(60)));
    console.log(chalk.gray("Navigation: ↑/↓ | Filter: /search | Toggle: d(eps) g(ates) | Quit: q"));
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      if (this.filteredItems.length === 0) {
        console.log(chalk.yellow("No items to display"));
        resolve();
        return;
      }

      this.render();

      readline.emitKeypressEvents(process.stdin);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }

      const onKeyPress = (str: string, key: any) => {
        if (key.name === "q" || (key.ctrl && key.name === "c")) {
          cleanup();
          resolve();
          return;
        }

        if (key.name === "up") {
          this.currentIndex = Math.max(0, this.currentIndex - 1);
          this.render();
        } else if (key.name === "down") {
          this.currentIndex = Math.min(this.filteredItems.length - 1, this.currentIndex + 1);
          this.render();
        } else if (key.name === "d") {
          this.showDeps = !this.showDeps;
          this.render();
        } else if (key.name === "g") {
          this.showGates = !this.showGates;
          this.render();
        } else if (str === "/") {
          // Enter filter mode
          cleanup();
          this.enterFilterMode().then(() => {
            this.filteredItems = this.applyFilter();
            this.currentIndex = 0;
            onKeyPress("", { name: "refresh" });
          });
        }
      };

      const cleanup = () => {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.removeListener("keypress", onKeyPress);
        console.clear();
      };

      process.stdin.on("keypress", onKeyPress);
    });
  }

  private async enterFilterMode(): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(chalk.yellow("Filter text (Enter to clear): "), (answer) => {
        this.filterText = answer.trim();
        rl.close();
        resolve();
      });
    });
  }
}
