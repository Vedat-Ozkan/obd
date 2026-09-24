/* eslint-disable @typescript-eslint/require-await */
// T0.9 Stage A: docs/specs/T0.9-codes-report-flow.md Verification "Stage A". The real runner and console run over a fake
// that answers from a tracked redacted recording; the app's markdown must equal the heading plus that recording's block
// in the committed T0.7 artifact.
// Vitest runs in Node; Expo's mobile typecheck intentionally omits Node typings.
// @ts-expect-error Node built-in types are not part of the mobile compilation target.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { latin1Decode, latin1Encode, parseRecording, type RecordingLine } from "obd-core/recording";
import type { Transport } from "obd-core/transport";
import { PROMPT_WAIT_MS, runCapture } from "../src/capture.js";
import { CODES_SCAN_COMMANDS, codesReportMarkdown, codesScanStop } from "../src/codesScan.js";
import { ConsoleSession } from "../src/console.js";
import { RecordingBuffer } from "../src/recording.js";

const readText = readFileSync as (path: URL, encoding: "utf8" | "latin1") => string;
const repoFile = (rel: string) => new URL(`../../../${rel}`, import.meta.url);
const SPIKE = "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl";
const PHONE = "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-24-phone-console.redacted.jsonl";
const ARTIFACT = readText(repoFile("packages/obd-core/test/codes-reports.md"), "utf8");
const load = (rel: string) => parseRecording(readText(repoFile(rel), "latin1"));
const meta = { car: "chevrolet-equinox-ev-2024" as const, dongle: "veepeak-obdcheck-ble" as const, note: "Ready", writeChar: "fff1", notifyChar: "fff2", mtu: 23 };
const VEHICLE = "2024 Chevrolet Equinox EV";
const DATE = "2026-09-25";

/** Text after "<!-- <path> -->\n" up to the next "<!-- ", without the one joining "\n". */
function artifactBlock(path: string): string {
  const marker = `<!-- ${path} -->\n`;
  const start = ARTIFACT.indexOf(marker);
  if (start < 0) throw new Error(`no block for ${path}`);
  const from = start + marker.length;
  const next = ARTIFACT.indexOf("<!-- ", from);
  return next < 0 ? ARTIFACT.slice(from) : ARTIFACT.slice(from, next - 1);
}

/** Answers each command with the rx lines after its first tx in the recording (NO DATA when absent). Flags writes made while a '>' is outstanding. */
class RecordingAnswerTransport implements Transport {
  readonly writes: string[] = [];
  readonly violations: string[] = [];
  onWrite?: (command: string) => void;
  private outstanding = false;
  private callbacks = new Set<(bytes: Uint8Array) => void>();
  constructor(private readonly lines: readonly RecordingLine[], private readonly overrides: Record<string, string[] | "none" | "throw"> = {}) {}
  async write(bytes: Uint8Array): Promise<void> {
    const text = latin1Decode(bytes); const command = text.slice(0, -1);
    if (this.outstanding) this.violations.push(text);
    this.writes.push(text); this.outstanding = true; this.onWrite?.(command);
    const reply = this.overrides[command] ?? this.answer(text);
    if (reply === "throw") throw new Error("gatt write failed");
    if (reply === "none") return;
    void Promise.resolve().then(() => { for (const chunk of reply) this.data(chunk); });
  }
  onData(callback: (bytes: Uint8Array) => void): () => void { this.callbacks.add(callback); return () => { this.callbacks.delete(callback); }; }
  async close(): Promise<void> { /* nothing to release */ }
  data(text: string): void { if (text.includes(">")) this.outstanding = false; this.callbacks.forEach((callback) => { callback(latin1Encode(text)); }); }
  private answer(tx: string): string[] {
    const at = this.lines.findIndex((line) => line.dir === "tx" && line.data === tx);
    if (at < 0) return ["NO DATA\r\r>"];
    const rx: string[] = [];
    for (const line of this.lines.slice(at + 1)) {
      if (line.dir === "tx") break;
      if (line.dir === "rx") rx.push(line.data);
    }
    return rx;
  }
}

function setup(source: string, overrides: Record<string, string[] | "none" | "throw"> = {}, timeoutMs?: number) {
  const recording = new RecordingBuffer(() => 1); recording.start(meta);
  const transport = new RecordingAnswerTransport(load(source), overrides);
  const session = new ConsoleSession(transport, recording, timeoutMs);
  const run = () => runCapture(session, recording, () => undefined, { commands: CODES_SCAN_COMMANDS, stopAfter: codesScanStop });
  return { recording, transport, session, run };
}

afterEach(() => { vi.useRealTimers(); });

