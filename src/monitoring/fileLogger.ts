/**
 * NDJSON file logger for runner operations
 * Writes structured logs to .smartergpt.local/runner/logs/runner.log.ndjson
 */

import * as fs from "fs";
import * as path from "path";

export type FileLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface FileLogEntry {
  timestamp: string;
  level: FileLogLevel;
  message?: string;
  module?: string;
  operation?: string;
  duration_ms?: number;
  error?: string | { message: string; stack?: string; code?: string };
  metadata?: Record<string, any>;
}

export interface FileLoggerOptions {
  profileDir: string;
  minLevel?: FileLogLevel;
  enabled?: boolean;
}

const LOG_LEVELS: Record<FileLogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

/**
 * NDJSON file logger for structured logging to disk
 */
export class FileLogger {
  private logFilePath: string;
  private minLevel: number;
  private enabled: boolean;
  private logStream: fs.WriteStream | null = null;

  constructor(options: FileLoggerOptions) {
    this.enabled = options.enabled !== false;
    this.minLevel = LOG_LEVELS[options.minLevel || "info"];

    // Create logs directory
    const logsDir = path.join(options.profileDir, "runner", "logs");
    if (this.enabled) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    this.logFilePath = path.join(logsDir, "runner.log.ndjson");
  }

  /**
   * Initialize log stream (lazy initialization)
   */
  private ensureStream(): void {
    if (!this.enabled || this.logStream) {
      return;
    }

    this.logStream = fs.createWriteStream(this.logFilePath, {
      flags: "a", // append mode
      encoding: "utf8",
    });
  }

  /**
   * Log a message at the specified level
   */
  log(
    level: FileLogLevel,
    options: {
      message?: string;
      module?: string;
      operation?: string;
      duration_ms?: number;
      error?: Error | string;
      metadata?: Record<string, any>;
    }
  ): void {
    if (!this.enabled || LOG_LEVELS[level] < this.minLevel) {
      return;
    }

    this.ensureStream();

    if (!this.logStream) {
      // Stream creation failed, skip logging
      return;
    }

    const entry: FileLogEntry = {
      timestamp: new Date().toISOString(),
      level,
    };

    if (options.message) {
      entry.message = options.message;
    }

    if (options.module) {
      entry.module = options.module;
    }

    if (options.operation) {
      entry.operation = options.operation;
    }

    if (options.duration_ms !== undefined) {
      entry.duration_ms = options.duration_ms;
    }

    if (options.error) {
      if (options.error instanceof Error) {
        entry.error = {
          message: options.error.message,
          stack: options.error.stack,
          code: (options.error as any).code,
        };
      } else {
        entry.error = options.error;
      }
    }

    if (options.metadata) {
      entry.metadata = options.metadata;
    }

    const line = JSON.stringify(entry) + "\n";

    // Write to stream, but handle potential failures gracefully
    try {
      this.logStream.write(line);
    } catch (error) {
      // Best effort - don't throw on write failures
      console.warn(
        `Failed to write log: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  trace(message: string, options?: Omit<Parameters<typeof this.log>[1], "message">): void {
    this.log("trace", { message, ...options });
  }

  debug(message: string, options?: Omit<Parameters<typeof this.log>[1], "message">): void {
    this.log("debug", { message, ...options });
  }

  info(message: string, options?: Omit<Parameters<typeof this.log>[1], "message">): void {
    this.log("info", { message, ...options });
  }

  warn(message: string, options?: Omit<Parameters<typeof this.log>[1], "message">): void {
    this.log("warn", { message, ...options });
  }

  error(message: string, options?: Omit<Parameters<typeof this.log>[1], "message">): void {
    this.log("error", { message, ...options });
  }

  fatal(message: string, options?: Omit<Parameters<typeof this.log>[1], "message">): void {
    this.log("fatal", { message, ...options });
  }

  /**
   * Close the log stream
   */
  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.logStream) {
        this.logStream.end(() => {
          this.logStream = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

/**
 * Create a file logger instance
 */
export function createFileLogger(options: FileLoggerOptions): FileLogger {
  return new FileLogger(options);
}
