import { describe, expect, it } from "vitest";
import { createChargeRunRecord } from "../src/chargeRun.js";

const connection = { deviceId: "veepeak" };
const listener = () => {
  const seen: [string, boolean][] = [];
  return { seen, on: (status: string, running: boolean) => { seen.push([status, running]); } };
};

describe("charge run record failure modes", () => {
  it("R1: a second console sees the running log and its status", () => {
    const record = createChargeRunRecord<typeof connection>();
    const unmountA = record.mount(listener().on);
    record.begin(connection, "Starting the charge log…");
    unmountA();
    const b = listener();
    record.mount(b.on);
    expect(b.seen).toEqual([["Starting the charge log…", true]]);
    record.status("Cycle 12");
    expect(b.seen.at(-1)).toEqual(["Cycle 12", true]);
    expect(record.current()?.status).toBe("Cycle 12");
  });

  it("R3: the end of the run tells the mounted console and clears the record", () => {
    const record = createChargeRunRecord<typeof connection>();
    const b = listener();
    const unmountB = record.mount(b.on);
    record.begin(connection, "Starting the charge log…");
    record.end("Charge log stopped: complete.");
    expect(b.seen.at(-1)).toEqual(["Charge log stopped: complete.", false]);
    expect(record.current()).toBeUndefined();
    unmountB();
  });

  it("R4: Disconnect in any console requests the stop", () => {
    const record = createChargeRunRecord<typeof connection>();
    const unmountA = record.mount(listener().on);
    const run = record.begin(connection, "Starting the charge log…");
    unmountA();
    const b = listener();
    record.mount(b.on);
    record.requestStop("Stopping the charge log after the current command…");
    expect(run.stop).toBe(true);
    expect(b.seen.at(-1)).toEqual(["Stopping the charge log after the current command…", true]);
  });

  it("R5: a console mounted after the end sees the final line", () => {
    const record = createChargeRunRecord<typeof connection>();
    const unmountA = record.mount(listener().on);
    record.begin(connection, "Starting the charge log…");
    unmountA();
    record.end("Charge log stopped: complete.");
    const b = listener();
    record.mount(b.on);
    expect(b.seen).toEqual([["Charge log stopped: complete.", false]]);
  });
});
