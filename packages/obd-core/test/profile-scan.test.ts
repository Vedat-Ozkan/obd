import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Elm327Session, ElmSessionError } from "../src/elm/session.js";
import { latin1Decode, parseRecording } from "../src/recording/format.js";
import { ReplayTransport } from "../src/transport/replay.js";
import type { Transport } from "../src/transport/types.js";
import { equinoxEv2024Profile, type VehicleProfile } from "../src/vehicles/profile.js";
import { scanMode22Profile } from "../src/vehicles/scan.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const equinox = "fixtures/recordings/chevrolet-equinox-ev-2024/";
const load = (path: string) => parseRecording(readFileSync(`${root}${path}`, "latin1"));
const tail = (path: string) => {
  const lines = load(path);
  const start = lines.findIndex((line) => line.dir === "tx" && line.data === "ATSP7\r");
  if (start < 0) throw new Error("ATSP7 tail missing");
  return lines.slice(start);
};

describe("Equinox profile scan", () => {
  for (const file of ["2026-09-22-spike.redacted.jsonl", "2026-09-22-spike-2.redacted.jsonl"]) {
    it(`replays ${file} through the public scanner`, async () => {
      const session = new Elm327Session(new ReplayTransport(tail(`${equinox}${file}`)));
      try {
        const outcomes = await scanMode22Profile(session, equinoxEv2024Profile);
        expect(outcomes.map(({ target, did, response }) => [target, did, response.kind])).toEqual([
          ["1D", "33E5", "nodata"],
          ["CB", "27C6", "data"],
          ["CB", "2AF5", "data"],
          ["CB", "2B43", "data"],
        ]);
        for (const { target, did, response } of outcomes) {
          expect(response.dropped).toEqual([]);
          if (target === "1D") {
            expect(response.frames).toEqual([]);
          } else {
            expect(response.frames).toHaveLength(1);
            const frame = response.frames[0];
            expect(frame.header).toBe("18DAF1CB");
            expect(Array.from(frame.data.slice(0, 3))).toEqual([0x62, Number.parseInt(did.slice(0, 2), 16), Number.parseInt(did.slice(2), 16)]);
          }
        }
        expect(outcomes[2].response.frames).toHaveLength(1);
        expect(outcomes[2].response.frames[0].data.length).toBe(13);
      } finally {
        await session.close();
      }
    });
  }

  it("aborts on a synthetic setup error before any header or request", async () => {
    const writes: string[] = [];
    const replay = new ReplayTransport(load("fixtures/synthetic/profile-setup-failure.jsonl"));
    const transport: Transport = {
      write: (bytes) => { writes.push(latin1Decode(bytes)); return replay.write(bytes); },
      onData: (cb) => replay.onData(cb),
      close: () => replay.close(),
    };
    const session = new Elm327Session(transport);
    try {
      await expect(scanMode22Profile(session, equinoxEv2024Profile)).rejects.toMatchObject({
        kind: "init", command: "ATCP 18",
      } satisfies Partial<ElmSessionError>);
      expect(writes).toEqual(["ATSP7\r", "ATCP 18\r"]);
    } finally {
      await session.close();
    }
  });

  it.each([
    { protocol: "6", mode22: [{ target: "CB", dids: ["27C6"] }] },
    { protocol: "7", mode22: [{ target: "cb", dids: ["27C6"] }] },
    { protocol: "7", mode22: [{ target: "C", dids: ["27C6"] }] },
    { protocol: "7", mode22: [{ target: "CB", dids: [] }] },
    { protocol: "7", mode22: [{ target: "CB", dids: [""] }] },
    { protocol: "7", mode22: [{ target: "CB", dids: ["27c6"] }] },
    { protocol: "7", mode22: [{ target: "CB", dids: ["27C6", "27C6"] }] },
    { protocol: "7", mode22: [{ target: "CB", dids: ["27C6"] }, { target: "CB", dids: ["2AF5"] }] },
  ] as VehicleProfile[])("rejects invalid profile before writing: %j", async (profile) => {
    const writes: string[] = [];
    const transport: Transport = {
      write: (bytes) => { writes.push(latin1Decode(bytes)); return Promise.resolve(); },
      onData: () => () => undefined,
      close: () => Promise.resolve(),
    };
    const session = new Elm327Session(transport);
    try {
      await expect(scanMode22Profile(session, profile)).rejects.toThrow();
      expect(writes).toEqual([]);
    } finally {
      await session.close();
    }
  });
});
