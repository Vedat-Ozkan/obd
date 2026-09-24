import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { afterReply, allowedCommand, beforeWrite, UNKNOWN_STATE, type HeaderState, type ReplyKind } from "../src/elm/guard.js";
import { parseRecording } from "../src/recording/format.js";

// docs/specs/X-2026-09-23-write-safety.md Verification G1-G7; rules and sources: docs/ELM327.md §Write safety.

const hex = (b: number) => b.toString(16).padStart(2, "0").toUpperCase();

describe("allowedCommand", () => {
  it("G1. refuses empty, whitespace-only and control-character input", () => {
    for (const cmd of ["", " ", "   ", "\t", "\r", "0100\r", "\x00"]) expect(allowedCommand(cmd), JSON.stringify(cmd)).toBeUndefined();
  });

  it("G2. allows exactly the read services, in every spelling of a refused one", () => {
    // T0.7 Decisions 4: Mode 06 is refused (docs/specs/T0.7-codes-report.md).
    const allowed = new Set(["01", "02", "03", "07", "09", "0A", "22"]);
    // Spec amendment 2026-09-23 (review round 2): each service has one request length, so try 1-3 bytes.
    for (let b = 0; b <= 0xff; b++) {
      const any = [2, 4, 6].some((n) => allowedCommand(hex(b).padEnd(n, "0")) !== undefined);
      expect(any, hex(b)).toBe(allowed.has(hex(b)));
    }
    const refused = "04 05 08 10 11 14 19 23 24 27 28 29 2A 2C 2E 2F 31 34 35 36 37 38 3D 3E 83 84 85 86 87".split(" ");
    for (const s of refused) {
      const nibbles = ` ${`${s}00`.toLowerCase().replace(/(.)(?=.)/g, "$1 ")} `;
      for (const cmd of [s, `${s} 00`, `${s.toLowerCase()} 00`, nibbles]) expect(allowedCommand(cmd), cmd).toBeUndefined();
    }
  });

  it("G3. refuses malformed requests and the response-count digit", () => {
    for (const cmd of ["010", "0100 1", "01G0", "0x0100", "01-00", "AT"]) expect(allowedCommand(cmd), cmd).toBeUndefined();
  });

  it("G4. refuses CAF, PP, resets other than ATZ, monitoring and ST commands", () => {
    const cmds = [
      "ATCAF0", "atcaf0", "AT CAF 0", " a t c a f 0 ", "ATCAF1", "ATPP 24 SV FF", "ATPP 24 ON", "ATPP FF ON", "ATPPS",
      "ATD", "ATWS", "ATMA", "ATCSM0", "ATMR 01", "ATAL", "ATCEA 01", "ATBRD 23", "STDI",
    ];
    for (const cmd of cmds) expect(allowedCommand(cmd), cmd).toBeUndefined();
  });

  it("G5. refuses header, priority and flow-control values off the list", () => {
    const cmds = [
      "ATSH 7DF", "ATSH 7E0", "ATSH 000", "ATSH DB33F1", "ATSH DA1DF2", "ATSH DA1D", "ATCP 00", "ATCP 1F",
      "ATFCSD 0104", "ATFCSD 30", "ATFCSM 0", "ATFCSM 2", "ATFCSH 7E0", "ATFCSH 18DB33F1", "ATCRA 7E8",
    ];
    for (const cmd of cmds) expect(allowedCommand(cmd), cmd).toBeUndefined();
  });

  it("G6. allows every tx in the tracked spikes and the synthetic fixtures", () => {
    const files = [
      "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl",
      "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike-2.redacted.jsonl",
      "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-24-phone-console.redacted.jsonl",
      "fixtures/synthetic/session-branches.jsonl",
      "fixtures/synthetic/standard-decoding.jsonl",
      "fixtures/synthetic/elm-framing.jsonl",
    ];
    let checked = 0;
    for (const rel of files) {
      const text = readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "latin1");
      for (const line of parseRecording(text)) {
        if (line.dir !== "tx") continue;
        expect(allowedCommand(line.data.slice(0, -1)), `${rel} ${line.data}`).toBeDefined();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(allowedCommand("at sh da1df1")).toBe("ATSHDA1DF1");
    expect(allowedCommand("22 2b43")).toBe("222B43");
    expect(allowedCommand("0100 ")).toBe("0100");
  });

  // Spec amendment 2026-09-23 (review round 2): a busy ELM discards the first character it receives
  // (datasheet rev J p.9, p.48), so no request may have room to become a refused service when shifted by one.
  it("G8. allows each read service only at its exact request length", () => {
    const lengths: Record<string, number> = { "01": 4, "02": 6, "03": 2, "07": 2, "09": 4, "0A": 2, "22": 6 };
    const shifted = ["014FFFFFF1", "011011", "02EF190ABCD1", "0100FF", "2233E5FF", "00100", "0 0100", "01 00 00", "22 33"];
    for (const cmd of shifted) expect(allowedCommand(cmd), cmd).toBeUndefined();
    for (const [s, n] of Object.entries(lengths)) {
      for (let len = 2; len <= 12; len += 2) {
        const cmd = s.padEnd(len, "0");
        expect(allowedCommand(cmd) !== undefined, cmd).toBe(len === n);
      }
    }
    // T0.7 Decisions 4-5: Mode 06 is refused; Mode 02 only as 02 <pid> 00 (frame 0, the only frame recorded).
    for (const cmd of ["06", "0600", "06 00", "020201", "0202FF", "02 02 01"]) expect(allowedCommand(cmd), cmd).toBeUndefined();
    expect(allowedCommand("020200")).toBe("020200");
    expect(allowedCommand("02 46 00")).toBe("024600");
  });
});

describe("sequence rule (beforeWrite / afterReply)", () => {
  const HEADER_CLASS = ["ATSHDA1DF1", "ATCP18", "ATFCSH18DA1DF1", "ATFCSM1"];
  /** beforeWrite then afterReply, failing if the rule blocks the command. */
  function step(state: HeaderState, norm: string, kind: ReplyKind = "ok"): HeaderState {
    const inFlight = beforeWrite(state, norm);
    expect(inFlight, norm).toBeDefined();
    return afterReply(inFlight ?? state, norm, kind);
  }
  // The ATZ banner ("ELM327 v1.5") parses as kind "data".
  const reset = afterReply(UNKNOWN_STATE, "ATZ", "data");

  it("G7. a fresh session assumes a header may be set and no protocol is confirmed", () => {
    expect(beforeWrite(UNKNOWN_STATE, "ATSP6")).toBeUndefined();
    expect(beforeWrite(UNKNOWN_STATE, "ATSHDA1DF1")).toBeUndefined();
    expect(beforeWrite(UNKNOWN_STATE, "ATSP7")).toBeDefined();
    expect(beforeWrite(reset, "ATSP6")).toBeDefined();
  });

  it("G7. header commands only after ATSP7 OK; after a header only ATSP7 until ATZ", () => {
    const sp7 = step(reset, "ATSP7");
    for (const cmd of HEADER_CLASS) expect(beforeWrite(sp7, cmd), cmd).toBeDefined();
    const withHeader = step(sp7, "ATSHDA1DF1");
    expect(beforeWrite(withHeader, "ATSP0")).toBeUndefined();
    expect(beforeWrite(withHeader, "ATSP6")).toBeUndefined();
    expect(beforeWrite(withHeader, "ATSP7")).toBeDefined();
    // Only ATZ clears the header flag; a later ATSP7 OK does not.
    expect(beforeWrite(step(withHeader, "ATSP7"), "ATSP6")).toBeUndefined();
    expect(beforeWrite(step(withHeader, "ATZ", "data"), "ATSP6")).toBeDefined();
  });

  it("G7. an ATZ answered with an error (STOPPED, ?) resets nothing", () => {
    // Spec amendment 2026-09-23: a busy ELM discards the ATZ and prints STOPPED (datasheet rev J p.9, p.48).
    const withHeader = step(step(reset, "ATSP7"), "ATSHDA1DF1");
    const refused = step(withHeader, "ATZ", "error");
    expect(refused).toEqual(withHeader);
    expect(beforeWrite(refused, "ATSP6")).toBeUndefined();
  });

  it("G7. an ATSP clears the confirmed protocol before the write", () => {
    // Review round 1 finding 2: a failed ATSP0 after ATSP7 OK must not leave protocol 7 confirmed.
    const sp7 = step(reset, "ATSP7");
    const inFlight = beforeWrite(sp7, "ATSP0");
    expect(inFlight).toBeDefined();
    expect(beforeWrite(afterReply(inFlight ?? sp7, "ATSP0", "error"), "ATSHDA1DF1")).toBeUndefined();
  });

  it("G7. an ATSP that is not answered OK confirms nothing", () => {
    expect(beforeWrite(step(reset, "ATSP7", "error"), "ATSHDA1DF1")).toBeUndefined();
    const sp0 = step(reset, "ATSP0");
    for (const cmd of HEADER_CLASS) expect(beforeWrite(sp0, cmd), cmd).toBeUndefined();
  });

  it("G7. the receive filter and FC data are allowed in every state", () => {
    const withHeader = step(step(reset, "ATSP7"), "ATSHDA1DF1");
    for (const state of [UNKNOWN_STATE, reset, step(reset, "ATSP0"), withHeader]) {
      for (const cmd of ["ATCRA18DAF11D", "ATFCSD300000"]) expect(beforeWrite(state, cmd), cmd).toEqual(state);
    }
  });
});
