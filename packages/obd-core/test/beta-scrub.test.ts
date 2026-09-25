// T2.9 Stage A: docs/specs/T2.9-beta-data-upload.md Verification "Stage A". E2E runs over the committed
// *.redacted.jsonl recordings, the beta-scrub artifact, parity with tools/spike/redact_vin.py, and one isolated
// case per listed scrubber failure mode (1-15). No test prints a line or value of a gitignored original.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { summarize } from "../scripts/beta-scrub.js";
import { replayRecording } from "../scripts/replay.js";
import { reassemble } from "../src/elm/isotp.js";
import { parseRecording } from "../src/recording/format.js";
import { SCRUB_RULES, ScrubRefusal, scrubRecording, UploadScrubber } from "../src/recording/scrub.js";
import { codesReportFromRecording } from "../src/report/replay.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const repoFile = (rel: string) => join(repoRoot, rel);
const equinox = "fixtures/recordings/chevrolet-equinox-ev-2024/";
const SPIKE = `${equinox}2026-09-22-spike.redacted.jsonl`;
const SPIKE2 = `${equinox}2026-09-22-spike-2.redacted.jsonl`;
const PHONE = `${equinox}2026-09-24-phone-console.redacted.jsonl`;
const TARGETED = `${equinox}2026-09-23-discovery-targeted.redacted.jsonl`;
const PATHS = [SPIKE, SPIKE2, PHONE, TARGETED];

// Synthetic VIN of tools/spike/test_redact_vin.py (T0.4 spec Sources); its serial is characters 12-17.
const VIN = "1C4SYNTHETICVIN00";
const SERIAL = VIN.slice(11);
const MASKED = VIN.slice(0, 11) + "000000";
// 49 CFR 565.15(c) Table VI worked example (docs/ELM327.md §J1979 conventions "VIN check digit").
const TABLE_VI = "1G4AH59H45G118341";

type Row = Record<string, unknown>;

const bytes = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const fromHex = (h: string) => (h.match(/../g) ?? []).map((x) => parseInt(x, 16));
const toHex = (b: readonly number[]) => b.map((x) => x.toString(16).padStart(2, "0").toUpperCase()).join("");
const serialForms = (s: string) => [s, toHex(bytes(s)), toHex(bytes(s)).toLowerCase()];

// Python json.dumps form for flat rows built in this file (test_redact_vin.py writes json.dumps(row)).
function pyLine(row: Row): string {
  const body = Object.entries(row).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ");
  return `{${body}}`.replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
const pythonForm = (line: string) => pyLine(JSON.parse(line) as Row) === line;

/** ISO-TP FF + CFs as the ELM prints them with ATH1 (sep " " for ATS1): port of test_redact_vin.py frames(). */
function frames(header: string, payload: readonly number[], sep = ""): string[] {
  const fmt = (pci: string, data: readonly number[]) =>
    [header, ...(pci.match(/../g) ?? []), ...data.map((b) => toHex([b]))].join(sep);
  const out = [fmt(`1${payload.length.toString(16).toUpperCase().padStart(3, "0")}`, payload.slice(0, 6))];
  for (let i = 6, n = 1; i < payload.length; i += 7, n++) out.push(fmt(`2${(n & 0xf).toString(16).toUpperCase()}`, payload.slice(i, i + 7)));
  return out;
}
const sf = (header: string, payload: readonly number[]) => header + "0" + String(payload.length) + toHex(payload);
const interleave = (...lists: string[][]) => lists[0].flatMap((_, i) => lists.map((l) => l[i]));

function exchange(tx: string, replyFrames: readonly string[], chunk = 11, t = 1): Row[] {
  const reply = replyFrames.join("\r") + "\r\r>";
  const rows: Row[] = [{ t, dir: "tx", data: tx + "\r" }];
  for (let i = 0; i < reply.length; i += chunk) rows.push({ t: t + 0.1 + i / 1000, dir: "rx", data: reply.slice(i, i + chunk) });
  return rows;
}
const START: Row = { t: 0.5, dir: "meta", car: "synthetic" };
const file = (rows: readonly Row[]) => rows.map(pyLine).join("\n") + "\n";
const recording = (tx: string, replyFrames: readonly string[], chunk = 11) => file([START, ...exchange(tx, replyFrames, chunk)]);
const vin0902 = (vin: string) => [0x49, 0x02, 0x01, ...bytes(vin)];

interface Msg { tx: number; cmd: string; header: string; data: number[] }
/** Reassembled messages per tx (obd-core isotp), 1-based tx line. */
function messagesOf(text: string): Msg[] {
  const rows = text.split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Row);
  const out: Msg[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].dir !== "tx") continue;
    let rx = "";
    for (let k = i + 1; k < rows.length && rows[k].dir !== "tx"; k++) if (rows[k].dir === "rx") rx += rows[k].data as string;
    const cmd = (rows[i].data as string).replace(/\r$/, "").replace(/ /g, "").toUpperCase();
    for (const f of reassemble(rx.split(/[\r>]/).filter((l) => l !== "")).frames) out.push({ tx: i + 1, cmd, header: f.header, data: [...f.data] });
  }
  return out;
}
const rxConcat = (text: string) =>
  text.split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Row).filter((r) => r.dir === "rx").map((r) => r.data as string).join("").replace(/[\r ]/g, "");

