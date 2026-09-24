import { parseElmResponse } from "obd-core/elm";
import type { ConsoleSession } from "./console.js";
import type { RecordingBuffer } from "./recording.js";

/** Fixed sequence; every entry is already in normalized form for normalizeReadOnlyCommand. Sources: docs/specs/T0.8d-one-button-capture.md §Sources. */
export const CAPTURE_COMMANDS: readonly string[] = ["ATZ", "ATE0", "ATL0", "ATS0", "ATH1", "ATSP0", "0100", "020000", "020200", "03"];

/** Policy value, mirrors obd-core RESYNC_MS (packages/obd-core/src/elm/session.ts:72): how long to wait for a late '>' after a timeout or write failure. */
export const PROMPT_WAIT_MS = 1000;

export interface CaptureProgress {
  step: number;
  total: number;
  command: string;
  /** Undefined while the command is in flight. After it: "data" | "ok" | "nodata" | "error: <ElmErrorKind>", or the thrown error's message. */
  outcome?: string;
  /** The complete response text (without '>') when one arrived. */
  response?: string;
}

export interface CaptureResult {
  sent: number;
  total: number;
  /** Set when the run ended before the last command, e.g. "disconnected" or "no '>' within 1000 ms after: <message>". */
  stoppedEarly?: string;
}

export interface CaptureOptions {
  /** Default CAPTURE_COMMANDS. */
  commands?: readonly string[];
  /** Called after each step that produced an outcome and left the ELM idle (a reply with '>', or a late '>' after a
   *  timeout or failed write). A returned string stops the run with that reason. Default: never stops. */
  stopAfter?: (command: string, outcome: string) => string | undefined;
}

export async function runCapture(session: ConsoleSession, recording: RecordingBuffer, onProgress: (progress: CaptureProgress) => void, options: CaptureOptions = {}): Promise<CaptureResult> {
  const { commands = CAPTURE_COMMANDS, stopAfter = () => undefined } = options;
  const total = commands.length;
  recording.meta(`capture start: ${commands.join(" ")}`);
  let sent = 0;
  let stoppedEarly: string | undefined;
  let step = 0;
  // A function, not the getter inline: TypeScript would keep the narrowing from the loop-top check across awaits.
  const closed = (): boolean => session.closed;
  for (const command of commands) {
    if (closed()) { stoppedEarly = "disconnected"; break; }
    // A refused send() would still count as sent: the check must come before the call (docs/specs/X-2026-09-24-first-write.md D5).
    if (session.stateUnknown && command !== "ATZ" && command !== "ATI") { stoppedEarly = "ELM state unknown; send ATZ or ATI first"; break; }
    step++;
    onProgress({ step, total, command });
    try {
      // On an open, non-stale session send() records the tx synchronously before its first await.
      const reply = session.send(command);
      sent++;
      const response = await reply;
      const status = parseElmResponse(response, command).status;
      const outcome = status.kind === "error" ? `error: ${status.error.kind}` : status.kind;
      onProgress({ step, total, command, outcome, response });
      stoppedEarly = stopAfter(command, outcome);
      if (stoppedEarly !== undefined) break;
    } catch (error) {
      // A closed session was frozen by teardown: record nothing more.
      if (closed()) { stoppedEarly = "disconnected"; break; }
      const message = error instanceof Error ? error.message : String(error);
      onProgress({ step, total, command, outcome: message });
      // Error replies came with '>' and are safe to follow; a timeout or failed write is not until the ELM prompts again.
      if (await session.waitForPrompt(PROMPT_WAIT_MS)) {
        stoppedEarly = stopAfter(command, message);
        if (stoppedEarly !== undefined) break;
        continue;
      }
      stoppedEarly = closed() ? "disconnected" : `no '>' within ${String(PROMPT_WAIT_MS)} ms after: ${message}`;
      break;
    }
  }
  if (!closed()) {
    recording.meta(stoppedEarly === undefined ? `capture complete: ${String(sent)} of ${String(total)} sent` : `capture stopped at step ${String(step)} (${commands[step - 1]}): ${stoppedEarly}`);
  }
  return stoppedEarly === undefined ? { sent, total } : { sent, total, stoppedEarly };
}
