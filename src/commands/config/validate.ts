/**
 * Config validate command - Validate profile configuration files
 */

import { Command } from "commander";
import { resolveProfile } from "../../config/profileResolver.js";
import { resolveConfigPath } from "../../config/pathResolver.js";
import { writeJsonOutput } from "../../cli/output.js";
import { throwExit } from "../../cli/exitHandler.js";
import { CONFIG_SCHEMAS, ConfigFileName } from "../../config/schemas.js";
import * as fs from "fs";
import * as path from "path";
import YAML from "yaml";
import { z } from "zod";

/**
 * Validation result for a single file
 */
interface FileValidationResult {
  file: string;
  valid: boolean;
  errors: Array<{
    line?: number;
    message: string;
  }>;
  warnings: Array<{
    line?: number;
    message: string;
  }>;
}

/**
 * Overall validation result
 */
interface ValidationResult {
  valid: boolean;
  profilePath: string;
  files: FileValidationResult[];
  errors: Array<{
    file: string;
    line?: number;
    message: string;
  }>;
  warnings: Array<{
    file: string;
    line?: number;
    message: string;
  }>;
}

/**
 * Validate YAML syntax and parse file
 */
function validateYAMLSyntax(
  filePath: string,
  content: string
): {
  valid: boolean;
  parsed?: any;
  error?: { line?: number; message: string };
} {
  try {
    const parsed = YAML.parse(content, { prettyErrors: true });
    return { valid: true, parsed };
  } catch (error) {
    if (error instanceof Error) {
      // Try to extract line number from YAML parse error
      const lineMatch = error.message.match(/at line (\d+)/i);
      const line = lineMatch ? parseInt(lineMatch[1], 10) : undefined;
      return {
        valid: false,
        error: {
          line,
          message: error.message,
        },
      };
    }
    return {
      valid: false,
      error: { message: String(error) },
    };
  }
}

/**
 * Validate file against its schema
 */
function validateFileSchema(
  fileName: ConfigFileName,
  parsed: any
): {
  valid: boolean;
  errors: Array<{ message: string; path?: string }>;
} {
  const schema = CONFIG_SCHEMAS[fileName];
  const result = schema.safeParse(parsed);

  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors = result.error.issues.map((issue) => ({
    message: issue.message,
    path: issue.path.join("."),
  }));

  return { valid: false, errors };
}

/**
 * Validate a single configuration file
 */
function validateConfigFile(profilePath: string, fileName: string): FileValidationResult {
  const result: FileValidationResult = {
    file: fileName,
    valid: true,
    errors: [],
    warnings: [],
  };

  // Resolve config path with runner/ support
  const resolved = resolveConfigPath(profilePath, fileName);
  const filePath = resolved.path;

  // Check if file exists
  if (!resolved.exists) {
    // Optional files - not an error
    if (fileName === "deps.yml" || fileName === "stack.yml" || fileName === "merge-policy.yml") {
      return result;
    }
    result.valid = false;
    result.errors.push({
      message: `File not found: ${fileName}`,
    });
    return result;
  }

  // Read file content
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    result.valid = false;
    result.errors.push({
      message: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
    });
    return result;
  }

  // Validate YAML syntax
  const syntaxValidation = validateYAMLSyntax(filePath, content);
  if (!syntaxValidation.valid) {
    result.valid = false;
    result.errors.push({
      line: syntaxValidation.error?.line,
      message: `YAML syntax error: ${syntaxValidation.error?.message || "Unknown error"}`,
    });
    return result;
  }

  // Validate against schema (if schema exists for this file)
  if (fileName in CONFIG_SCHEMAS) {
    const schemaValidation = validateFileSchema(
      fileName as ConfigFileName,
      syntaxValidation.parsed
    );

    if (!schemaValidation.valid) {
      result.valid = false;
      for (const error of schemaValidation.errors) {
        result.errors.push({
          message: error.path ? `${error.path}: ${error.message}` : error.message,
        });
      }
    }
  }

  return result;
}

/**
 * Perform cross-file reference validation
 */
function validateCrossReferences(
  profilePath: string,
  fileResults: Map<string, FileValidationResult>
): Array<{ file: string; message: string }> {
  const warnings: Array<{ file: string; message: string }> = [];

  // Load gates.yml to get defined gates with runner/ support
  const gatesResolved = resolveConfigPath(profilePath, "gates.yml");
  let definedGates: Set<string> = new Set();

  if (gatesResolved.exists) {
    try {
      const gatesContent = fs.readFileSync(gatesResolved.path, "utf-8");
      const gatesParsed = YAML.parse(gatesContent);
      if (gatesParsed?.levels) {
        for (const level of Object.values(gatesParsed.levels)) {
          if (Array.isArray(level)) {
            for (const gate of level) {
              if (gate?.name) {
                definedGates.add(gate.name);
              }
            }
          }
        }
      }
    } catch (error) {
      // Skip cross-reference validation if gates.yml is malformed
      return warnings;
    }
  }

  // Check stack.yml for gate references with runner/ support
  const stackResolved = resolveConfigPath(profilePath, "stack.yml");
  if (stackResolved.exists) {
    try {
      const stackContent = fs.readFileSync(stackResolved.path, "utf-8");
      const stackParsed = YAML.parse(stackContent);
      if (stackParsed?.items) {
        for (const item of stackParsed.items) {
          if (item?.gates) {
            for (const gate of item.gates) {
              if (gate?.name && !definedGates.has(gate.name)) {
                warnings.push({
                  file: "stack.yml",
                  message: `Referenced gate '${gate.name}' not defined in gates.yml`,
                });
              }
            }
          }
        }
      }
    } catch (error) {
      // Skip if stack.yml is malformed
    }
  }

  return warnings;
}

