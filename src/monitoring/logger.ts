/**
 * Structured logging with correlation IDs for production observability
 */

import { isColorDisabled } from "../util/colorControl.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  correlationId?: string;
  event: string;
  [key: string]: any;
}

export interface LoggerOptions {
  format?: "json" | "human";
  minLevel?: LogLevel;
  correlationId?: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Structured logger with support for JSON and human-readable formats
 */
export class Logger {
  private format: "json" | "human";
  private minLevel: number;
  private correlationId?: string;

  constructor(options: LoggerOptions = {}) {
    this.format = options.format || this.detectFormat();
    this.minLevel = LOG_LEVELS[options.minLevel || "info"];
    this.correlationId = options.correlationId;
  }

  /**
   * Detect log format based on environment
   */
  private detectFormat(): "json" | "human" {
    // Use JSON in CI or when explicitly requested
    if (process.env.CI === "true" || process.env.LOG_FORMAT === "json") {
      return "json";
    }
    // Use human-readable format in development
    return "human";
  }

  /**
   * Set correlation ID for request tracing
   */
  setCorrelationId(id: string): void {
    this.correlationId = id;
  }

  /**
   * Clear correlation ID
   */
  clearCorrelationId(): void {
    this.correlationId = undefined;
  }

  /**
   * Log a message at the specified level
   */
  log(level: LogLevel, event: string, metadata: Record<string, any> = {}): void {
    if (LOG_LEVELS[level] < this.minLevel) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...metadata,
    };

    if (this.correlationId) {
      entry.correlationId = this.correlationId;
    }

    if (this.format === "json") {
      console.log(JSON.stringify(entry));
    } else {
      this.logHuman(entry);
    }
  }

  /**
   * Format log entry for human consumption
   */
  private logHuman(entry: LogEntry): void {
    const icon = this.getLevelIcon(entry.level);
    const prefix = entry.correlationId ? `[${entry.correlationId}] ` : "";
    const metadata = Object.entries(entry)
      .filter(([key]) => !["timestamp", "level", "event", "correlationId"].includes(key))
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(" ");

    const message = `${icon} ${prefix}${entry.event}${metadata ? " " + metadata : ""}`;

    // Route to appropriate console method
    if (entry.level === "error") {
      console.error(message);
    } else if (entry.level === "warn") {
      console.warn(message);
    } else {
      console.log(message);
    }
  }

  /**
   * Get icon for log level
   */
  private getLevelIcon(level: LogLevel): string {
    // Don't use emoji icons when color is disabled (JSON mode, --no-color, etc.)
    if (isColorDisabled()) {
      switch (level) {
        case "debug":
          return "[DEBUG]";
        case "info":
          return "[INFO]";
        case "warn":
          return "[WARN]";
        case "error":
          return "[ERROR]";
      }
    }

    switch (level) {
      case "debug":
        return "🔍";
      case "info":
        return "ℹ️";
      case "warn":
        return "⚠️";
      case "error":
        return "❌";
    }
  }

  debug(event: string, metadata?: Record<string, any>): void {
    this.log("debug", event, metadata);
  }

  info(event: string, metadata?: Record<string, any>): void {
    this.log("info", event, metadata);
  }

  warn(event: string, metadata?: Record<string, any>): void {
    this.log("warn", event, metadata);
  }

  error(event: string, metadata?: Record<string, any>): void {
    this.log("error", event, metadata);
  }
}

/**
 * Create a logger instance with optional correlation ID
 */
export function createLogger(options?: LoggerOptions): Logger {
  return new Logger(options);
}

/**
 * Generate a correlation ID for request tracing
 */
export function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
