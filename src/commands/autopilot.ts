/**
 * Autopilot command - Automated multi-level PR integration orchestration
 */

import { Command } from "commander";
import { Plan, loadPlan } from "../schema.js";
import { resolveProfile } from "../config/profileResolver.js";
import { throwExit, CLIExitSignal } from "../cli/exitHandler.js";
import { writeJsonOutput } from "../cli/output.js";
import { initAuditEmitter, emitEvent, AuditEmitter, EVENT_TYPES } from "../audit/index.js";
import * as fs from "fs";
import * as path from "path";

interface AutopilotCommandDeps {
  jsonModeActive: () => boolean;
  exitWith: (e: unknown) => void;
  getAuditProfile?: () => string | undefined;
  getAuditKey?: () => string | undefined;
  finalizeAuditGuard?: (emitter: AuditEmitter, status?: string) => Promise<void>;
}

interface AutopilotExecutor {
  execute: (deliverablesDir?: string) => Promise<{ success: boolean; message: string }>;
}

/**
 * Register the autopilot command
 */
export function registerAutopilotCommand(program: Command, deps: AutopilotCommandDeps): void {
  program
    .command("autopilot")
    .description("Run autopilot analysis and artifact generation")
    .option("--plan <file>", "Path to plan.json file")
    .argument("[file]", "Path to plan.json file (alternative to --plan)")
    .option("--level <level>", "Autopilot level (0=report-only, 1=artifacts)", "1")
    .option("--profile-dir <dir>", "Profile directory (default: .smartergpt)")
    .option(
      "--deliverables-dir <dir>",
      "Custom deliverables directory (overrides default profile/deliverables)"
    )
    .option("--json", "Output JSON format")
    .action(async (file: string | undefined, opts) => {
      const planFile = opts.plan || file;
      let auditEmitter: AuditEmitter | null = null;
      if (!planFile) {
        console.error("Error: plan file is required (use --plan <file> or provide as argument)");
        throwExit(1);
      }

      try {
        // Load plan
        const planContent = fs.readFileSync(planFile, "utf-8");
        const plan = loadPlan(planContent);

        // Resolve profile
        const profile = resolveProfile(opts.profileDir);

        // Initialize audit emitter from global flag if present
        const globalAudit = deps.getAuditProfile?.() as string | undefined;
        if (globalAudit && globalAudit !== "off") {
          const auditDir = path.join(profile.path, "deliverables", "audit");
          const cliKey = deps.getAuditKey?.() as string | undefined;
          const envKey = process.env.LEX_AUDIT_KEY_HEX;
          const keyToUse = cliKey || envKey;
          const phiFlag = globalAudit === "hipaa-strict" || process.env.LEX_AUDIT_PHI === "1";
          auditEmitter = await initAuditEmitter({
            profile: globalAudit as any,
            dir: auditDir,
            phiRedaction: phiFlag,
            encryptionKeyHex: keyToUse,
          });
          await emitEvent(auditEmitter, EVENT_TYPES.COMMAND_INVOCATION, {
            command: "autopilot",
            argv: process.argv.slice(2),
          });
        }

        // Import autopilot modules
        const { AutopilotLevel0, AutopilotLevel1, AutopilotLevel2 } =
          await import("../autopilot/index.js");

        // Create autopilot context
        const context = {
          plan,
          profilePath: profile.path,
          profileRole: profile.manifest.role,
        };

        // Select and execute autopilot level
        const level = parseInt(opts.level);
        const autopilot = (() => {
          if (level === 0) {
            return new AutopilotLevel0(context);
          }
          if (level === 1) {
            return new AutopilotLevel1(context);
          }
          if (level === 2) {
            return new AutopilotLevel2(context);
          }
          console.error(`Error: unsupported autopilot level ${level} (supported: 0, 1, 2)`);
          throwExit(1);
        })() as AutopilotExecutor;

        // Execute with optional custom deliverables directory
        const result = await autopilot.execute(opts.deliverablesDir);

        if (opts.json || deps.jsonModeActive()) {
          writeJsonOutput(result);
        } else {
          console.log(result.message);
        }

        if (!result.success) {
          throwExit(1);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (opts.json || deps.jsonModeActive()) {
          writeJsonOutput({ success: false, error: message });
        } else {
          console.error(`Error running autopilot: ${message}`);
        }
        deps.exitWith(error);
      } finally {
        if (auditEmitter && deps.finalizeAuditGuard) {
          await deps.finalizeAuditGuard(auditEmitter);
        }
      }
    });
}
