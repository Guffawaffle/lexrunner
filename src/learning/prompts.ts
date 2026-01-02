/**
 * Interactive Prompts for Counter-Example Classification - LR-TSF-003
 *
 * Provides user prompts for classifying failures as counter-examples.
 */

import * as readline from "readline";
import type {
  CounterExampleClassification,
  CounterExampleClassificationType,
} from "./counter-example.js";

/**
 * Prompt for user input
 */
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Prompt user to classify a failure as a counter-example
 *
 * Returns null if user chooses to skip recording
 */
export async function promptCounterExampleClassification(
  gateName: string,
  errorMessage: string
): Promise<CounterExampleClassification | null> {
  console.log("\n❌ Gate Failure Detected\n");
  console.log(`Gate: ${gateName}`);
  console.log(
    `Error: ${errorMessage.substring(0, 200)}${errorMessage.length > 200 ? "..." : ""}\n`
  );
  console.log("Would you like to record this failure as a counter-example?");
  console.log("This helps improve future constraint derivation.\n");
  console.log("[1] Yes - Transient failure (don't learn from this)");
  console.log("[2] Yes - Constraint gap (should have caught this)");
  console.log("[3] Yes - False positive (constraint too strict)");
  console.log("[4] No - Skip recording\n");

  const choice = await prompt("Choose option [1-4]: ");

  switch (choice) {
    case "1": {
      const description = await prompt(
        "Briefly describe why this is transient (e.g., 'flaky network'): "
      );
      return {
        type: "transient",
        description: description || "Transient failure",
      };
    }

    case "2": {
      const description = await prompt(
        "Describe what constraint gap this reveals (e.g., 'missing mock setup'): "
      );
      const suggestedAction = await prompt("Suggested action (optional): ");
      return {
        type: "gap",
        description: description || "Constraint gap identified",
        suggestedAction: suggestedAction || undefined,
      };
    }

    case "3": {
      const description = await prompt(
        "Describe why this is a false positive (e.g., 'test is too strict'): "
      );
      const suggestedAction = await prompt("Suggested action (optional): ");
      return {
        type: "false-positive",
        description: description || "False positive detected",
        suggestedAction: suggestedAction || undefined,
      };
    }

    case "4":
      console.log("Skipping counter-example recording.");
      return null;

    default:
      console.log("Invalid choice. Skipping counter-example recording.");
      return null;
  }
}

/**
 * Simplified prompt for auto-recording mode
 * Always records as 'unknown' type
 */
export function createAutoRecordClassification(errorMessage: string): CounterExampleClassification {
  return {
    type: "unknown",
    description: `Auto-recorded failure: ${errorMessage.substring(0, 100)}`,
  };
}
