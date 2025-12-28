/**
 * Bulk operations for batch merge and selective retry
 */

import { Plan, loadPlan } from "../schema.js";
import { computeMergeOrder } from "../mergeOrder.js";
import { PlanQueryEngine } from "./query.js";
import * as fs from "fs";

export interface BulkOperationOptions {
  filter?: string;
  dryRun?: boolean;
  levels?: number[];
  items?: string[];
}

export interface BulkOperationResult {
  success: boolean;
  processedItems: string[];
  skippedItems: string[];
  failedItems: string[];
  errors: Array<{ item: string; error: string }>;
}

/**
 * Batch merge operations
 */
export class BulkMergeOperation {
  private plan: Plan;
  private levels: string[][];

  constructor(plan: Plan) {
    this.plan = plan;
    this.levels = computeMergeOrder(plan);
  }

  /**
   * Select items for bulk operation based on options
   */
  selectItems(options: BulkOperationOptions): string[] {
    let selectedItems: string[] = [];

    // If specific items are provided, use those
    if (options.items && options.items.length > 0) {
      selectedItems = options.items;
    }
    // If levels are specified, select items from those levels
    else if (options.levels && options.levels.length > 0) {
      for (const level of options.levels) {
        if (level > 0 && level <= this.levels.length) {
          selectedItems.push(...this.levels[level - 1]);
        }
      }
    }
    // If filter is specified, use query engine
    else if (options.filter) {
      const queryEngine = new PlanQueryEngine(this.plan);
      const result = queryEngine.query(options.filter);
      selectedItems = result.items.map((item) => item.name);
    }
    // Otherwise, select all items
    else {
      selectedItems = this.plan.items.map((item) => item.name);
    }

    // Validate selected items exist in plan
    const validItems = selectedItems.filter((item) =>
      this.plan.items.some((planItem) => planItem.name === item)
    );

    return validItems;
  }

  /**
   * Execute bulk merge (returns plan for dry-run, or executes)
   */
  async execute(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const selectedItems = this.selectItems(options);

    if (options.dryRun) {
      return {
        success: true,
        processedItems: [],
        skippedItems: [],
        failedItems: [],
        errors: [],
      };
    }

    // In real implementation, this would call merge operations
    const processedItems: string[] = [];
    const failedItems: string[] = [];
    const errors: Array<{ item: string; error: string }> = [];

    for (const item of selectedItems) {
      try {
        // Placeholder for actual merge logic
        processedItems.push(item);
      } catch (error) {
        failedItems.push(item);
        errors.push({
          item,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      success: failedItems.length === 0,
      processedItems,
      skippedItems: [],
      failedItems,
      errors,
    };
  }
}

/**
 * Selective retry operations
 */
export class RetryOperation {
  private stateDir: string;

  constructor(stateDir: string = ".smartergpt/runner") {
    this.stateDir = stateDir;
  }

  /**
   * Find failed gates from execution state
   */
  findFailedGates(): Array<{ item: string; gate: string }> {
    const failedGates: Array<{ item: string; gate: string }> = [];

    if (!fs.existsSync(this.stateDir)) {
      return failedGates;
    }

    const files = fs.readdirSync(this.stateDir);
    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const content = fs.readFileSync(`${this.stateDir}/${file}`, "utf-8");
          const state = JSON.parse(content);

          if (state.status === "failed") {
            const match = file.match(/^(.+)-(.+)\.json$/);
            if (match) {
              failedGates.push({ item: match[1], gate: match[2] });
            }
          }
        } catch (error) {
          // Skip invalid files
        }
      }
    }

    return failedGates;
  }

  /**
   * Retry failed gates with optional filtering
   */
  async retryFailed(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const failedGates = this.findFailedGates();

    let gatesToRetry = failedGates;

    // Filter by items if specified
    if (options.items && options.items.length > 0) {
      gatesToRetry = gatesToRetry.filter((gate) => options.items!.includes(gate.item));
    }

    // Filter by query if specified
    if (options.filter) {
      const filterLower = options.filter.toLowerCase();
      gatesToRetry = gatesToRetry.filter(
        (gate) =>
          gate.item.toLowerCase().includes(filterLower) ||
          gate.gate.toLowerCase().includes(filterLower)
      );
    }

    if (options.dryRun) {
      return {
        success: true,
        processedItems: gatesToRetry.map((g) => `${g.item}:${g.gate}`),
        skippedItems: [],
        failedItems: [],
        errors: [],
      };
    }

    // In real implementation, this would re-execute gates
    const processedItems = gatesToRetry.map((g) => `${g.item}:${g.gate}`);

    return {
      success: true,
      processedItems,
      skippedItems: [],
      failedItems: [],
      errors: [],
    };
  }
}
