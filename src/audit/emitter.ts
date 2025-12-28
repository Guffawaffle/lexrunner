/**
 * Core audit emitter - NDJSON event stream with envelope stamping
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { ulid } from "ulid";
import { EventEnvelope, EventLevel, Tool, Actor, Repo, Context } from "./events.js";
import { AuditProfile, getProfileConfig, AuditProfileConfig } from "./profiles.js";
import { redactObject, buildContext, hashPath, redactPHIFromObject } from "./redaction.js";
import { generateManifest, writeManifest } from "./manifest.js";
import { ingestSidecarFiles } from "./sidecar.js";
import { collectContext, AuditContext } from "./context.js";
import * as crypto from "crypto";

export interface AuditOptions {
  profile: AuditProfile;
  dir: string;
  format?: "jsonl";
  includeEnv?: string[];
  redactRegex?: string;
  hashPaths?: boolean;
  context?: ("git" | "ci" | "os")[];
  contextTypes?: ("git" | "ci" | "os")[]; // Alias for context
  signer?: string;
  retainDays?: number;
  sample?: number;
  sessionId?: string; // Optional override for testing
  runId?: string; // Optional override for testing
  tool?: { name: string; version: string }; // Optional override for testing
  // Optional HIPAA-related toggles
  phiRedaction?: boolean; // redact PHI patterns when true
  encryptionKeyHex?: string; // optional AES-256-GCM key (hex) to encrypt ndjson at finalize
  // Optional SARIF output
  sarif?: boolean; // generate SARIF output from vuln_found events
}

export interface AuditSummary {
  schemaVersion: string;
  timestamp: string;
  sessionId: string;
  runId: string;
  profile: AuditProfile;
  totalEvents: number;
  eventsByType: Record<string, number>;
  duration: number;
  finalStatus: string;
}

export class AuditEmitter {
  private options: AuditOptions;
  private config: AuditProfileConfig | null;
  private auditDir: string;
  private ndjsonPath: string;
  private ndjsonStream: fs.WriteStream | null = null;
  private sessionId: string;
  private runId: string;
  private tool: Tool;
  private actor: Actor;
  private repo: Repo;
  private context?: Context;
  private eventCount = 0;
  private eventsByType: Record<string, number> = {};
  private startTime: number;
  private dropDir: string;
  private sidecarIngestInterval: NodeJS.Timeout | null = null;
  private lockHash?: string; // Optional lock hash for merge-weave runs

  constructor(options: AuditOptions) {
    this.options = options;
    this.config = getProfileConfig(options.profile);
    this.auditDir = options.dir;
    this.ndjsonPath = path.join(this.auditDir, "audit.ndjson");
    this.sessionId = options.sessionId || ulid();
    this.runId = options.runId || ulid();
    this.startTime = Date.now();

    // Tool info (with optional override for testing)
    this.tool = options.tool || {
      name: "lexrunner",
      version: process.env.npm_package_version || "0.1.0",
    };

    // Actor type
    this.actor = {
      type: process.env.MCP_SERVER ? "mcp" : process.env.CI ? "ci" : "cli",
    };

    // Repo info
    this.repo = {};

    // Context will be built during init()
    this.context = {};

    // Sidecar drop directory
    this.dropDir = `/tmp/lex-audit-session-${this.sessionId}`;
  }

  /**
   * Initialize emitter - create directory and files
   */
  async init(): Promise<void> {
    // If profile is 'off', skip all initialization
    if (!this.config || this.options.profile === "off") {
      return;
    }

    // Build context if profile requires it
    if (this.config) {
      const contextTypes =
        this.options.contextTypes || this.options.context || this.config.includeContext;

      // Collect comprehensive context (git, CI, OS)
      if (contextTypes && contextTypes.length > 0) {
        try {
          const auditContext = await collectContext(contextTypes);
          this.context = auditContext as Context;
        } catch (err) {
          // Context collection failed, log warning and continue with empty context
          console.warn("[lex-pr] audit: context collection failed", err);
          this.context = {};
        }
      } else {
        this.context = {};
      }
    }

    // Create audit directory
    if (!fs.existsSync(this.auditDir)) {
      fs.mkdirSync(this.auditDir, { recursive: true });
    }

    // Create drop directory for sidecar files
    if (!fs.existsSync(this.dropDir)) {
      fs.mkdirSync(this.dropDir, { recursive: true });
    }

    // Set environment variables for gates
    process.env.LEX_AUDIT_DROP_DIR = this.dropDir;
    process.env.LEX_AUDIT_SESSION_ID = this.sessionId;

    // Create empty NDJSON file if it doesn't exist
    if (!fs.existsSync(this.ndjsonPath)) {
      fs.writeFileSync(this.ndjsonPath, "");
    }

    // Open NDJSON stream
    this.ndjsonStream = fs.createWriteStream(this.ndjsonPath, { flags: "a", autoClose: true });
    // Guard against stream errors (e.g., directory removed concurrently in tests)
    this.ndjsonStream.on("error", (err) => {
      console.warn("[lex-pr] audit: ndjson stream error (ignored)", String(err));
    });

    // Write schema file
    const schemaPath = path.join(this.auditDir, "audit.schema.json");
    const schema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      version: "0.1.0",
      description: "Audit event envelope schema",
      type: "object",
      required: [
        "schema_version",
        "event",
        "ts",
        "level",
        "session_id",
        "run_id",
        "tool",
        "actor",
        "repo",
        "payload",
      ],
      properties: {
        schema_version: { type: "string" },
        event: { type: "string" },
        ts: { type: "string", format: "date-time" },
        level: { type: "string", enum: ["info", "warn", "error"] },
        session_id: { type: "string" },
        run_id: { type: "string" },
        tool: { type: "object" },
        actor: { type: "object" },
        repo: { type: "object" },
        context: { type: "object" },
        lock_hash: { type: "string", description: "Lock hash for merge-weave idempotency" },
        payload: { type: "object" },
      },
    };
    fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2));

    // Start periodic sidecar ingestion
    this.startSidecarIngestion();
  }

  /**
   * Emit an audit event
   */
  async emit(event: string, payload: any, level: EventLevel = "info"): Promise<void> {
    if (!this.config || !this.ndjsonStream) {
      return; // Profile is 'off' or not initialized
    }

    // Apply sampling if configured
    if (this.options.sample !== undefined && this.options.sample < 100) {
      if (Math.random() * 100 > this.options.sample) {
        return; // Skip this event
      }
    }

    // Redact payload if needed
    let redactedPayload = payload;
    const redactRegex = this.options.redactRegex || this.config.redactRegex;
    if (redactRegex) {
      redactedPayload = redactObject(payload, redactRegex);
    }

    // PHI redaction (opt-in) - apply directly to object structure for efficiency
    if (this.options.phiRedaction) {
      const { obj, flagged } = redactPHIFromObject(redactedPayload);
      if (flagged) {
        redactedPayload = obj;
        // Mark payload to indicate PHI was detected and redacted
        if (typeof redactedPayload === "object" && redactedPayload !== null) {
          (redactedPayload as any)._phi_redacted = true;
        }
      }
    }

    // Hash paths if needed
    if (this.options.hashPaths || this.config.hashPaths) {
      if (redactedPayload.path) {
        redactedPayload.path = hashPath(redactedPayload.path);
      }
      if (redactedPayload.files && Array.isArray(redactedPayload.files)) {
        redactedPayload.files = redactedPayload.files.map((f: string) => hashPath(f));
      }
    }

    // Build envelope
    const envelope: EventEnvelope = {
      schema_version: "0.1.0",
      event,
      ts: new Date().toISOString(),
      level,
      session_id: this.sessionId,
      run_id: this.runId,
      tool: this.tool,
      actor: this.actor,
      repo: this.repo,
      context: this.context,
      lock_hash: this.lockHash, // Include lock hash if set
      payload: redactedPayload,
    };

    // Prepare line
    let line = JSON.stringify(envelope) + "\n";
    try {
      if (this.ndjsonStream && !this.ndjsonStream.destroyed) {
        this.ndjsonStream.write(line);
      }
    } catch (e) {
      console.warn("[lex-pr] audit: ndjson write failed (ignored)", String(e));
    }

    // Track event
    this.eventCount++;
    this.eventsByType[event] = (this.eventsByType[event] || 0) + 1;
  }

  /**
   * Set repository context
   */
  setRepo(repo: Partial<Repo>): void {
    this.repo = { ...this.repo, ...repo };
  }

  /**
   * Set lock hash for merge-weave runs
   */
  setLockHash(lockHash: string): void {
    this.lockHash = lockHash;
  }

  /**
   * Start periodic sidecar ingestion
   */
  private startSidecarIngestion(): void {
    this.sidecarIngestInterval = setInterval(async () => {
      try {
        await this.ingestSidecar();
      } catch (e) {
        // Don't let sidecar ingestion errors bubble and kill the test runner
        console.warn("[lex-pr] audit: sidecar ingestion error (ignored)", String(e));
      }
    }, 5000); // Every 5 seconds

    // Ensure the interval does not keep the Node event loop alive if finalize() is not called
    try {
      // Some Node timers have unref() to allow process to exit
      if (
        this.sidecarIngestInterval &&
        typeof (this.sidecarIngestInterval as any).unref === "function"
      ) {
        (this.sidecarIngestInterval as any).unref();
      }
    } catch (e) {
      // Swallow any errors here - defensive
    }
  }

  /**
   * Ingest sidecar files
   */
  async ingestSidecar(): Promise<void> {
    if (!this.config) return;

    const envelope = {
      schema_version: "0.1.0",
      session_id: this.sessionId,
      run_id: this.runId,
      tool: this.tool,
      actor: this.actor,
      repo: this.repo,
      context: this.context,
    };

    try {
      await ingestSidecarFiles(this.dropDir, envelope, async (event) => {
        try {
          // Apply redaction to ingested events
          const redactRegex = this.options.redactRegex || this.config!.redactRegex;
          if (redactRegex) {
            event.payload = redactObject(event.payload, redactRegex);
          }

          // Write to stream
          if (this.ndjsonStream) {
            this.ndjsonStream.write(JSON.stringify(event) + "\n");
            this.eventCount++;
            this.eventsByType[event.event] = (this.eventsByType[event.event] || 0) + 1;
          }
        } catch (innerErr) {
          console.warn("[lex-pr] audit: error ingesting sidecar event (ignored)", String(innerErr));
        }
      });
    } catch (err) {
      // If dropDir doesn't exist or files raced away, ignore the ingestion error
      console.warn("[lex-pr] audit: ingestSidecarFiles failed (ignored)", String(err));
    }
  }

  /**
   * Finalize audit - write summary and manifest
   */
  async finalize(finalStatus: string = "success"): Promise<void> {
    // Stop sidecar ingestion
    if (this.sidecarIngestInterval) {
      clearInterval(this.sidecarIngestInterval);
      this.sidecarIngestInterval = null;
    }

    // Final sidecar ingestion
    await this.ingestSidecar();

    // Close NDJSON stream and wait for it to finish
    if (this.ndjsonStream) {
      const stream = this.ndjsonStream;
      await new Promise<void>((resolve, reject) => {
        stream.end((err?: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.ndjsonStream = null;
    }

    if (!this.config) return;

    // Enforce HIPAA fail-closed: when profile is hipaa-strict, require a valid 64-hex key
    if (this.options.profile === "hipaa-strict") {
      const keyHex = this.options.encryptionKeyHex || process.env.LEX_AUDIT_KEY_HEX;
      const valid = typeof keyHex === "string" && /^[0-9a-fA-F]{64}$/.test(keyHex);
      if (!valid) {
        // Scrub any plaintext audit log and partial encrypted files, then write audit.error.json
        try {
          const nd = this.ndjsonPath;
          if (fs.existsSync(nd)) {
            fs.unlinkSync(nd);
          }
          const enc = nd + ".enc";
          if (fs.existsSync(enc)) {
            fs.unlinkSync(enc);
          }
        } catch (e) {
          console.error("[HIPAA] Failed to scrub sensitive audit files:", e);
        }

        const errObj = {
          profile: "hipaa-strict",
          status: "aborted",
          reason: "missing_or_invalid_key",
        };
        try {
          fs.writeFileSync(
            path.join(this.auditDir, "audit.error.json"),
            JSON.stringify(errObj, null, 2)
          );
        } catch (e) {
          // ignore write errors
        }

        throw new Error(
          "HIPAA: encryption key required and must be 64 hex chars (32 bytes); aborting and scrubbed plaintext."
        );
      }
      // ensure options has the canonical key set for later encryption
      this.options.encryptionKeyHex = keyHex;
    }

    const duration = Date.now() - this.startTime;

    // Write summary
    const summary: AuditSummary = {
      schemaVersion: "1.0.0",
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      runId: this.runId,
      profile: this.options.profile,
      totalEvents: this.eventCount,
      eventsByType: this.eventsByType,
      duration,
      finalStatus,
    };

    const summaryPath = path.join(this.auditDir, "audit-summary.json");
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

    // Generate gate matrix if profile requires it (e.g., soc2)
    if (this.config.includeContext?.length > 0) {
      await this.generateGateMatrix();
    }

    // Generate SARIF output if requested
    if (this.options.sarif) {
      await this.generateSARIF();
    }

    // Create signature stub (Phase 2)
    if (this.config.requireSignature) {
      const sigPath = path.join(this.auditDir, "audit.sig");
      fs.writeFileSync(sigPath, "# Signature stub - Phase 2 implementation pending\n");
    }

    // Optional at-rest encryption (opt-in via options.encryptionKeyHex)
    if (this.options.encryptionKeyHex) {
      // Debug: surface whether encryption key is present (non-sensitive length only)
      // (debug removed) do not log encryption key length or any sensitive material
      try {
        const key = Buffer.from(this.options.encryptionKeyHex as string, "hex");
        if (key.length !== 32) {
          throw new Error("HIPAA: encryption key invalid length");
        }
        const ndjsonPath = this.ndjsonPath;
        const src = fs.readFileSync(ndjsonPath);
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
        const enc = Buffer.concat([cipher.update(src), cipher.final()]);
        const tag = cipher.getAuthTag();
        const outPath = ndjsonPath + ".enc";
        fs.writeFileSync(outPath, Buffer.concat([iv, tag, enc]));
        // remove plaintext
        fs.unlinkSync(ndjsonPath);
      } catch (e) {
        // On HIPAA profiles, scrub plaintext and write audit.error.json, then surface a HIPAA-prefixed error
        try {
          const nd = this.ndjsonPath;
          if (fs.existsSync(nd)) fs.unlinkSync(nd);
          const enc = nd + ".enc";
          if (fs.existsSync(enc)) fs.unlinkSync(enc);
        } catch (ignored) {}
        try {
          fs.writeFileSync(
            path.join(this.auditDir, "audit.error.json"),
            JSON.stringify(
              { profile: this.options.profile, status: "aborted", reason: "encryption_failed" },
              null,
              2
            )
          );
        } catch (ignored) {}
        throw new Error("HIPAA: encryption failed; scrubbed plaintext and aborting.");
      }
    }

    // Generate and write manifest AFTER encryption (so .enc file is included instead of plaintext)
    const manifest = await generateManifest(this.auditDir, this.context as AuditContext);
    const manifestPath = await writeManifest(this.auditDir, manifest);

    // Sign manifest if signer is configured
    if (this.options.signer) {
      const { signManifest, parseSignerOption } = await import("./signing.js");
      const signingOptions = parseSignerOption(this.options.signer);
      await signManifest(manifestPath, signingOptions);
    }
  }

  /**
   * Generate gate matrix from audit events
   * Uses streaming to handle large audit logs efficiently
   */
  private async generateGateMatrix(): Promise<void> {
    // Read audit log
    const auditPath = path.join(this.auditDir, "audit.ndjson");
    if (!fs.existsSync(auditPath)) {
      return;
    }

    const matrix: Record<string, Record<string, any>> = {};
    let totalPassed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    let totalBlocked = 0;
    let totalGates = 0;

    try {
      // Use readline for memory-efficient line-by-line processing
      const fileStream = fs.createReadStream(auditPath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line);
          if (event.event === "gate_finished") {
            const { item, gate, status, duration_ms, error, reason } = event.payload;

            if (!matrix[item]) {
              matrix[item] = {};
            }

            matrix[item][gate] = {
              status,
              ...(duration_ms !== undefined && { duration_ms }),
              ...(error && { error }),
              ...(reason && { reason }),
            };

            totalGates++;
            if (status === "pass") totalPassed++;
            else if (status === "fail") totalFailed++;
            else if (status === "skip") totalSkipped++;
            else if (status === "blocked") totalBlocked++;
          }
        } catch (parseError) {
          // Skip malformed lines
          console.warn("[lex-pr] audit: skipping malformed line in audit.ndjson");
        }
      }
    } catch (e) {
      console.warn("[lex-pr] audit: failed to read audit.ndjson (ignored)", String(e));
      return;
    }

    const gateMatrix = {
      generated_at: new Date().toISOString(),
      session_id: this.sessionId,
      matrix,
      summary: {
        total_prs: Object.keys(matrix).length,
        total_gates: totalGates,
        passed: totalPassed,
        failed: totalFailed,
        skipped: totalSkipped,
        blocked: totalBlocked,
      },
    };

    const matrixPath = path.join(this.auditDir, "audit-gate-matrix.json");
    fs.writeFileSync(matrixPath, JSON.stringify(gateMatrix, null, 2));
  }

  /**
   * Generate SARIF report from vuln_found events
   * Uses streaming to handle large audit logs efficiently
   */
  private async generateSARIF(): Promise<void> {
    // Read audit log
    const auditPath = path.join(this.auditDir, "audit.ndjson");
    if (!fs.existsSync(auditPath)) {
      return;
    }

    const vulnEvents: EventEnvelope[] = [];

    try {
      // Use readline for memory-efficient line-by-line processing
      const fileStream = fs.createReadStream(auditPath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line) as EventEnvelope;
          if (event.event === "vuln_found") {
            vulnEvents.push(event);
          }
        } catch (parseError) {
          // Skip malformed lines
          console.warn("[lex-pr] audit: skipping malformed line in audit.ndjson");
        }
      }
    } catch (e) {
      console.warn("[lex-pr] audit: failed to read audit.ndjson for SARIF (ignored)", String(e));
      return;
    }

    // Only generate SARIF if we have vulnerability events
    if (vulnEvents.length === 0) {
      return;
    }

    // Generate and write SARIF
    const { generateSARIF, writeSARIF } = await import("./sarif.js");
    const sarifReport = await generateSARIF(vulnEvents, this.tool.version);
    const sarifPath = path.join(this.auditDir, "audit-sarif.json");
    await writeSARIF(sarifReport, sarifPath);
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get run ID
   */
  getRunId(): string {
    return this.runId;
  }

  /**
   * Get drop directory
   */
  getDropDir(): string {
    return this.dropDir;
  }
}

/**
 * Initialize audit emitter
 */
export async function initAuditEmitter(options: AuditOptions): Promise<AuditEmitter> {
  const emitter = new AuditEmitter(options);
  await emitter.init();
  return emitter;
}

/**
 * Emit an audit event
 */
export async function emitEvent(
  emitter: AuditEmitter,
  event: string,
  payload: any,
  level?: EventLevel
): Promise<void> {
  await emitter.emit(event, payload, level);
}

/**
 * Finalize audit
 */
export async function finalizeAudit(emitter: AuditEmitter, finalStatus?: string): Promise<void> {
  await emitter.finalize(finalStatus);
}
