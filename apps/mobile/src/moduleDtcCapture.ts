import { Elm327Session, ElmSessionError, type ElmResponse } from "obd-core/elm/session";
import { latin1Decode } from "obd-core/recording";
import type { Transport } from "obd-core/transport";
import { genericProfile } from "obd-core/vehicles";
import type { RecordingBuffer } from "./recording.js";

export interface ModuleDtcCaptureResult {
  jsonl: string;
  status: "complete" | "partial";
  outcomes: string[];
  stopReason?: string;
}

const TARGETS = ["17", "28", "40", "45", "CB"] as const; // docs/ELM327.md §Per-car notes; ADR-023 §5.
const REQUEST = "19 02 FF"; // docs/ELM327.md §J1979 conventions, T2.16 raw capture.

/** One owner-private, read-only capture. The caller starts the dedicated buffer and owns the BLE link. */
export async function runModuleDtcCapture(transport: Transport, recording: RecordingBuffer, onProgress: (message: string) => void): Promise<ModuleDtcCaptureResult> {
  const callbacks = new Set<(bytes: Uint8Array) => void>();
  let open = true;
  const unsubscribe = transport.onData((bytes) => {
    if (!open) return;
    recording.rx(bytes);
    callbacks.forEach((callback) => { callback(bytes); });
  });
  const recorded: Transport = {
    startsIdle: transport.startsIdle,
    async write(bytes) { recording.tx(latin1Decode(bytes)); await transport.write(bytes); },
    onData(callback) { callbacks.add(callback); return () => { callbacks.delete(callback); }; },
    async close() { open = false; unsubscribe(); callbacks.clear(); await transport.close(); },
  };
  const session = new Elm327Session(recorded);
  let stopReason: string | undefined;
  const outcomes: string[] = [];
  let target = "initialization";
  const setup = async (command: string): Promise<void> => {
    const response = await session.send(command, { retry: false });
    if (response.kind !== "ok") throw new ElmSessionError("init", command, response);
  };
  try {
    onProgress("Initializing ELM327 for module codes");
    await session.init(genericProfile);
    await setup("ATSP7");
    await setup("ATCP 18");
    for (const [index, module] of TARGETS.entries()) {
      target = module;
      onProgress(`Module ${module}: setting header; request ${REQUEST}`);
      await setup(`ATSH DA${module}F1`);
      await setup(`ATCRA 18DAF1${module}`);
      await setup(`ATFCSH 18DA${module}F1`);
      if (index === 0) { await setup("ATFCSD 300000"); await setup("ATFCSM 1"); }
      const response = await session.send(REQUEST, { retry: false });
      const outcome = classify(response);
      recording.meta({ module, request: REQUEST, outcome });
      const detail = `Module ${module}: ${REQUEST} → ${outcome}`;
      outcomes.push(detail);
      onProgress(detail);
      if (outcome === "malformed or partial reply" || response.kind === "error") throw new Error(outcome);
    }
  } catch (error) {
    const detail = error instanceof ElmSessionError && error.response?.kind === "error"
      ? `${error.message}: ${error.response.error.line}` : error instanceof Error ? error.message : String(error);
    stopReason = `module ${target}: ${detail}`;
    onProgress(`Module codes partial: ${stopReason}`);
  } finally {
    await session.close();
  }
  recording.meta(stopReason === undefined ? "module codes capture complete" : `module codes capture partial: ${stopReason}`);
  return stopReason === undefined ? { jsonl: recording.toJsonl(), status: "complete", outcomes } : { jsonl: recording.toJsonl(), status: "partial", stopReason, outcomes };
}

function classify(response: ElmResponse): string {
  if (response.kind === "nodata") return "NO DATA";
  if (response.kind === "error") return response.error.line;
  if (response.kind !== "data" || response.dropped.length > 0 || response.frames.length !== 1) return "malformed or partial reply";
  const bytes = response.frames[0].data;
  if (bytes[0] === 0x59 && bytes[1] === 0x02 && bytes.length >= 3 && (bytes.length - 3) % 4 === 0) return "raw reply received";
  if (bytes[0] === 0x7f && bytes[1] === 0x19 && bytes.length === 3) return "negative reply";
  return "malformed or partial reply";
}