describe("codes scan E2E", () => {
  for (const source of [SPIKE, PHONE]) {
    it(`matches the T0.7 artifact block for ${source}`, async () => {
      const { recording, transport, session, run } = setup(source);
      const result = await run();
      session.close();
      expect(result).toEqual({ sent: 19, total: 19 });
      expect(transport.writes).toEqual(CODES_SCAN_COMMANDS.map((command) => `${command}\r`));
      expect(transport.violations).toEqual([]);
      const markdown = await codesReportMarkdown(recording.toJsonl(), { vehicle: VEHICLE, date: DATE, result });
      expect(markdown).toBe(`# Codes report: ${VEHICLE}\n\nScanned ${DATE} with the phone app. Scan complete: 19 of 19 commands sent.\n\n` + artifactBlock(source));
    });
  }
});

describe("codes scan failures", () => {
  it("1: UNABLE TO CONNECT stops the scan and gives no report", async () => {
    const { recording, transport, session, run } = setup(SPIKE, { "0100": ["SEARCHING...\rUNABLE TO CONNECT\r\r>"] });
    const result = await run();
    session.close();
    expect(transport.writes.at(-1)).toBe("0100\r"); expect(transport.writes).toHaveLength(7);
    expect(result.stoppedEarly?.startsWith("UNABLE TO CONNECT")).toBe(true);
    expect(recording.lines().at(-1)).toEqual({ t: 0, dir: "meta", note: expect.stringMatching(/^capture stopped /) as unknown });
    expect(await codesReportMarkdown(recording.toJsonl(), { vehicle: VEHICLE, date: DATE, result })).toBeUndefined();
  });

  it("2: a disconnect mid-scan stops, writes nothing more, and keeps what was answered", async () => {
    const { recording, transport, session, run } = setup(SPIKE, { "0101": "none" });
    transport.onWrite = (command) => { if (command === "0101") void Promise.resolve().then(() => { recording.meta("Disconnected."); session.close(); }); };
    const result = await run();
    expect(result.stoppedEarly).toBe("disconnected");
    expect(transport.writes.at(-1)).toBe("0101\r"); expect(transport.writes).toHaveLength(10);
    const markdown = await codesReportMarkdown(recording.toJsonl(), { vehicle: VEHICLE, date: DATE, result });
    expect(markdown).toContain("Scan stopped early after 10 of 19 commands: disconnected.");
    expect(markdown).toContain("Observed data from 5 modules: 17, 28, 40, 45, CB.");
    expect(markdown?.match(/- Readiness \(PID 01\): not read/g)).toHaveLength(5);
  });

  it("3: a timeout with no '>' stops without writing into a busy ELM", async () => {
    vi.useFakeTimers();
    const { recording, transport, session, run } = setup(SPIKE, { "0120": "none" }, 50);
    const running = run();
    await vi.advanceTimersByTimeAsync(50 + PROMPT_WAIT_MS);
    const result = await running;
    session.close();
    expect(result.stoppedEarly?.startsWith("no '>' within 1000 ms after:")).toBe(true);
    expect(transport.writes.at(-1)).toBe("0120\r"); expect(transport.writes).toHaveLength(8);
    vi.useRealTimers();
    const markdown = await codesReportMarkdown(recording.toJsonl(), { vehicle: VEHICLE, date: DATE, result });
    expect(markdown).toContain("stopped early after 8 of 19");
  });

  it("4: an ATZ answered STOPPED stops before ATSP0", async () => {
    const { recording, transport, session, run } = setup(SPIKE, { ATZ: ["STOPPED\r\r>"] });
    const result = await run();
    session.close();
    expect(transport.writes).toEqual(["ATZ\r"]);
    expect(result.stoppedEarly?.startsWith("ATZ reset not confirmed (error: stopped)")).toBe(true);
    expect(await codesReportMarkdown(recording.toJsonl(), { vehicle: VEHICLE, date: DATE, result })).toBeUndefined();
  });

  it("5: an ATZ that timed out and then got a late '>' stops before ATSP0", async () => {
    vi.useFakeTimers();
    const { transport, session, run } = setup(SPIKE, { ATZ: "none" }, 50);
    transport.onWrite = (command) => { if (command === "ATZ") setTimeout(() => { transport.data("\r\rELM327 v1.5\r\r>"); }, 500); };
    const running = run();
    await vi.advanceTimersByTimeAsync(500);
    const result = await running;
    session.close();
    expect(transport.writes).toEqual(["ATZ\r"]);
    expect(result.stoppedEarly?.startsWith("ATZ reset not confirmed (Timed out")).toBe(true);
  });
});
