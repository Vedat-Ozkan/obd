import { parseElmResponse } from "obd-core/elm";
import type { ConsoleSession } from "./console.js";
import type { RecordingBuffer } from "./recording.js";

export const CAPTURE_COMMANDS: readonly string[] = ["ATZ", "ATE0", "ATL0", "ATS0", "ATH1", "ATSP0", "0100", "020000", "020200", "03"];

export const PROMPT_WAIT_MS = 1000;

export interface CaptureProgress {
  step: number;
  total: number;
  command: string;
  outcome?: string;
  response?: string;
}

export interface CaptureResult {
  sent: number;
  total: number;
  stoppedEarly?: string;
}

export interface CaptureOptions {
  commands?: readonly string[];
  stopAfter?: (command: string, outcome: string) => string | undefined;
}

export async function runCapture(session: ConsoleSession, recording: RecordingBuffer, onProgress: (progress: CaptureProgress) => void, options: CaptureOptions = {}): Promise<CaptureResult> {
  const { commands = CAPTURE_COMMANDS, stopAfter = () => undefined } = options;
  const total = commands.length;
  recording.meta(`capture start: ${commands.join(" ")}`);
  let sent = 0;
  let stoppedEarly: string | undefined;
  let step = 0;
  const closed = (): boolean => session.closed;
  for (const command of commands) {
    if (closed()) { stoppedEarly = "disconnected"; break; }
    if (session.stateUnknown && command !== "ATZ" && command !== "ATI") { stoppedEarly = "ELM state unknown; send ATZ or ATI first"; break; }
    step++;
    onProgress({ step, total, command });
    try {
      const reply = session.send(command);
      sent++;
      const response = await reply;
      const status = parseElmResponse(response, command).status;
      const outcome = status.kind === "error" ? `error: ${status.error.kind}` : status.kind;
      onProgress({ step, total, command, outcome, response });
      stoppedEarly = stopAfter(command, outcome);
      if (stoppedEarly !== undefined) break;
    } catch (error) {
      if (closed()) { stoppedEarly = "disconnected"; break; }
      const message = error instanceof Error ? error.message : String(error);
      onProgress({ step, total, command, outcome: message });
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
