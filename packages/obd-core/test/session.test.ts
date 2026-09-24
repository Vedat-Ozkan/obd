import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { replayRecording } from "../scripts/replay.js";
import {
  CAN_ERROR_RETRY_DELAY_MS,
  Elm327Session,
  ElmSessionError,
  RESYNC_MS,
  type ElmResponse,
} from "../src/elm/session.js";
import { latin1Decode, latin1Encode, parseRecording, type RecordingLine } from "../src/recording/format.js";
import { ReplayMismatchError, ReplayTransport } from "../src/transport/replay.js";
import type { Transport } from "../src/transport/types.js";
import { genericProfile, type VehicleProfile } from "../src/vehicles/profile.js";

// Equinox tests read the tracked redacted spike recordings by explicit path (X-2026-09-23-vin-redaction).
function load(rel: string): RecordingLine[] {
  return parseRecording(readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "latin1"));
}
const spike = load("fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl");
const spike2 = load("fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike-2.redacted.jsonl");
const synthetic = load("fixtures/synthetic/session-branches.jsonl");

const ecus = (r: ElmResponse) => r.frames.map((f) => f.ecu);
const hex = (bytes: Iterable<number>) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0").toUpperCase());

async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => {
      throw new Error("expected a rejection");
    },
    (e: unknown) => e,
  );
}

/** init() then send every tx after the first 0100, in file order; responses keyed by command. */
async function runEquinox(rec: RecordingLine[]) {
  // No startsIdle: the session starts in the unknown state, as on a live transport (X-2026-09-24-first-write A2).
  const inner = new ReplayTransport(rec);
  const transport: Transport = {
    write: (bytes) => inner.write(bytes),
    onData: (cb) => inner.onData(cb),
    close: () => inner.close(),
  };
  const session = new Elm327Session(transport);
  const init = await session.init(genericProfile);
  const first0100 = rec.findIndex((l) => l.dir === "tx" && l.data === "0100\r");
  const responses = new Map<string, ElmResponse>();
  for (const line of rec.slice(first0100 + 1)) {
    if (line.dir !== "tx") continue;
    const cmd = line.data.slice(0, -1);
    responses.set(cmd, await session.send(cmd));
  }
  return { init, responses };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Elm327Session on the Equinox spike recordings", () => {
  // spike lines 2-41 / spike-2 lines 2-41 (init), 72-171 (Stage A cases)
  it.each([
    ["spike", spike, "12.7V", ["45", "CB", "40", "28", "17"], ["18DAF117", "18DAF140", "18DAF128", "18DAF1CB"]],
    ["spike-2", spike2, "13.1V", ["45", "40", "17", "28", "CB"], ["18DAF1CB", "18DAF140", "18DAF128", "18DAF117"]],
  ])("%s: init and every following tx replay byte for byte", async (_, rec, voltage, initEcus, incomplete) => {
    const { init, responses } = await runEquinox(rec);
    expect(init).toMatchObject({ protocol: "0", fellBack: false, idBits: 29, voltage });
    expect(init.response0100).toMatchObject({ kind: "data", searching: true, attempts: 1 });
    expect(ecus(init.response0100)).toEqual(initEcus);

    for (const r of responses.values()) expect(r.attempts).toBe(1);

    const vin = responses.get("0902");
    expect(vin?.kind).toBe("data");
    expect(vin && ecus(vin)).toEqual(["17", "28"]);
    for (const f of vin?.frames ?? []) {
      expect(f.data).toHaveLength(20);
      expect(Array.from(f.data.slice(0, 3))).toEqual([0x49, 0x02, 0x01]);
    }
    expect(vin?.frames[0].data).toEqual(vin?.frames[1].data);

    const ecuNames = responses.get("090A");
    expect(ecuNames).toMatchObject({ kind: "error", error: { kind: "buffer-full" } });
    expect(ecuNames && ecus(ecuNames)).toEqual(["45"]);
    expect(ecuNames?.frames[0].data).toHaveLength(23);
    expect(ecuNames?.dropped.map((d) => `${d.reason} ${d.header}`)).toEqual([
      "malformed 18D",
      ...incomplete.map((h) => `incomplete ${h}`),
    ]);

    const dtcs = responses.get("03");
    expect(dtcs?.kind).toBe("data");
    expect(dtcs?.dropped.map((d) => d.reason)).toEqual(["no-first-frame"]);
    expect(dtcs?.frames).toHaveLength(5);

    const permanent = responses.get("0A");
    expect(permanent?.frames.filter((f) => f.negative).map((f) => [f.ecu, f.negative])).toEqual(
      expect.arrayContaining([
        ["17", { service: 0x0a, code: 0x11 }],
        ["CB", { service: 0x0a, code: 0x11 }],
      ]),
    );
    expect(permanent?.frames.filter((f) => f.negative)).toHaveLength(2);

    expect(responses.get("22 2B43")?.frames[0].data).toHaveLength(29);
    expect(responses.get("22 33E5")?.kind).toBe("nodata");
    for (const [cmd, r] of responses) if (cmd.startsWith("AT")) expect(r.kind, cmd).toBe("ok");
  });

  // spike lines 3-5, spike-2 lines 3-4: clone reset garbage (docs/ELM327.md §Clone quirks)
  it.each([
    ["spike", spike],
    ["spike-2", spike2],
  ])("%s: ATZ garbage is dropped from lines and kept in raw", async (_, rec) => {
    const session = new Elm327Session(new ReplayTransport(rec));
    const r = await session.send("ATZ");
    expect(r.lines).toEqual(["ELM327 v1.5"]);
    expect(r.raw).toContain("ü");
  });
});

