import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ElmLineReader } from "../../packages/obd-core/src/elm/reader.js";
import { parseRecording } from "../../packages/obd-core/src/recording/format.js";
import { ReplayTransport } from "../../packages/obd-core/src/transport/replay.js";
import { RelayBroker } from "./broker.js";

// A new relay connection admits only ATI or ATZ first, so start from the reset this phone already captured:
// 2026-09-24-phone-console.redacted.jsonl lines 3–37; docs/ELM327.md §Init sequence.
const sequence = ["ATZ", "ATE0", "ATL0", "ATS0", "ATH1", "ATSP0", "0100"];
function pathForToday(root: string): string { const date = new Date().toLocaleDateString("en-CA"); const base = `fixtures/recordings/chevrolet-equinox-ev-2024/${date}-relay-smoke`; let n = 0; while (existsSync(resolve(root, `${base}${n === 0 ? "" : `-${String(n)}`}.jsonl`))) n++; return `${base}${n === 0 ? "" : `-${String(n)}`}.jsonl`; }
// The broker is injectable so the failure path can be tested with a fake phone (server.test.ts).
export async function main(broker = new RelayBroker()): Promise<void> {
  const until = Date.now() + 60_000;
  while (!broker.isConnected() && Date.now() < until) await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  if (!broker.isConnected()) { await broker.close(); throw new Error("relay: no authenticated phone after 60 seconds"); }
  const path = pathForToday(broker.root);
  const live: string[] = [];
  try {
    await broker.startRecording(path);
    // A disconnect already ended the recording; its cause, not stopRecording's "no recording active", is the failure.
    try { for (const command of sequence) live.push(Buffer.from((await broker.send(command)).bytes).toString("latin1")); }
    catch (error) { await broker.stopRecording().catch(() => undefined); throw error; }
    await broker.stopRecording();
  } finally { await broker.close(); }
  const raw = live.at(-1) ?? "";
  if (!raw.endsWith(">") || !raw.replace(/\s/g, "").includes("4100")) throw new Error("relay: 0100 did not return prompt-terminated 4100");
  const replay = new ReplayTransport(parseRecording(readFileSync(resolve(broker.root, path), "latin1")));
  const reader = new ElmLineReader(); let replayRaw = "";
  replay.onData((chunk) => { for (const response of reader.push(chunk)) replayRaw += response + ">"; });
  for (const [i, command] of sequence.entries()) {
    replayRaw = "";
    await replay.write(new TextEncoder().encode(command + "\r"));
    await new Promise<void>((resolveWait) => { queueMicrotask(resolveWait); });
    if (replayRaw !== live[i]) throw new Error(`relay: replay response to ${command} differs from live response`);
  }
  process.stdout.write(`0100 response (prompt terminated): ${JSON.stringify(raw)}\nReplay matched live response.\n${path}\nuv run tools/spike/redact_vin.py ${path}\n`);
}
const entry = process.argv.at(1); if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) await main();
