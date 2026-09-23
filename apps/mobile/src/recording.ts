import { latin1Decode, type RecordingLine } from "obd-core/recording";

export interface RecordingMeta {
  car: "chevrolet-equinox-ev-2024";
  dongle: "veepeak-obdcheck-ble";
  note: string;
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

  tx(data: string): void {
    this.requireStarted();
    this.recordingLines.push({ t: this.timestamp(), dir: "tx", data });
  }

  rx(bytes: Uint8Array): void {
    this.requireStarted();
    this.recordingLines.push({ t: this.timestamp(), dir: "rx", data: latin1Decode(bytes) });
  }

  meta(note: string): void {
    this.requireStarted();
    this.recordingLines.push({ t: this.timestamp(), dir: "meta", note });
  }

  lines(): readonly RecordingLine[] {
    return [...this.recordingLines];
  }

  toJsonl(): string {
    return this.recordingLines.map((line) => JSON.stringify(line)).join("\n") + (this.recordingLines.length > 0 ? "\n" : "");
  }

  private requireStarted(): void {
    if (!this.started) throw new Error("Recording has not started");
  }

  private timestamp(): number {
    return Math.max(0, Math.round((this.nowSeconds() - this.origin) * 1000) / 1000);
  }
}