describe("Elm327Session on fixtures/synthetic/session-branches.jsonl (synthetic)", () => {
  it("covers fallback, 11-bit headers, retry, timeout, resync, CAN ERROR and DATA ERROR", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // ReplayTransport delivers rx right after the write; holding it back lets the recorded late '>' arrive late.
    const inner = new ReplayTransport(synthetic);
    let held: Uint8Array[] | undefined;
    let deliver: (bytes: Uint8Array) => void = () => undefined;
    const transport: Transport = {
      write: (bytes) => inner.write(bytes),
      onData: (cb) => {
        deliver = cb;
        return inner.onData((bytes) => {
          if (held === undefined) cb(bytes);
          else held.push(bytes);
        });
      },
      close: () => inner.close(),
    };
    const write = vi.spyOn(transport, "write");
    const session = new Elm327Session(transport);

    const init = await session.init({ protocol: "6" });
    expect(init).toMatchObject({ fellBack: true, protocol: "0", idBits: 11, voltage: "12.6V" });
    expect(init.response0100.frames.map((f) => f.header)).toEqual(["7E8", "7E9"]);

    const vin = await session.send("0902");
    expect(vin.attempts).toBe(2);
    expect(vin.frames).toHaveLength(1);
    expect(vin.frames[0].header).toBe("7E8");
    expect(vin.frames[0].data).toHaveLength(20);
    expect(latin1Decode(vin.frames[0].data.slice(3))).toBe("1C4SYNTHETICVIN00");

    held = [];
    const timedOut = rejection(session.send("0100", { timeoutMs: 50 }));
    await vi.advanceTimersByTimeAsync(50);
    expect(await timedOut).toMatchObject({ kind: "timeout", command: "0100" });
    const late = held;
    held = undefined;
    expect(late.map((b) => latin1Decode(b))).toEqual(["7E806410080000001\r\r>"]);

    // Spec amendment 2026-09-23 (review round 2): after a timeout, the next write waits for a '>'.
    const writes = write.mock.calls.length;
    const canError = session.send("0101");
    await vi.advanceTimersByTimeAsync(RESYNC_MS - 1);
    expect(write.mock.calls.length).toBe(writes);
    for (const bytes of late) deliver(bytes);
    await vi.advanceTimersByTimeAsync(0);
    expect(write.mock.calls.length).toBe(writes + 1);
    await vi.advanceTimersByTimeAsync(CAN_ERROR_RETRY_DELAY_MS - 1);
    expect(write.mock.calls.length).toBe(writes + 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(write.mock.calls.length).toBe(writes + 2);
    expect(await canError).toMatchObject({ kind: "data", attempts: 2 });

    expect(await session.send("0120")).toMatchObject({
      kind: "error",
      error: { kind: "data-error", line: "<DATA ERROR" },
      attempts: 2,
    });

    const twice = session.send("0140");
    await vi.advanceTimersByTimeAsync(CAN_ERROR_RETRY_DELAY_MS);
    expect(await twice).toMatchObject({ kind: "error", error: { kind: "can-error" }, attempts: 2 });

    expect(await rejection(session.send("0100"))).toBeInstanceOf(ReplayMismatchError);
  });
});

// Inline scripted transports: synthetic. Reply strings are copied from the spike recording or the synthetic fixture.
const initReplies: Record<string, string> = {
  ATZ: "\r\rELM327 v1.5\r\r>",
  ATI: "ELM327 v1.5\r\r>",
  ATE0: "OK\r\r>",
  ATL0: "OK\r\r>",
  ATS0: "OK\r\r>",
  ATH1: "OK\r\r>",
  ATSP0: "OK\r\r>",
  ATDPN: "A0\r\r>",
  ATRV: "12.7V\r\r>",
  "0100": "7E806410080000001\r\r>",
};

