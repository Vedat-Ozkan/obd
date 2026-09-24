import { ElmSessionError, Elm327Session } from "../elm/session.js";
import type { RecordingLine } from "../recording/format.js";
import { ReplayTransport } from "../transport/replay.js";
import { buildCodesReport, type CodesExchange, type CodesReport } from "./codes.js";

/** Replays every tx through Elm327Session.send (retry false, timeoutMs 500; a timeout adds no exchange) and builds the report.
 *  Shared by `pnpm codes-report` and the app (T0.9); moved from scripts/codes-report.ts. */
export async function codesReportFromRecording(lines: readonly RecordingLine[]): Promise<CodesReport> {
  const session = new Elm327Session(new ReplayTransport(lines));
  const exchanges: CodesExchange[] = [];
  for (const line of lines) {
    if (line.dir !== "tx") continue;
    const command = line.data.endsWith("\r") ? line.data.slice(0, -1) : line.data;
    try {
      exchanges.push({ command, response: await session.send(command, { retry: false, timeoutMs: 500 }) });
    } catch (e) {
      if (!(e instanceof ElmSessionError && e.kind === "timeout")) throw e;
    }
  }
  await session.close();
  return buildCodesReport(exchanges);
}

export { renderCodesReport } from "./render.js";
export type { CodesReport } from "./codes.js";