function leaks(text: string, serial: string): boolean {
  const rx = rxConcat(text);
  return serialForms(serial).some((f) => text.includes(f) || rx.includes(f)) ||
    messagesOf(text).some((m) => String.fromCharCode(...m.data).includes(serial));
}

/** Every isolated case: line count unchanged, output in Python form. */
function scrub(text: string) {
  const r = scrubRecording(text);
  const inLines = text.split("\n").length;
  expect(r.text.split("\n").length).toBe(inLines);
  for (const line of r.text.split("\n").slice(0, -1)) expect(pythonForm(line), line).toBe(true);
  return r;
}

function refusal(text: string): ScrubRefusal {
  try {
    scrubRecording(text);
  } catch (e) {
    if (e instanceof ScrubRefusal) return e;
    throw e;
  }
  throw new Error("accepted");
}
const assertQuiet = (e: Error) => {
  for (const f of [VIN, VIN.slice(0, 11), ...serialForms(SERIAL)]) expect(e.message).not.toContain(f);
};

const block = (replay: readonly string[], line: number) => {
  const at = replay.findIndex((l) => l.startsWith(`L${String(line)} `));
  const end = replay.findIndex((l, i) => i > at && /^(L\d+ |summary:)/.test(l));
  return replay.slice(at + 1, end);
};
const frameLines = (lines: readonly string[]) => lines.filter((l) => /^ {2}[0-9A-F]{3,8} [0-9A-F]{2}( |$)/.test(l));

describe("E2E: committed recordings through scrubRecording", () => {
  for (const rel of PATHS) {
    it(`${rel}: same line count, same replay, same codes report, idempotent`, async () => {
      const text = readFileSync(repoFile(rel), "utf8");
      const { text: out } = scrubRecording(text);
      expect(out.split("\n").length).toBe(text.split("\n").length);
      const heads = (r: string[]) => r.filter((l) => /^(L\d+ |summary:)/.test(l));
      expect(heads(await replayRecording(parseRecording(out)))).toEqual(heads(await replayRecording(parseRecording(text))));
      if (rel !== TARGETED) {
        expect(await codesReportFromRecording(parseRecording(out))).toEqual(await codesReportFromRecording(parseRecording(text)));
      }
      expect(scrubRecording(out).text).toBe(out);
    }, 120_000);
  }

  it("targeted: Mode 09 lines 253/314/340 and the 01A6 reply at line 211 are masked; 4193 count = marker", async () => {
    const text = readFileSync(repoFile(TARGETED), "utf8");
    const { text: out, report } = scrubRecording(text);
    const marker = JSON.parse(text.trimEnd().split("\n").at(-1) ?? "") as { masked_messages: number };
    expect(report.masked["vin-4193"]).toBe(marker.masked_messages);
    expect(report.masked["did-f180-f1ff"]).toBe(0);
    expect(report.masked["mode09-infotype"]).toBeGreaterThan(0);
    const before = await replayRecording(parseRecording(text));
    const after = await replayRecording(parseRecording(out));
    for (const line of [253, 314, 340]) {
      const got = frameLines(block(after, line));
      expect(got.length, `L${String(line)}`).toBeGreaterThan(0);
      for (const f of got) expect(f, `L${String(line)}`).toMatch(/^ {2}\S+ 49 [0-9A-F]{2}( 30)*$/);
    }
    const odo = frameLines(block(before, 211)).filter((l) => / 41 A6/.test(l)).length;
    expect(odo).toBeGreaterThan(0);
    const masked = frameLines(block(after, 211)).filter((l) => / 41 A6( 30){4}$/.test(l)).length;
    expect(masked).toBe(odo);
    expect(report.masked["odometer-01a6"]).toBe(odo);
  }, 120_000);
});