class ScriptedTransport implements Transport {
  readonly writes: string[] = [];
  readonly close = vi.fn(() => Promise.resolve());
  private readonly subscribers = new Set<(bytes: Uint8Array) => void>();

  constructor(
    private readonly replies: Record<string, string | undefined>,
    readonly startsIdle: boolean = true,
  ) {}

  write(bytes: Uint8Array): Promise<void> {
    const cmd = latin1Decode(bytes).slice(0, -1);
    this.writes.push(cmd);
    const reply = this.replies[cmd];
    if (reply !== undefined) {
      queueMicrotask(() => {
        this.emit(reply);
      });
    }
    return Promise.resolve();
  }

  emit(text: string): void {
    for (const cb of this.subscribers) cb(latin1Encode(text));
  }

  onData(cb: (bytes: Uint8Array) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }
}

describe("Elm327Session with scripted transports (synthetic)", () => {
  it("1. auto protocol and 0100 UNABLE TO CONNECT rejects init without ATSP0", async () => {
    const transport = new ScriptedTransport({ ...initReplies, "0100": "UNABLE TO CONNECT\r\r>" });
    const err = await rejection(new Elm327Session(transport).init(genericProfile));
    expect(err).toBeInstanceOf(ElmSessionError);
    expect(err).toMatchObject({ kind: "init", command: "0100", response: { kind: "error" } });
    expect(transport.writes.filter((w) => w === "ATSP0")).toHaveLength(1);
    expect(transport.writes.at(-1)).toBe("0100");
  });

  it("2. ? on a required step rejects init", async () => {
    const transport = new ScriptedTransport({ ...initReplies, ATH1: "?\r\r>" });
    expect(await rejection(new Elm327Session(transport).init(genericProfile))).toMatchObject({
      kind: "init",
      command: "ATH1",
    });
    expect(transport.writes.at(-1)).toBe("ATH1");
  });

  it("3. ? on ATI, ATDPN, ATRV is tolerated", async () => {
    const transport = new ScriptedTransport({ ...initReplies, ATI: "?\r\r>", ATDPN: "?\r\r>", ATRV: "?\r\r>" });
    const init = await new Elm327Session(transport).init(genericProfile);
    expect(init).toMatchObject({ protocol: "0", fellBack: false, idBits: 11, voltage: undefined });
  });

  it.each(["STOPPED", "LV RESET"])(
    "4. %s is surfaced without a retry",
    async (reply) => {
      const transport = new ScriptedTransport({ "0100": `${reply}\r\r>` });
      const r = await new Elm327Session(transport).send("0100");
      expect(r.attempts).toBe(1);
      expect(transport.writes).toEqual(["0100"]);
    },
  );

  it("6. unawaited sends are single-flight and resolve in order", async () => {
    const inner = new ReplayTransport(spike);
    let busy = false;
    let overlaps = 0;
    const transport: Transport = {
      write: (bytes) => {
        if (busy) overlaps++;
        busy = true;
        return inner.write(bytes);
      },
      onData: (cb) =>
        inner.onData((bytes) => {
          if (latin1Decode(bytes).includes(">")) busy = false;
          cb(bytes);
        }),
      close: () => inner.close(),
    };
    const session = new Elm327Session(transport);
    await session.init(genericProfile);
    const order: string[] = [];
    const cmds = ["0120", "0140", "0101"];
    const all = cmds.map((cmd) =>
      session.send(cmd).then((r) => {
        order.push(cmd);
        return r;
      }),
    );
    const results = await Promise.all(all);
    expect(order).toEqual(cmds);
    expect(results.map((r) => r.kind)).toEqual(["data", "data", "data"]);
    expect(overlaps).toBe(0);
  });

  it("7. a '>' arriving while idle is discarded", async () => {
    const transport = new ScriptedTransport({ "0100": "7E806410080000001\r\r>" });
    const session = new Elm327Session(transport);
    transport.emit("NO DATA\r\r>");
    const r = await session.send("0100");
    expect(r.kind).toBe("data");
    expect(r.frames.map((f) => f.header)).toEqual(["7E8"]);
  });

  it("8. close rejects in-flight and queued commands and clears every timer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const transport = new ScriptedTransport({});
    const session = new Elm327Session(transport);
    const inFlight = rejection(session.send("0100"));
    const queued = rejection(session.send("0101"));
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.writes).toEqual(["0100"]);
    await session.close();
    expect(await inFlight).toMatchObject({ kind: "closed", command: "0100" });
    expect(await queued).toMatchObject({ kind: "closed", command: "0101" });
    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(await rejection(session.send("0100"))).toMatchObject({ kind: "closed" });
    expect(await rejection(session.init(genericProfile))).toMatchObject({ kind: "closed" });
    expect(transport.writes).toEqual(["0100"]);
    await expect(session.close()).resolves.toBeUndefined();
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  // AGENTS.md hard rule 5; ADR-008; ADR-013
  it("9. the write guard blocks anything off the read-only allowlist before any byte is written", async () => {
    const transport = new ScriptedTransport({ ATZ: "\r\rELM327 v1.5\r\r>", "0104": "NO DATA\r\r>" });
    const session = new Elm327Session(transport);
    const write = vi.spyOn(transport, "write");
    // Spec amendment 2026-09-23: a CR ends a command (docs/ELM327.md §Framing), so any non-printable is blocked.
    // X-2026-09-23-write-safety: empty (a bare CR repeats), CAF, PP, monitoring and non-read services (§Write safety).
    for (const cmd of [
      "04", "2E F1 90 00", "2f", "31 01 00", "0100\r04", "\r04", "01\n00",
      "", " ", "ATCAF0", "at caf 0", "08 01", "11 01", "14 FF FF FF", "10 03", "3E 00", "ATPP 24 SV FF", "ATMA",
      // Spec amendment 2026-09-23 (review round 2): exact request lengths per service.
      "014FFFFFF1", "011011", "02EF190ABCD1", "0100FF", "2233E5FF",
    ]) {
      expect(await rejection(session.send(cmd))).toMatchObject({ kind: "blocked", command: cmd });
    }
    const badProfile = { protocol: "0\r04" } as unknown as VehicleProfile;
    expect(await rejection(session.init(badProfile))).toMatchObject({ kind: "blocked", command: "ATSP0\r04" });
    expect(write).not.toHaveBeenCalled();
    expect(transport.writes).toEqual([]);
    await session.send("ATZ");
    await session.send("0104");
    expect(transport.writes).toEqual(["ATZ", "0104"]);
  });

  // Synthetic: frames copied from fixtures/synthetic/session-branches.jsonl 0902 (FF, 21, 22); FF then 22 is a sequence drop.
  const vinFF = "7E81014490201314334";
  const vinCF1 = "7E82153594E54484554";
  const vinCF2 = "7E822494356494E3030";
  const exchange = (t: number, data: string): RecordingLine[] => [
    { t, dir: "tx", data: "0902\r" },
    { t: t + 0.01, dir: "rx", data: `${data}\r\r>` },
  ];

  it("10. a sequence drop is retried once; a second sequence drop is returned", async () => {
    const good = await new Elm327Session(
      new ReplayTransport([...exchange(0, `${vinFF}\r${vinCF2}`), ...exchange(1, `${vinFF}\r${vinCF1}\r${vinCF2}`)]),
    ).send("0902");
    expect(good).toMatchObject({ kind: "data", attempts: 2, dropped: [] });
    expect(good.frames.map((f) => f.header)).toEqual(["7E8"]);

    const transport = new ReplayTransport([...exchange(0, `${vinFF}\r${vinCF2}`), ...exchange(1, `${vinFF}\r${vinCF2}`)]);
    const write = vi.spyOn(transport, "write");
    const bad = await new Elm327Session(transport).send("0902");
    expect(bad).toMatchObject({ kind: "data", attempts: 2, frames: [] });
    expect(bad.dropped.map((d) => d.reason)).toEqual(["sequence", "sequence"]);
    expect(write).toHaveBeenCalledTimes(2);
  });

  // Spec amendment 2026-09-23 (review round 2): without a '>' the next command is rejected, not written.
  it("11. a rejected transport.write propagates unchanged and nothing is written until a '>' arrives", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const transport = new ScriptedTransport({ "0100": "7E806410080000001\r\r>" });
    const failure = new Error("synthetic write failure");
    const write = vi.spyOn(transport, "write").mockRejectedValueOnce(failure);
    const session = new Elm327Session(transport);
    expect(await rejection(session.send("0101"))).toBe(failure);
    expect(write).toHaveBeenCalledTimes(1);

    const next = rejection(session.send("0100"));
    await vi.advanceTimersByTimeAsync(RESYNC_MS);
    expect(await next).toMatchObject({ kind: "timeout", command: "0100" });
    expect(write).toHaveBeenCalledTimes(1);

    transport.emit(">");
    expect(await session.send("0100")).toMatchObject({ kind: "data", attempts: 1 });
    expect(write).toHaveBeenCalledTimes(2);
  });

  // Round-2 finding 1: init() reads profile.protocol once; a later mutation or getter cannot reach the wire.
  function expectCleanInitWrites(writes: string[]): void {
    expect(writes).toContain("ATSP0");
    for (const w of writes) {
      expect(w).not.toMatch(/[^\x20-\x7E]/);
      expect(w.replace(/ /g, "").slice(0, 2)).not.toBe("04");
    }
  }

  it("12. a protocol mutated after init() is called never reaches the wire", async () => {
    const transport = new ScriptedTransport(initReplies);
    const profile: { protocol: string } = { protocol: "0" };
    const pending = new Elm327Session(transport).init(profile as VehicleProfile);
    profile.protocol = "0\r04"; // before the queued init runs
    expect(await pending).toMatchObject({ protocol: "0", fellBack: false });
    expectCleanInitWrites(transport.writes);
  });

  it("13. a protocol getter that changes after the first read never reaches the wire", async () => {
    const transport = new ScriptedTransport(initReplies);
    let reads = 0;
    const profile = {
      get protocol() {
        return reads++ === 0 ? "0" : "0\r04";
      },
    } as unknown as VehicleProfile;
    expect(await new Elm327Session(transport).init(profile)).toMatchObject({ protocol: "0", fellBack: false });
    expectCleanInitWrites(transport.writes);
  });

  // docs/ELM327.md §Write safety: headers only after ATSP7 OK; after a header, no other protocol until ATZ.
  const headerReplies = { ...initReplies, ATSP6: "OK\r\r>", ATSP7: "OK\r\r>", "ATSH DA1DF1": "OK\r\r>" };

  it("14. header and protocol commands follow the sequence rule", async () => {
    const transport = new ScriptedTransport(headerReplies);
    const session = new Elm327Session(transport);
    for (const cmd of ["ATSH DA1DF1", "ATSP6"]) {
      expect(await rejection(session.send(cmd))).toMatchObject({ kind: "blocked", command: cmd });
    }
    expect(transport.writes).toEqual([]);
    for (const cmd of ["ATZ", "ATSP7", "ATSH DA1DF1"]) await session.send(cmd);
    expect(await rejection(session.send("ATSP6"))).toMatchObject({ kind: "blocked", command: "ATSP6" });
    expect(transport.writes).toEqual(["ATZ", "ATSP7", "ATSH DA1DF1"]);
    await session.init(genericProfile);
    expect(await session.send("ATSP6")).toMatchObject({ kind: "ok" });
    expect(transport.writes.at(-1)).toBe("ATSP6");
  });

  it("15. an ATSP not answered OK or an ATZ that times out leaves the state restrictive", async () => {
    const refused = new ScriptedTransport({ ...headerReplies, ATSP7: "?\r\r>" });
    const s1 = new Elm327Session(refused);
    await s1.send("ATZ");
    expect(await s1.send("ATSP7")).toMatchObject({ kind: "error", error: { kind: "unknown-command" } });
    expect(await rejection(s1.send("ATSH DA1DF1"))).toMatchObject({ kind: "blocked", command: "ATSH DA1DF1" });
    expect(refused.writes).toEqual(["ATZ", "ATSP7"]);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const silentReset = new ScriptedTransport({ ...headerReplies, ATZ: undefined });
    const s2 = new Elm327Session(silentReset);
    // The first ATZ is answered by hand so a header is really set before the second ATZ times out.
    const firstReset = s2.send("ATZ");
    await vi.advanceTimersByTimeAsync(0);
    silentReset.emit(initReplies.ATZ);
    await firstReset;
    for (const cmd of ["ATSP7", "ATSH DA1DF1"]) await s2.send(cmd);
    const timedOut = rejection(s2.send("ATZ", { timeoutMs: 50 }));
    await vi.advanceTimersByTimeAsync(50);
    expect(await timedOut).toMatchObject({ kind: "timeout", command: "ATZ" });
    expect(await rejection(s2.send("ATSP6"))).toMatchObject({ kind: "blocked", command: "ATSP6" });
    expect(silentReset.writes).toEqual(["ATZ", "ATSP7", "ATSH DA1DF1", "ATZ"]);
  });

  // Spec amendment 2026-09-23: a busy ELM answers ATZ with STOPPED and does not reset (datasheet rev J p.9, p.48).
  it.each(["STOPPED", "?"])("16. an ATZ answered %s leaves the header flag set", async (reply) => {
    const replies: Record<string, string> = { ...headerReplies };
    const transport = new ScriptedTransport(replies);
    const session = new Elm327Session(transport);
    for (const cmd of ["ATZ", "ATSP7", "ATSH DA1DF1"]) await session.send(cmd);
    replies.ATZ = `${reply}\r\r>`;
    expect(await session.send("ATZ")).toMatchObject({ kind: "error" });
    expect(await rejection(session.send("ATSP6"))).toMatchObject({ kind: "blocked", command: "ATSP6" });
    expect(transport.writes).toEqual(["ATZ", "ATSP7", "ATSH DA1DF1", "ATZ"]);
  });

  // Spec amendment 2026-09-23 (review round 2): a busy ELM discards the first character it receives
  // (datasheet rev J p.9, p.48), so after a timeout nothing, not even init()'s ATZ, is written before a '>'.
  it("17. after a timeout with no '>', send() and init() write nothing until a late '>' arrives", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const transport = new ScriptedTransport(initReplies);
    const session = new Elm327Session(transport);
    const timedOut = rejection(session.send("0101", { timeoutMs: 50 }));
    await vi.advanceTimersByTimeAsync(50);
    expect(await timedOut).toMatchObject({ kind: "timeout", command: "0101" });

    const next = rejection(session.send("0100"));
    await vi.advanceTimersByTimeAsync(RESYNC_MS);
    expect(await next).toMatchObject({ kind: "timeout", command: "0100" });
    const reinit = rejection(session.init(genericProfile));
    await vi.advanceTimersByTimeAsync(RESYNC_MS);
    expect(await reinit).toMatchObject({ kind: "timeout", command: "ATZ" });
    expect(transport.writes).toEqual(["0101"]);

    // Reply copied from fixtures/synthetic/session-branches.jsonl (0101).
    transport.emit("7E806410100040000\r\r>");
    expect(await session.init(genericProfile)).toMatchObject({ protocol: "0" });
    expect(transport.writes.slice(0, 2)).toEqual(["0101", "ATZ"]);
  });
});

