import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main as smoke } from "../relay/hil-smoke.js";
import { RelayBroker } from "../relay/broker.js";

const [mode, root] = process.argv.slice(2);
if (root === undefined || (mode !== "smoke" && mode !== "guard" && mode !== "hold04")) throw new Error("usage: relay-probe.ts smoke|guard|hold04 <scratch root>");
writeFileSync(join(root, "probe.pid"), String(process.pid));
const broker = new RelayBroker({ root });
const until = Date.now() + 900_000;
while (!broker.isConnected() && Date.now() < until) await new Promise((wait) => setTimeout(wait, 100));
if (!broker.isConnected()) throw new Error("relay-probe: no phone connected");
console.log("PHONE CONNECTED");

const attempt = async (command: string): Promise<void> => {
  try { await broker.send(command); console.log(`${command}: SENT`); }
  catch (error) { console.log(`${command}: REFUSED ${error instanceof Error ? error.message : String(error)}`); }
};

const untilGo = async (): Promise<void> => { while (!existsSync(join(root, "go"))) await new Promise((wait) => setTimeout(wait, 200)); };

if (mode === "smoke") await smoke(broker).catch((error: unknown) => { console.log(`hil:smoke: REFUSED ${error instanceof Error ? error.message : String(error)}`); });
else if (mode === "guard") { await untilGo(); await attempt("ATI"); await attempt("2E F190 00"); await attempt("04"); await broker.close(); }
else { await untilGo(); await attempt("ATI"); void attempt("04"); await new Promise(() => undefined); }