describe("artifact", () => {
  it("summarize(four recordings) equals packages/obd-core/test/beta-scrub-summary.md", () => {
    expect(summarize(PATHS)).toBe(readFileSync(repoFile("packages/obd-core/test/beta-scrub-summary.md"), "utf8"));
  });
});

describe("parity with tools/spike/redact_vin.py (CI; uv required)", () => {
  const cases: [string, string][] = [
    ["29bit-two-ecus", recording("0902", interleave(frames("18DAF117", vin0902(VIN)), frames("18DAF128", vin0902(VIN))))],
    ["11bit-spaced", recording("0902", frames("7E8", vin0902(VIN), " "), 7)],
    ["did-4193", recording("22 4193", frames("18DAF117", [0x62, 0x41, 0x93, ...bytes(VIN.repeat(4)), 0x00, 0x7f, 0xff]))],
  ];
  const dir = mkdtempSync(join(tmpdir(), "t2.9-parity-"));
  for (const [name, text] of cases) {
    it(name, () => {
      const src = join(dir, `${name}.jsonl`);
      writeFileSync(src, text, "utf8");
      execFileSync("uv", ["run", "--no-project", "tools/spike/redact_vin.py", src], { cwd: repoRoot, stdio: "pipe" });
      const py = readFileSync(join(dir, `${name}.redacted.jsonl`), "utf8");
      const ts = scrubRecording(text).text;
      const pyLines = py.split("\n").slice(0, -2);
      const tsLines = ts.split("\n").slice(0, -1);
      expect(tsLines.slice(1)).toEqual(pyLines.slice(1));
      const vinMsgs = (t: string) => messagesOf(t).filter((m) => m.cmd === "0902" || m.cmd === "224193");
      expect(vinMsgs(ts).length).toBeGreaterThan(0);
      expect(vinMsgs(ts)).toEqual(vinMsgs(py));
    }, 60_000);
  }
});

describe("parity, local-only (gitignored originals; counts only)", () => {
  for (const stem of ["2026-09-22-spike", "2026-09-22-spike-2"]) {
    const src = repoFile(`${equinox}${stem}.jsonl`);
    it.skipIf(!existsSync(src))(`${stem}: matches the committed redacted copy outside meta line 1 and the marker`, () => {
      const out = scrubRecording(readFileSync(src, "utf8")).text.split("\n").slice(0, -1);
      const committed = readFileSync(repoFile(`${equinox}${stem}.redacted.jsonl`), "utf8").split("\n").slice(0, -2);
      expect(out.length).toBe(committed.length);
      const differing = out.map((l, i) => (i > 0 && l !== committed[i] ? i + 1 : 0)).filter((n) => n > 0);
      console.log(`local parity ${stem}: ${String(out.length)} lines, ${String(differing.length)} differing`);
      expect(differing).toEqual([]);
    });
  }
  for (const [name, count] of [["2026-09-23-discovery", 1], ["2026-09-23-discovery-targeted", 9]] as const) {
    const src = repoFile(`${equinox}${name}.jsonl`);
    it.skipIf(!existsSync(src))(`${name}: vin-4193 = ${String(count)} and the safety net passes`, () => {
      const { report } = scrubRecording(readFileSync(src, "utf8"));
      console.log(`local parity ${name}: vin-4193 ${String(report.masked["vin-4193"])}`);
      expect(report.masked["vin-4193"]).toBe(count);
    }, 120_000);
  }
});

