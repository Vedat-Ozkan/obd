import { main as smoke } from "../relay/hil-smoke.js";
import { RelayBroker } from "../relay/broker.js";

const [mode, root] = process.argv.slice(2);
if (root === undefined || (mode !== "smoke" && mode !== "guard" && mode !== "hold04")) throw new Error("usage: relay-probe.ts smoke|guard|hold04 <scratch root>");
const broker = new RelayBroker({ root });
const until = Date.now() + 300_000;
while (!broker.isConnected() && Date.now() < until) await new Promise((wait) => setTimeout(wait, 100));
if (!broker.isConnected()) throw new Error("relay-probe: no phone connected");
console.log("PHONE CONNECTED");

const attempt = async (command: string): Promise<void> => {
  try { await broker.send(command); console.log(`${command}: SENT`); }
  catch (error) { console.log(`${command}: REFUSED ${error instanceof Error ? error.message : String(error)}`); }
};

if (mode === "smoke") await smoke(broker);
else if (mode === "guard") { await attempt("2E F190 00"); await attempt("04"); await broker.close(); }
else { void attempt("04"); await new Promise(() => undefined); }