/**
 * Validate all configuration files in profile
 */
function validateProfile(profilePath: string, options: { strict?: boolean }): ValidationResult {
  const configFiles = ["gates.yml", "scope.yml", "deps.yml", "stack.yml", "merge-policy.yml"];

  const fileResults = new Map<string, FileValidationResult>();
  const allErrors: ValidationResult["errors"] = [];
  const allWarnings: ValidationResult["warnings"] = [];

  // Validate each config file
  for (const fileName of configFiles) {
    const result = validateConfigFile(profilePath, fileName);
    fileResults.set(fileName, result);

    // Collect errors
    for (const error of result.errors) {
      allErrors.push({
        file: fileName,
        line: error.line,
        message: error.message,
      });
    }

    // Collect warnings
    for (const warning of result.warnings) {
      allWarnings.push({
        file: fileName,
        line: warning.line,
        message: warning.message,
      });
    }
  }

  // Cross-reference validation
  const crossRefWarnings = validateCrossReferences(profilePath, fileResults);
  for (const warning of crossRefWarnings) {
    allWarnings.push(warning);
    fileResults.get(warning.file)?.warnings.push({ message: warning.message });
  }

  // Determine overall validity
  const hasErrors = allErrors.length > 0;
  const hasWarnings = allWarnings.length > 0;
  const valid = options.strict ? !hasErrors && !hasWarnings : !hasErrors;

  return {
    valid,
    profilePath,
    files: Array.from(fileResults.values()),
    errors: allErrors,
    warnings: allWarnings,
  };
}

/**
 * Register the config validate command
 */
export function registerConfigValidateCommand(
  program: Command,
  jsonModeActive?: () => boolean
): void {
  // Get or create the config command (if not already created by registerConfigCommand)
  let configCommand = program.commands.find((cmd) => cmd.name() === "config");

  if (!configCommand) {
    configCommand = program.command("config").description("Configuration management commands");
  }

  configCommand
    .command("validate")
    .description("Validate profile configuration files")
    .option("--profile-dir <dir>", "Profile directory to validate")
    .option("--strict", "Fail on warnings as well as errors")
    .option("--json", "Output JSON format")
    .action((opts) => {
      try {
        // Resolve profile directory
        let profilePath: string;
        if (opts.profileDir) {
          // Use explicit profile dir
          profilePath = path.isAbsolute(opts.profileDir)
            ? opts.profileDir
            : path.resolve(process.cwd(), opts.profileDir);
        } else {
          // Try to resolve via normal profile resolution
          try {
            const profile = resolveProfile(opts.profileDir);
            profilePath = profile.path;
          } catch (error) {
            // Fallback to default .smartergpt directory if profile resolution fails
            // This allows validation to work in repos with example profiles
            profilePath = path.resolve(process.cwd(), ".smartergpt");
          }
        }

        // Validate profile
        const result = validateProfile(profilePath, {
          strict: opts.strict,
        });

        // Check if JSON mode is active
        const isJsonMode = opts.json || (jsonModeActive && jsonModeActive());

        if (isJsonMode) {
          // JSON output
          writeJsonOutput({
            valid: result.valid,
            profilePath: result.profilePath,
            errors: result.errors,
            warnings: result.warnings,
            files: result.files.map((f) => ({
              file: f.file,
              valid: f.valid,
              errorCount: f.errors.length,
              warningCount: f.warnings.length,
            })),
          });
        } else {
          // Human-readable output
          console.log(`\nValidating profile: ${profilePath}`);
          console.log("━".repeat(60));
          console.log("");

          // Show per-file results
          for (const fileResult of result.files) {
            const icon = fileResult.valid ? "✅" : "❌";
            const status = fileResult.valid ? "Valid" : "Invalid";
            console.log(`${icon} ${fileResult.file} - ${status}`);

            // Show errors
            for (const error of fileResult.errors) {
              const lineInfo = error.line ? `Line ${error.line}: ` : "";
              console.log(`   ${lineInfo}${error.message}`);
            }

            // Show warnings
            if (fileResult.warnings.length > 0) {
              console.log("");
            }
          }

          // Show warnings separately
          if (result.warnings.length > 0) {
            console.log("");
            for (const warning of result.warnings) {
              console.log(`⚠️  ${warning.file} - Warning`);
              console.log(`   ${warning.message}`);
            }
          }

          console.log("");
          console.log("━".repeat(60));

          // Summary
          const errorCount = result.errors.length;
          const warningCount = result.warnings.length;

          if (result.valid) {
            console.log("✅ Validation passed");
            if (warningCount > 0) {
              console.log(`   ${warningCount} warning(s) found`);
              if (!opts.strict) {
                console.log("   Use --strict to fail on warnings");
              }
            }
          } else {
            console.log(`❌ Validation failed: ${errorCount} error(s), ${warningCount} warning(s)`);
            if (errorCount === 0 && warningCount > 0) {
              console.log("   Use --strict to fail on warnings");
            }
          }

          console.log("");
        }

        // Exit with appropriate code
        if (!result.valid) {
          throwExit(1);
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        throwExit(1);
      }
    });
}