describe("isolated scrubber failure modes", () => {
  it("1 vin-0902-split: serials split mid-byte across rx lines in two interleaved replies are masked", () => {
    const text = recording("0902", interleave(frames("18DAF117", vin0902(VIN)), frames("18DAF128", vin0902(VIN))));
    const { text: out, report } = scrub(text);
    expect(report.masked["vin-0902"]).toBe(2);
    expect(messagesOf(out).map((m) => [m.header, m.data])).toEqual([
      ["18DAF117", vin0902(MASKED)], ["18DAF128", vin0902(MASKED)],
    ]);
    expect(leaks(out, SERIAL)).toBe(false);
  });

  it("2 vin-4193-windows: all four serial windows are masked", () => {
    const tail = [0x00, 0x7f, 0xff];
    const { text: out, report } = scrub(recording("22 4193", frames("18DAF117", [0x62, 0x41, 0x93, ...bytes(VIN.repeat(4)), ...tail])));
    expect(report.masked["vin-4193"]).toBe(1);
    const data = messagesOf(out)[0].data;
    for (const at of [14, 31, 48, 65]) expect(String.fromCharCode(...data.slice(at, at + 6))).toBe("000000");
    expect(data).toEqual([0x62, 0x41, 0x93, ...bytes(MASKED.repeat(4)), ...tail]);
    expect(leaks(out, SERIAL)).toBe(false);
  });

  it("3 vin-check-digit: a check-digit-valid VIN in an unrelated Mode 22 reply is masked", () => {
    const { text: out, report } = scrub(recording("22 2B10", frames("18DAF117", [0x62, 0x2b, 0x10, ...bytes(TABLE_VI), 0x01])));
    expect(report.masked["vin-check-digit"]).toBe(1);
    expect(messagesOf(out)[0].data).toEqual([0x62, 0x2b, 0x10, ...bytes(TABLE_VI.slice(0, 11) + "000000"), 0x01]);
    expect(leaks(out, TABLE_VI.slice(11))).toBe(false);
  });

  it("4 vin-check-digit-negative: a wrong check digit, or a VIN with I, in a non-rule DID stays unchanged", () => {
    const wrong = TABLE_VI.slice(0, 8) + "5" + TABLE_VI.slice(9);
    const text = file([
      START,
      ...exchange("22 2B10", frames("18DAF117", [0x62, 0x2b, 0x10, ...bytes(wrong)]), 11, 1),
      ...exchange("22 1234", frames("18DAF117", [0x62, 0x12, 0x34, ...bytes(VIN)]), 11, 2),
    ]);
    const { text: out, report } = scrub(text);
    expect(out).toBe(text);
    expect(report.masked["vin-check-digit"]).toBe(0);
  });

  it("5 did-f18x: F18x payloads are masked, single frame and multi-frame", () => {
    const text = file([
      START,
      ...exchange("22 F18C", [sf("18DAF117", [0x62, 0xf1, 0x8c, ...bytes("A1B2")])], 11, 1),
      ...exchange("22 F187", frames("18DAF128", [0x62, 0xf1, 0x87, ...bytes("12345678ABCDEF")]), 11, 2),
    ]);
    const { text: out, report } = scrub(text);
    expect(report.masked["did-f180-f1ff"]).toBe(2);
    expect(messagesOf(out).map((m) => m.data)).toEqual([
      [0x62, 0xf1, 0x8c, ...bytes("0000")], [0x62, 0xf1, 0x87, ...bytes("0".repeat(14))],
    ]);
  });

  it("6 did-f18x-negative: 62 24 14, 62 F1 7F and 7F 22 31 stay unchanged", () => {
    const text = file([
      START,
      ...exchange("22 2414", [sf("18DAF117", [0x62, 0x24, 0x14, 0x12, 0x34])], 11, 1),
      ...exchange("22 F17F", [sf("18DAF117", [0x62, 0xf1, 0x7f, 0x41, 0x42])], 11, 2),
      ...exchange("22 F18C", [sf("18DAF128", [0x7f, 0x22, 0x31])], 11, 3),
    ]);
    const { text: out, report } = scrub(text);
    expect(out).toBe(text);
    expect(report.masked["did-f180-f1ff"]).toBe(0);
  });

  it("7 mode09: unlisted infotypes 06 and 0B are masked; 04, 0A and 00 are not altered", () => {
    const text = file([
      START,
      ...exchange("0906", [sf("18DAF117", [0x49, 0x06, 0x01, 0xaa, 0xbb, 0xcc, 0xdd])], 11, 1),
      ...exchange("090B", frames("18DAF117", [0x49, 0x0b, 0x01, ...fromHex("0102030405060708090A0B0C")]), 11, 2),
      ...exchange("0904", frames("18DAF117", [0x49, 0x04, 0x01, ...bytes("CALID-1234\0\0\0\0\0\0")]), 11, 3),
      ...exchange("090A", frames("18DAF145", [0x49, 0x0a, 0x01, ...bytes("GWM-Gateway\0\0\0\0\0\0\0\0\0")]), 11, 4),
      ...exchange("0900", [sf("18DAF117", [0x49, 0x00, 0x54, 0x40, 0x00, 0x00])], 11, 5),
    ]);
    const { text: out, report } = scrub(text);
    expect(report.masked["mode09-infotype"]).toBe(2);
    const [a, b, ...rest] = messagesOf(out);
    expect(a.data).toEqual([0x49, 0x06, ...Array<number>(5).fill(0x30)]);
    expect(b.data).toEqual([0x49, 0x0b, ...Array<number>(13).fill(0x30)]);
    expect(rest).toEqual(messagesOf(text).slice(2));
    const from = text.split("\n").findIndex((l) => l.includes("0904"));
    expect(out.split("\n").slice(from)).toEqual(text.split("\n").slice(from));
  });

  it("8 odometer: 41 A6 data bytes are masked; 41 31 is not altered", () => {
    const text = file([
      START,
      ...exchange("01A6", [sf("18DAF117", [0x41, 0xa6, 0x00, 0x01, 0xe2, 0x40])], 11, 1),
      ...exchange("0131", [sf("18DAF117", [0x41, 0x31, 0x00, 0x64])], 11, 2),
    ]);
    const { text: out, report } = scrub(text);
    expect(report.masked["odometer-01a6"]).toBe(1);
    expect(messagesOf(out).map((m) => m.data)).toEqual([[0x41, 0xa6, 0x30, 0x30, 0x30, 0x30], [0x41, 0x31, 0x00, 0x64]]);
  });

  it("9 notes: the first meta note is removed; a later app note is kept", () => {
    const text = file([
      { t: 0, dir: "meta", car: "chevrolet-equinox-ev-2024", note: "my neighbour's car, plate ABC 123" },
      { t: 0.001, dir: "meta", note: "capture start: ATZ ATE0 ATL0 ATS0 ATH1 ATSP0 0100 020000 020200 03" },
    ]);
    const { text: out, report } = scrub(text);
    expect(out).toBe(file([
      { t: 0, dir: "meta", car: "chevrolet-equinox-ev-2024", note: "removed before upload" },
      { t: 0.001, dir: "meta", note: "capture start: ATZ ATE0 ATL0 ATS0 ATH1 ATSP0 0100 020000 020200 03" },
    ]));
    expect(report.masked["user-note"]).toBe(1);
    expect(report.masked["date-in-note"]).toBe(0);
  });

  it("10 date-in-note: ISO dates and date-times in later notes become [date]", () => {
    const text = file([
      { t: 0, dir: "meta", note: "typed" },
      { t: 1, dir: "meta", note: "saved 2026-09-24, at 2026-09-24T10:11:12.345Z and 2026-09-24 10:11:12 done" },
    ]);
    const { text: out, report } = scrub(text);
    expect(out.split("\n")[1]).toBe(pyLine({ t: 1, dir: "meta", note: "saved [date], at [date] and [date] done" }));
    expect(report.masked["date-in-note"]).toBe(1);
  });

  it("11 meta-keys: keys outside the allowlist are dropped, including redact_vin.py's marker keys", () => {
    const text = file([
      { t: 0, dir: "meta", car: "c", dongle: "d", vin: VIN, writeChar: "w", notifyChar: "n", mtu: 247, source: "x.jsonl" },
      { t: 1, dir: "meta", redacted: "vin-serial", source: "2026-09-24-x.jsonl", source_sha256: "0".repeat(64), script: "s", script_version: 1, masked_messages: 0 },
    ]);
    const { text: out, report } = scrub(text);
    expect(out).toBe(file([
      { t: 0, dir: "meta", car: "c", dongle: "d", writeChar: "w", notifyChar: "n", mtu: 247 },
      { t: 1, dir: "meta" },
    ]));
    expect(report.masked["meta-key"]).toBe(2);
  });

  it("11b meta-event: charge-log session event/reason are kept (Decision 15); state is dropped; other values refuse", () => {
    const reasons = ["start", "lv-reset", "timeout", "disconnect", "elm-error"];
    const kept = file([START, ...reasons.map((reason, i) => ({ t: i + 1, dir: "meta", event: "charge-log session", reason }))]);
    const { text: out, report } = scrub(kept);
    expect(out).toBe(kept);
    expect(report.masked["meta-key"]).toBe(0);
    const withState = file([START, { t: 1, dir: "meta", event: "charge-log session", reason: "start", state: "rested" }]);
    expect(scrub(withState).text).toBe(file([START, { t: 1, dir: "meta", event: "charge-log session", reason: "start" }]));
    for (const row of [
      { t: 1, dir: "meta", event: "charge-log session", reason: "sleep" },
      { t: 1, dir: "meta", event: "charge-log session", reason: 1 },
      { t: 1, dir: "meta", event: "charge-log session" },
      { t: 1, dir: "meta", event: "other", reason: "start" },
      { t: 1, dir: "meta", event: VIN, reason: "start" },
      { t: 1, dir: "meta", reason: "start" },
      { t: 1, dir: "meta", reason: VIN },
    ]) {
      const e = refusal(file([START, row]));
      expect(e.line, JSON.stringify(row)).toBe(2);
      assertQuiet(e);
    }
  });

  it("12 refusals: malformed input is refused with a line number and no VIN in the message", () => {
    const f = frames("18DAF117", vin0902(VIN));
    const cases: [string, number][] = [
      ['{"t":1,"dir":"tx","data":"0902\\r"}\n', 1],
      ["not json\n", 1],
      [pyLine(START) + "\n" + pyLine({ t: 1, dir: "xx", data: "0902\r" }) + "\n", 2],
      ['{"t": 1, "dir": "tx", "data": "ATZ\\r", "t": 2}\n', 1],
      [recording("0902", [f[0], f[1].slice(0, 8) + "23" + f[1].slice(10), f[2]]), 2],
      [recording("0902", f.slice(1)), 2],
      [recording("0902", frames("18DAF117", vin0902("1C4SYNTHETIcVIN00"))), 2],
      // Decision 16: tx/rx lines are fail-closed like meta lines.
      [pyLine(START) + "\n" + pyLine({ t: 1, dir: "tx", data: "0902\r", vin: VIN }) + "\n", 2],
      [pyLine({ t: 1, dir: "rx", data: "OK\r\r>", note: "x" }) + "\n", 1],
    ];
    for (const [text, line] of cases) {
      const e = refusal(text);
      expect(e.line, text).toBe(line);
      assertQuiet(e);
    }
    // Python-written floats ("t": 5.0) are json.dumps form and must be accepted verbatim.
    const py = '{"t": 5.0, "dir": "tx", "data": "ATZ\\r"}\n{"t": 5.25, "dir": "rx", "data": "OK\\r\\r>"}\n';
    expect(scrubRecording(py).text).toBe(py);
  });

  it("13 safety-net: a serial learned from 0902 or 22 4193 surviving outside every rule is refused by verify (Decision 17)", () => {
    const from0902 = exchange("0902", frames("18DAF117", vin0902(VIN)), 11, 1);
    const from4193 = exchange("22 4193", frames("18DAF117", [0x62, 0x41, 0x93, ...bytes(VIN.repeat(4))]), 11, 1);
    // The serial straddles the FF/CF boundary: only the reassembled payload holds it, no line or rx hex run does.
    const straddling = frames("18DAF117", [0x62, 0x12, 0x34, ...bytes(SERIAL)]);
    expect(straddling.length).toBe(2);
    for (const f of straddling) expect(f).not.toContain(toHex(bytes(SERIAL)));
    for (const [first, later] of [
      [from0902, exchange("22 1234", frames("18DAF117", [0x62, 0x12, 0x34, ...bytes(VIN)]), 11, 2)],
      [from0902, [{ t: 2, dir: "meta", note: "serial " + SERIAL }]],
      [from4193, exchange("22 1234", frames("18DAF117", [0x62, 0x12, 0x34, ...bytes(VIN)]), 11, 2)],
      [from0902, exchange("22 1234", straddling, 11, 2)],
    ]) {
      const text = file([START, ...first, ...later]);
      const s = new UploadScrubber();
      const out = text.split("\n").slice(0, -1).flatMap((l) => s.push(l));
      out.push(...s.end().lines);
      expect(() => {
        for (const l of out) s.verify(l);
        s.verifyEnd();
      }).toThrow(ScrubRefusal);
      const e = refusal(text);
      expect(e.message).toContain("a VIN serial survives masking");
      assertQuiet(e);
    }
  });

  it("13b safety-net-check-digit: a digit-only check-digit hit is masked but does not feed the safety net (Decision 11)", () => {
    // 11111111111111111: weights sum to 89, 89 mod 11 = 1, so position 9 ("1") passes 49 CFR 565.15(c).
    const digits = "1".repeat(17);
    const text = file([
      START,
      ...exchange("0902", frames("18DAF117", vin0902(VIN)), 11, 1),
      ...exchange("22 2CA7", frames("18DAF1CB", [0x62, 0x2c, 0xa7, ...bytes(digits)]), 11, 2),
      ...exchange("22 2B11", frames("18DAF1CB", [0x62, 0x2b, 0x11, ...bytes("111111")]), 11, 3),
    ]);
    const { text: out, report } = scrub(text);
    expect(report.masked["vin-check-digit"]).toBe(1);
    expect(messagesOf(out).map((m) => m.data).slice(1)).toEqual([
      [0x62, 0x2c, 0xa7, ...bytes("1".repeat(11) + "000000")], [0x62, 0x2b, 0x11, ...bytes("111111")],
    ]);
    expect(leaks(out, SERIAL)).toBe(false);
  });

  it("13c float form: a masked 41 A6 rx line keeps its Python \"t\": 5.0 (Decisions 14, 17)", () => {
    const reply = sf("18DAF117", [0x41, 0xa6, 0x00, 0x01, 0xe2, 0x40]);
    const text = `{"t": 5.0, "dir": "tx", "data": "01A6\\r"}\n{"t": 5.0, "dir": "rx", "data": "${reply}\\r\\r>"}\n`;
    const { text: out, report } = scrubRecording(text);
    expect(report.masked["odometer-01a6"]).toBe(1);
    expect(out).toBe(`{"t": 5.0, "dir": "tx", "data": "01A6\\r"}\n{"t": 5.0, "dir": "rx", "data": "18DAF1170641A630303030\\r\\r>"}\n`);
  });

  it("14 streaming: push/end/verify line by line equals scrubRecording, for every rx chunk split", () => {
    const reply = interleave(frames("18DAF117", vin0902(VIN)), frames("18DAF128", vin0902(VIN))).join("\r") + "\r\r>";
    for (let chunk = 1; chunk <= reply.length; chunk++) {
      const text = file([
        { t: 0, dir: "rx", data: "ü" },
        { t: 0.5, dir: "meta", car: "synthetic", note: "typed 2026-09-24" },
        ...exchange("0902", reply.slice(0, -3).split("\r"), chunk, 1),
        { t: 1.9, dir: "meta", note: "between 2026-09-24", phase: "A" },
        ...exchange("22 F18C", [sf("18DAF117", [0x62, 0xf1, 0x8c, 0x41])], chunk, 2),
      ]);
      const whole = scrubRecording(text).text;
      const s = new UploadScrubber();
      const emitted: string[] = [];
      for (const line of text.split("\n").slice(0, -1)) {
        emitted.push(...s.push(line));
        expect(whole.startsWith(emitted.map((l) => l + "\n").join("")), `chunk ${String(chunk)}`).toBe(true);
      }
      emitted.push(...s.end().lines);
      for (const l of emitted) s.verify(l);
      s.verifyEnd();
      expect(emitted.join("\n") + "\n").toBe(whole);
    }
  });

  it("15 idempotent: a file triggering every rule scrubs to itself on a second pass", () => {
    const text = file([
      { t: 0, dir: "meta", car: "c", note: "typed", vin: VIN },
      ...exchange("0902", frames("18DAF117", vin0902(VIN)), 11, 1),
      ...exchange("22 4193", frames("18DAF117", [0x62, 0x41, 0x93, ...bytes(VIN.repeat(4))]), 11, 2),
      ...exchange("22 2B10", frames("18DAF117", [0x62, 0x2b, 0x10, ...bytes(TABLE_VI)]), 11, 3),
      ...exchange("22 F190", frames("18DAF117", [0x62, 0xf1, 0x90, ...bytes(TABLE_VI)]), 11, 4),
      ...exchange("0906", [sf("18DAF117", [0x49, 0x06, 0x01, 0xaa])], 11, 5),
      ...exchange("01A6", [sf("18DAF117", [0x41, 0xa6, 0x00, 0x01, 0xe2, 0x40])], 11, 6),
      { t: 7, dir: "meta", note: "done 2026-09-24T10:11:12Z" },
    ]);
    const { text: out, report } = scrub(text);
    for (const rule of SCRUB_RULES) expect(report.masked[rule], rule).toBeGreaterThan(0);
    expect(scrubRecording(out).text).toBe(out);
  });
});
