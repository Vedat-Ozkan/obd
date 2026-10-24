// @ts-expect-error Node built-ins are outside the mobile compilation target.
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { latin1Decode, latin1Encode, parseRecording } from "obd-core/recording";
import type { Transport } from "obd-core/transport";
import { runModuleDtcCapture } from "../src/moduleDtcCapture.js";
import { RecordingBuffer } from "../src/recording.js";
import { finishRun, type RunFile, type SaveTargets } from "../src/runFiles.js";
const write = writeFileSync as (path: string, content: string) => void;

const targets = ["17", "28", "40", "45", "CB"];
class ScriptedElm implements Transport {
  readonly writes: string[] = [];
  private subscribers = new Set<(bytes: Uint8Array) => void>();
  private target = "17";
  constructor(private readonly failAt?: string, private readonly failure = "18DAF14010\r>") {}
  write(bytes: Uint8Array): Promise<void> {
    const command = latin1Decode(bytes).slice(0, -1);
    this.writes.push(command);
    if (command.startsWith("ATSH DA")) this.target = command.slice(7, 9);
    if (this.failAt === this.target && command === "19 02 FF") {
      queueMicrotask(() => { this.emit(this.failure); });
      return Promise.resolve();
    }
    const answer = command === "ATZ" || command === "ATI" ? "ELM327 v1.5\r\r>"
      : command === "0100" ? "18DAF11706410080080013\r>"
      : command === "ATDPN" ? "A0\r\r>" : command === "ATRV" ? "12.7V\r\r>"
      : command === "19 02 FF" ? this.target === "17" ? "18DAF117075902FF12345608\r>"
        : this.target === "28" ? "NO DATA\r\r>" : this.target === "40" ? "18DAF140037F1911\r>"
          : `18DAF1${this.target}035902FF\r>` : "OK\r\r>";
    queueMicrotask(() => { this.emit(answer); });
    return Promise.resolve();
  }
  onData(callback: (bytes: Uint8Array) => void): () => void { this.subscribers.add(callback); return () => this.subscribers.delete(callback); }
  close(): Promise<void> { this.subscribers.clear(); return Promise.resolve(); }
  private emit(answer: string): void { for (const callback of this.subscribers) callback(latin1Encode(answer)); }
}
function recording(): RecordingBuffer {
  const buffer = new RecordingBuffer();
  buffer.start({ car: "chevrolet-equinox-ev-2024", dongle: "veepeak-obdcheck-ble", note: "SYNTHETIC Stage A desk capture", writeChar: "fff2", notifyChar: "fff1", mtu: 247 });
  return buffer;
}
describe("public module DTC capture with synthetic Mode 19 replies", () => {
  it("records all five modules, raw outcomes, and a replayable artifact", async () => {
    const elm = new ScriptedElm(); const progress: string[] = [];
    const result = await runModuleDtcCapture(elm, recording(), (line) => progress.push(line));
    expect(result.status).toBe("complete");
    expect(elm.writes.filter((command) => command === "19 02 FF")).toHaveLength(5);
    for (const target of targets) {
      expect(elm.writes).toContain(`ATSH DA${target}F1`);
      expect(elm.writes).toContain(`ATCRA 18DAF1${target}`);
      expect(elm.writes).toContain(`ATFCSH 18DA${target}F1`);
    }
    expect(result.outcomes).toEqual([
      "Module 17: 19 02 FF → raw reply received",
      "Module 28: 19 02 FF → NO DATA",
      "Module 40: 19 02 FF → negative reply",
      "Module 45: 19 02 FF → raw reply received",
      "Module CB: 19 02 FF → raw reply received",
    ]);
    expect(elm.writes).not.toContain("1003");
    expect(progress.join(" ")).toMatch(/17.*raw reply.*28.*NO DATA.*40.*negative/s);
    const lines = parseRecording(result.jsonl);
    expect(lines.filter((line) => line.dir === "rx").map((line) => line.data).join(" ")).toContain("18DAF117075902FF12345608\r>");
    write("/tmp/t2.16-stage-a.synthetic.jsonl", result.jsonl);
  });
  it("keeps a partial artifact and does not write a later module after truncation", async () => {
    const elm = new ScriptedElm("40");
    const result = await runModuleDtcCapture(elm, recording(), () => undefined);
    expect(result.status).toBe("partial");
    expect(result.stopReason).toMatch(/module 40: malformed or partial reply/);
    expect(elm.writes).not.toContain("ATSH DA45F1");
    expect(result.jsonl).toContain("18DAF14010");
    expect(result.outcomes).toEqual([
      "Module 17: 19 02 FF → raw reply received",
      "Module 28: 19 02 FF → NO DATA",
      "Module 40: 19 02 FF → malformed or partial reply",
    ]);
    const kept: RunFile[] = [];
    const targets: SaveTargets = {
      keep(file) { kept.push(file); return "partial.synthetic.jsonl"; },
      folder() { return Promise.reject(new Error("synthetic folder unavailable")); },
      forgetFolder() {},
      share() { return Promise.reject(new Error("synthetic share unavailable")); },
    };
    const saved = await finishRun("recording", result.jsonl, { vehicle: "2024 Chevrolet Equinox EV", date: "2026-10-04", result: { sent: 3, total: 5, stoppedEarly: result.stopReason } }, targets);
    expect(kept[0].content).toBe(result.jsonl);
    expect(saved.status).toContain("A copy stays in app storage (captures/partial.synthetic.jsonl)");
    write("/tmp/t2.16-stage-a.partial.synthetic.jsonl", kept[0].content);
    write("/tmp/t2.16-stage-a.partial.summary.txt", `${result.status}: ${result.stopReason ?? "unknown reason"}\n${result.outcomes.join("\n")}\n${saved.status}\n`);
  }, 10_000);
  it.each(["BUFFER FULL", "STOPPED"])("preserves %s as the module error and stops before the next target", async (error) => {
    const elm = new ScriptedElm("40", `${error}\r\r>`);
    const progress: string[] = [];
    const result = await runModuleDtcCapture(elm, recording(), (line) => progress.push(line));
    expect(result.status).toBe("partial");
    expect(result.stopReason).toContain(error);
    expect(result.outcomes.at(-1)).toContain(error);
    expect(progress.join(" ")).toContain(error);
    expect(result.jsonl).toContain(error);
    expect(elm.writes).not.toContain("ATSH DA45F1");
  });
});