// X-2026-09-24-first-write F1-F7: a fresh session (no startsIdle) writes only ATZ or ATI until one is answered
// cleanly; STOPPED starts that state again (docs/ELM327.md §Write safety, DS p.9, p.48). Synthetic scripted replies.
describe("Elm327Session unknown state (synthetic)", () => {
  const stopped = "STOPPED\r\r>";
  const reply0101 = "7E806410100040000\r\r>"; // fixtures/synthetic/session-branches.jsonl (0101)

  it("F1. a fresh session refuses everything but ATZ and ATI before any byte is written", async () => {
    const transport = new ScriptedTransport({ ...initReplies, "0131": "NO DATA\r\r>" }, false);
    const session = new Elm327Session(transport);
    for (const cmd of ["0131", "22 33E5", "ATE0", "ATSP7"]) {
      expect(await rejection(session.send(cmd))).toMatchObject({ kind: "blocked", command: cmd });
    }
    expect(transport.writes).toEqual([]);
    await session.send("ATZ");
    await session.send("0131");
    expect(transport.writes).toEqual(["ATZ", "0131"]);
  });

  it("F1. a transport with no startsIdle member (BLE, relay) starts in the unknown state", async () => {
    const inner = new ScriptedTransport({ ...initReplies, "0131": "NO DATA\r\r>" });
    const transport: Transport = {
      write: (bytes) => inner.write(bytes),
      onData: (cb) => inner.onData(cb),
      close: () => inner.close(),
    };
    const session = new Elm327Session(transport);
    expect(await rejection(session.send("0131"))).toMatchObject({ kind: "blocked", command: "0131" });
    expect(inner.writes).toEqual([]);
  });

  it("F2. the rule is checked in queue order, not when send() is called", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const transport = new ScriptedTransport({ ...initReplies, "0100": stopped, "0101": reply0101 }, false);
    const session = new Elm327Session(transport);
    await session.send("ATZ");
    const first = session.send("0100");
    const next = rejection(session.send("0101"));
    await vi.advanceTimersByTimeAsync(RESYNC_MS);
    expect(await first).toMatchObject({ kind: "error", error: { kind: "stopped" } });
    expect(await next).toMatchObject({ kind: "blocked", command: "0101" });
    expect(transport.writes).toEqual(["ATZ", "0100"]);
  });

  it.each(["ATZ", "ATI"])("F3. %s answered ? does not end the unknown state", async (cmd) => {
    const transport = new ScriptedTransport({ [cmd]: "?\r\r>", "0100": initReplies["0100"] }, false);
    const session = new Elm327Session(transport);
    expect(await session.send(cmd)).toMatchObject({ kind: "error", error: { kind: "unknown-command" } });
    expect(await rejection(session.send("0100"))).toMatchObject({ kind: "blocked", command: "0100" });
    expect(transport.writes).toEqual([cmd]);
  });

  it("F4. a late '>' after a timed-out ATZ does not end the unknown state", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const transport = new ScriptedTransport({ ...initReplies, ATZ: undefined }, false);
    const session = new Elm327Session(transport);
    const timedOut = rejection(session.send("ATZ", { timeoutMs: 50 }));
    await vi.advanceTimersByTimeAsync(50);
    expect(await timedOut).toMatchObject({ kind: "timeout", command: "ATZ" });
    transport.emit(initReplies.ATZ);
    expect(await rejection(session.send("ATE0"))).toMatchObject({ kind: "blocked", command: "ATE0" });
    expect(transport.writes).toEqual(["ATZ"]);
    await session.send("ATI");
    expect(await session.send("ATE0")).toMatchObject({ kind: "ok" });
    expect(transport.writes).toEqual(["ATZ", "ATI", "ATE0"]);
  });

  it("F5. STOPPED in a known session starts the unknown state again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const transport = new ScriptedTransport({ ...initReplies, "0100": stopped, "0101": reply0101 }, false);
    const session = new Elm327Session(transport);
    await session.send("ATZ");
    expect(await session.send("0100")).toMatchObject({ kind: "error", error: { kind: "stopped" } });
    expect(await rejection(session.send("0101"))).toMatchObject({ kind: "blocked", command: "0101" });
    const ati = session.send("ATI");
    await vi.advanceTimersByTimeAsync(RESYNC_MS);
    expect(await ati).toMatchObject({ lines: ["ELM327 v1.5"] });
    expect(transport.writes).toEqual(["ATZ", "0100", "ATI"]);
  });

  it("F6. after STOPPED the next write waits up to RESYNC_MS for the second '>' and discards it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const transport = new ScriptedTransport({ ...initReplies, "0100": stopped }, false);
    const session = new Elm327Session(transport);
    await session.send("ATZ");
    await session.send("0100");
    const ati = session.send("ATI");
    await vi.advanceTimersByTimeAsync(RESYNC_MS - 1);
    expect(transport.writes).toEqual(["ATZ", "0100"]);
    transport.emit("?\r\r>");
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.writes).toEqual(["ATZ", "0100", "ATI"]);
    expect(await ati).toMatchObject({ lines: ["ELM327 v1.5"] });

    await session.send("0100");
    const noStray = session.send("ATI");
    await vi.advanceTimersByTimeAsync(RESYNC_MS - 1);
    expect(transport.writes).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.writes).toEqual(["ATZ", "0100", "ATI", "0100", "ATI"]);
    expect(await noStray).toMatchObject({ lines: ["ELM327 v1.5"] });
  });

  it("F7. init() stops on an ATZ answered STOPPED; a second init() drains the late reply first", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const replies: Record<string, string> = { ...initReplies, ATZ: stopped };
    const transport = new ScriptedTransport(replies, false);
    const session = new Elm327Session(transport);
    const first = rejection(session.init(genericProfile));
    await vi.advanceTimersByTimeAsync(RESYNC_MS);
    expect(await first).toMatchObject({ kind: "init", command: "ATZ", response: { kind: "error" } });
    expect(transport.writes).toEqual(["ATZ"]);

    replies.ATZ = initReplies.ATZ;
    const second = session.init(genericProfile);
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.writes).toEqual(["ATZ"]);
    transport.emit("?\r\r>");
    await vi.advanceTimersByTimeAsync(0);
    expect(await second).toMatchObject({ protocol: "0" });
    expect(transport.writes.slice(0, 4)).toEqual(["ATZ", "ATZ", "ATI", "ATE0"]);
  });
});

