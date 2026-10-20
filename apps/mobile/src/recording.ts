import { latin1Decode, type RecordingLine } from "obd-core/recording";

export interface RecordingMeta {
  car: "chevrolet-equinox-ev-2024";
  dongle: "veepeak-obdcheck-ble";
  note: string;
  powerState?: "ready" | "unknown";
  writeChar: string;
  notifyChar: string;
  mtu: number;
}

export class RecordingBuffer {
  private origin = 0;
  private started = false;
  private recordingLines: RecordingLine[] = [];

  constructor(private readonly nowSeconds: () => number = () => Date.now() / 1000) {}

  start(meta: RecordingMeta): void {
    this.origin = this.nowSeconds();
    this.started = true;
    this.recordingLines = [{ t: 0, dir: "meta", ...meta }];
  }

  tx(data: string): number {
    this.requireStarted();
    const t = this.timestamp();
    this.recordingLines.push({ t, dir: "tx", data });
    return t;
  }

  rx(bytes: Uint8Array): void {
    this.requireStarted();
    this.recordingLines.push({ t: this.timestamp(), dir: "rx", data: latin1Decode(bytes) });
  }

  meta(note: string | Readonly<Record<string, string>>): number {
    this.requireStarted();
    if (typeof note !== "string" && ("t" in note || "dir" in note)) throw new Error("A meta record cannot set t or dir");
    const t = this.timestamp();
    this.recordingLines.push({ t, dir: "meta", ...(typeof note === "string" ? { note } : note) });
    return t;
  }

  elapsed(): number {
    return this.timestamp();
  }

  lines(): readonly RecordingLine[] {
    return [...this.recordingLines];
  }

  toJsonl(): string {
    return this.recordingLines.map(pythonJsonLine).join("\n") + (this.recordingLines.length > 0 ? "\n" : "");
  }

  drain(): string {
    const text = this.toJsonl();
    this.recordingLines = [];
    return text;
  }

  private requireStarted(): void {
    if (!this.started) throw new Error("Recording has not started");
  }

  private timestamp(): number {
    return Math.max(0, Math.round((this.nowSeconds() - this.origin) * 1000) / 1000);
  }
}

function pythonJsonLine(line: RecordingLine): string {
  const body = Object.entries(line).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(", ");
  return `{${body}}`.replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
