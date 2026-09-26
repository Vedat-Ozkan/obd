// T2.4 Decision 20 isolated failure modes: docs/specs/T2.4-charge-logger.md Decisions, item 20.
// The run record outlives any one console, because Android can recreate the activity mid-run while JS keeps running.
// R1 second-console: a console mounted after the one that started the run does not see it (no status, controls enabled).
// R2 cleanup-while-running: a console's unmount cleanup closes the link or destroys the shared manager during a run.
// R3 end-destroy: the end of the run destroys the manager while a console is mounted, or leaks it when none is.
// R4 stop-any-console: Disconnect in a console other than the starter does not reach the run's stop flag.
// R5 final-line (Decision 21): a console mounted after the run ended, with no console mounted at its end, does not see the final line.
import { describe, expect, it } from "vitest";
import { createChargeRunRecord } from "../src/chargeRun.js";

class FakeManager { destroyed = 0; destroy() { this.destroyed++; } }
const connection = { deviceId: "veepeak" };
const listener = () => {
  const seen: [string, boolean][] = [];
  return { seen, on: (status: string, running: boolean) => { seen.push([status, running]); } };
};

describe("charge run record failure modes", () => {
  it("R1: a second console sees the running log and its status", () => {
    const record = createChargeRunRecord<typeof connection, FakeManager>();
    const unmountA = record.mount(listener().on);
    record.begin(connection, new FakeManager(), "Starting the charge log…");
    unmountA();
    const b = listener();
    record.mount(b.on);
    expect(b.seen).toEqual([["Starting the charge log…", true]]);
    record.status("Cycle 12");
    expect(b.seen.at(-1)).toEqual(["Cycle 12", true]);
    expect(record.current()?.status).toBe("Cycle 12");
  });

  it("R2: unmount cleanup does not own the link or the manager while a run is active", () => {
    const record = createChargeRunRecord<typeof connection, FakeManager>();
    const manager = new FakeManager();
    const unmountIdle = record.mount(listener().on);
    expect(unmountIdle()).toBe(true);
    const unmountA = record.mount(listener().on);
    record.begin(connection, manager, "Starting the charge log…");
    expect(unmountA()).toBe(false);
    expect(manager.destroyed).toBe(0);
  });

  it("R3: the end of the run destroys the manager only when no console is mounted", () => {
    const record = createChargeRunRecord<typeof connection, FakeManager>();
    const kept = new FakeManager();
    const b = listener();
    const unmountB = record.mount(b.on);
    record.begin(connection, kept, "Starting the charge log…");
    record.end("Charge log stopped: complete.");
    expect(kept.destroyed).toBe(0);
    expect(b.seen.at(-1)).toEqual(["Charge log stopped: complete.", false]);
    expect(record.current()).toBeUndefined();
    expect(unmountB()).toBe(true);

    const orphaned = new FakeManager();
    const unmountA = record.mount(listener().on);
    record.begin(connection, orphaned, "Starting the charge log…");
    unmountA();
    record.end("Charge log stopped: partial.");
    expect(orphaned.destroyed).toBe(1);
  });

  it("R4: Disconnect in any console requests the stop", () => {
    const record = createChargeRunRecord<typeof connection, FakeManager>();
    const unmountA = record.mount(listener().on);
    const run = record.begin(connection, new FakeManager(), "Starting the charge log…");
    unmountA();
    const b = listener();
    record.mount(b.on);
    record.requestStop("Stopping the charge log after the current command…");
    expect(run.stop).toBe(true);
    expect(b.seen.at(-1)).toEqual(["Stopping the charge log after the current command…", true]);
  });

  it("R5: a console mounted after the end sees the final line", () => {
    const record = createChargeRunRecord<typeof connection, FakeManager>();
    const unmountA = record.mount(listener().on);
    record.begin(connection, new FakeManager(), "Starting the charge log…");
    unmountA();
    record.end("Charge log stopped: complete.");
    const b = listener();
    record.mount(b.on);
    expect(b.seen).toEqual([["Charge log stopped: complete.", false]]);
  });
});
