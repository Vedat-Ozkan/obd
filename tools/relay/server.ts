import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RelayBroker } from "./broker.js";

export function createRelayServer(broker = new RelayBroker()): { server: McpServer; broker: RelayBroker } {
  const server = new McpServer({ name: "obd-relay", version: "0.1.0" });
  server.registerTool("send_command", { inputSchema: { cmd: z.string() } }, async ({ cmd }) => {
    try {
      const result = await broker.send(cmd);
      const raw = Buffer.from(result.bytes).toString("latin1");
      if (!raw.endsWith(">")) throw new Error("relay: response missing prompt");
      const value = { lines: raw.slice(0, -1).split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean), ms: result.ms };
      return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
    } catch (error) { return toolError(error); }
  });
  server.registerTool("start_recording", { inputSchema: { path: z.string() } }, async ({ path }) => {
    try { const value = await broker.startRecording(path); return { content: [{ type: "text" as const, text: value.path }], structuredContent: value }; } catch (error) { return toolError(error); }
  });
  server.registerTool("stop_recording", {}, async () => {
    try { const value = await broker.stopRecording(); return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value }; } catch (error) { return toolError(error); }
  });
  server.registerTool("list_signals", { inputSchema: { vehicle: z.string() } }, ({ vehicle }) => {
    if (vehicle !== "chevrolet-equinox-ev-2024") return toolError(new Error("relay: unknown vehicle"));
    const value = { vehicle: "chevrolet-equinox-ev-2024", status: "not-defined-until-T2.1", signals: [] as [] };
    return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
  });
  return { server, broker };
}
function toolError(error: unknown) { const text = error instanceof Error ? error.message : "relay: failure"; return { isError: true, content: [{ type: "text" as const, text }] }; }

async function main(): Promise<void> { const { server } = createRelayServer(); await server.connect(new StdioServerTransport()); }
const entry = process.argv.at(1);
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) void main();
