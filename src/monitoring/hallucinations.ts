import * as fs from "fs";
import * as path from "path";

export interface HallucinationEvent {
  timestamp: string;
  command: string;
  reason: string;
  agent_id?: string;
  plan_id?: string;
}

export class HallucinationTracker {
  private events: HallucinationEvent[] = [];
  private logPath: string;

  constructor(logPath?: string) {
    this.logPath = logPath ?? path.join(process.cwd(), ".smartergpt/logs/hallucinations.jsonl");
  }

  public record(event: Omit<HallucinationEvent, "timestamp">): void {
    const fullEvent: HallucinationEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    this.events.push(fullEvent);
    this.persistEvent(fullEvent);
  }

  public getRecentEvents(count = 10): HallucinationEvent[] {
    return this.events.slice(-count);
  }

  public getEventCount(): number {
    return this.events.length;
  }

  private persistEvent(event: HallucinationEvent): void {
    const logDir = path.dirname(this.logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(this.logPath, JSON.stringify(event) + "\n");
  }
}