describe("replayRecording", () => {
  it("prints the spike recording with the VIN redacted", async () => {
    const out = await replayRecording(spike);
    expect(out).toContain("L72 0902 -> data");
    expect(out).toContain("  18DAF117 49 02 <18 bytes redacted>");
    expect(out).toContain("L84 090A -> error buffer-full");
    expect(out).toContain("  dropped no-first-frame 18DAF1CB2300000000000000");
    expect(out.some((l) => l.endsWith("negative service=0A code=11"))).toBe(true);
    expect(out.at(-1)).toMatch(/^summary: .*timeout 0;/);

    // The VIN bytes as the session sees them, never as a literal here.
    const { responses } = await runEquinox(spike);
    const vinBytes = hex(responses.get("0902")?.frames[0].data.slice(3) ?? []);
    expect(vinBytes).toHaveLength(17);
    const joined = out.join("\n");
    expect(joined).not.toContain(vinBytes.join(" "));
    expect(joined).not.toContain(vinBytes.join(""));
  });

  // Spec amendment 2026-09-23: 22 4193 carries the VIN (ADR-017: 62 41 93, then the VIN four times from index 3).
  // Synthetic: the VIN is the fixture's obviously fake 1C4SYNTHETICVIN00, framed here as 29-bit ISO-TP from ECU 17.
  const syntheticVin = Array.from(latin1Encode("1C4SYNTHETICVIN00"));
  const packed = (bytes: number[]) => hex(bytes).join("");
  /** ISO-TP lines (FF + CFs) for a payload longer than 7 bytes, headers on. */
  function isotpLines(header: string, payload: number[]): string[] {
    const frames = [`${header}${packed([0x10, payload.length, ...payload.slice(0, 6)])}`];
    for (let i = 6, seq = 1; i < payload.length; i += 7, seq = (seq + 1) & 0x0f) {
      frames.push(`${header}${packed([0x20 | seq, ...payload.slice(i, i + 7)])}`);
    }
    return frames;
  }
  function expectNoVin(out: string[]): void {
    const joined = out.join("\n");
    // No 4-byte run of the VIN, in any form the replay could print it.
    for (let i = 0; i + 4 <= syntheticVin.length; i++) {
      const run = syntheticVin.slice(i, i + 4);
      expect(joined).not.toContain(hex(run).join(" "));
      expect(joined).not.toContain(packed(run));
      expect(joined).not.toContain(latin1Decode(Uint8Array.from(run)));
    }
  }

  it("redacts synthetic 22 4193 replies, complete and cut short", async () => {
    const vin = syntheticVin;
    const payload = [0x62, 0x41, 0x93, ...vin, ...vin, ...vin, ...vin];
    const frames = isotpLines("18DAF117", payload);
    const rec: RecordingLine[] = [
      { t: 0, dir: "tx", data: "22 4193\r" },
      { t: 0.01, dir: "rx", data: `${frames.join("\r")}\r\r>` },
      { t: 0.02, dir: "tx", data: "22 4193\r" },
      { t: 0.03, dir: "rx", data: `${frames.slice(0, 3).join("\r")}\r\r>` },
    ];
    const out = await replayRecording(rec);
    expect(out).toContain(`  18DAF117 62 41 93 <${String(payload.length - 3)} bytes redacted>`);
    expect(out).toContain("  dropped incomplete 18DAF117 <redacted>");
    expectNoVin(out);
  });

  // Spec amendment 2026-09-23 (review finding 4): a VIN reply cut short leaves consecutive frames that the next
  // response reports as no-first-frame drops. Synthetic VIN; 0100 reply from fixtures/synthetic/session-branches.jsonl.
  it.each([
    ["0902", "7E8", [0x49, 0x02, 0x01, ...syntheticVin]],
    ["22 4193", "18DAF117", [0x62, 0x41, 0x93, ...syntheticVin, ...syntheticVin]],
  ])("redacts leftover %s frames that land in the next response", async (cmd, header, payload) => {
    const frames = isotpLines(header, payload);
    const rec: RecordingLine[] = [
      { t: 0, dir: "tx", data: `${cmd}\r` },
      { t: 0.01, dir: "rx", data: `${frames[0]}\r\r>` },
      { t: 0.02, dir: "tx", data: "0100\r" },
      { t: 0.03, dir: "rx", data: `${frames.slice(1).join("\r")}\r7E806410080000001\r\r>` },
    ];
    const out = await replayRecording(rec);
    expect(out).toContain("L3 0100 -> data");
    expect(out.filter((l) => l === `  dropped no-first-frame ${header} <redacted>`)).toHaveLength(frames.length - 1);
    expect(out).toContain("  7E8 41 00 80 00 00 01");
    expectNoVin(out);
  });

  // The synthetic fixture's late '>' replays as an immediate reply (ReplayTransport ignores t), so the
  // timeout is inline. Spec amendment 2026-09-23 (review round 2): the command after it is not written.
  it("prints a timeout for an unanswered command and for the command after it (synthetic)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const rec: RecordingLine[] = [
      { t: 0, dir: "tx", data: "0100\r" },
      { t: 0.5, dir: "meta", note: "timeout waiting for '>' after 0100" },
      { t: 1.6, dir: "tx", data: "0101\r" },
    ];
    const pending = replayRecording(rec);
    await vi.advanceTimersByTimeAsync(500 + RESYNC_MS);
    const out = await pending;
    expect(out.slice(0, 2)).toEqual(["L1 0100 -> timeout", "L3 0101 -> timeout"]);
    expect(out.at(-1)).toMatch(/timeout 2;/);
  });
});
