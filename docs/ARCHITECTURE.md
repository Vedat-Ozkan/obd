# Architecture

The design has one load-bearing idea: **everything that talks to a car goes through one `Transport` interface, and everything above it is pure TypeScript that runs identically on the phone, on the desk through the phone relay, and in CI against recordings.** If that holds, agents can develop and test protocol code without a phone in hand, and every bug found on hardware becomes a recording and then a regression test.

## Packages

### `packages/obd-core` (pure TypeScript, no platform imports)

```
src/
  transport/
    types.ts        Transport interface
    replay.ts       ReplayTransport: plays a recording, asserts the commands match
    relay.ts        RelayTransport: one command per round trip to tools/relay (socket injected, not imported)
    http.ts         HttpTransport: laptop bridge fallback for the spike (fetch injected)
  elm/
    reader.ts       ElmLineReader: byte chunks → complete responses (until '>')
    session.ts      Elm327Session: init, protocol select, single-flight queue, timeouts, retries
    guard.ts        read-only allowlist and header/protocol sequence rule (docs/ELM327.md §Write safety)
    isotp.ts        multi-frame reassembly with headers on
    errors.ts       classification of NO DATA / UNABLE TO CONNECT / CAN ERROR / BUFFER FULL / STOPPED / ?
  obd/
    response.ts     DecodeFailure, echo check
    j1979.ts        table-driven Mode 01 PID definitions (bytes, formula, unit, source)
    dtc.ts          Mode 03/07/0A parsing and P/C/B/U decoding
    freeze.ts       Mode 02
    vin.ts          Mode 09
    readiness.ts    PID 01 / 41 bitfields
    supported.ts    supported-PID bitmap decode (the walk is T0.9)
  vehicles/
    profile.ts      VehicleProfile: protocol, headers, extra commands, decoders
    generic.ts      the default 11-bit CAN profile
    obdb/           importer for OBDb signalset JSON; every signal tagged community | verified (Phase 2)
  report/
    codes.ts        CodesReport type, buildCodesReport(), recentlyCleared(); embedded in every battery report
    render.ts       template renderer
  recording/
    format.ts       recording line schema (zod) and writer/reader
scripts/replay.ts   pnpm replay (Node CLI; outside src)
vehicles/
  saej1979/               vendored OBDb SAEJ1979 signalset (CC-BY-SA-4.0)
  <make>-<model>/         vendored OBDb signalsets + LICENSE (CC-BY-SA-4.0), Equinox EV first   (Phase 2)
```

Core interfaces (T0.3/T0.4 own these; the architect may adjust names but not the shape):

```ts
export interface Transport {
  /** Send raw bytes. Resolves when the bytes are handed to the underlying layer. */
  write(bytes: Uint8Array): Promise<void>;
  /** Subscribe to incoming bytes. Chunk boundaries are meaningless. */
  onData(cb: (bytes: Uint8Array) => void): () => void;
  close(): Promise<void>;
}

export interface VehicleProfile {
  protocol: "0" | "6" | "7";   // ATSP argument; T2.1 adds headers, setup commands, decoders
}

/** One reassembled ISO-TP message from one ECU (it is a message, not a CAN frame). */
export interface Frame {
  header: string;     // CAN ID as printed, spaces removed: "7E8" or "18DAF117"
  ecu: string;        // "17" when header is 18DAF1xx, otherwise the header itself ("7E8")
  data: Uint8Array;   // payload with PCI bytes removed, trimmed to the ISO-TP length (padding dropped)
  negative?: { service: number; code: number };  // present iff data[0] === 0x7F and data.length >= 3
}

export type DropReason = "no-first-frame" | "sequence" | "incomplete" | "flow-control" | "malformed";
export interface DroppedFrame { header: string; reason: DropReason; line: string; }

export interface SendOptions {
  timeoutMs?: number;   // default DEFAULT_TIMEOUT_MS; measured from just before transport.write()
  retry?: boolean;      // default true; `pnpm replay` passes false
}

interface ResponseBody {
  frames: Frame[];          // [] for AT commands
  dropped: DroppedFrame[];  // [] for AT commands
  lines: string[];          // AT commands: all content lines; others: non-frame text lines. Non-printable lines removed
  searching: boolean;
  raw: string;              // verbatim text of the final attempt, '>' excluded
  attempts: 1 | 2;
}

export type ElmResponse =
  | ({ kind: "data" } & ResponseBody)
  | ({ kind: "ok" } & ResponseBody)
  | ({ kind: "nodata" } & ResponseBody)
  | ({ kind: "error"; error: ElmError } & ResponseBody); // frames kept: BUFFER FULL still returns complete messages

export interface InitResult {
  protocol: VehicleProfile["protocol"];  // the ATSP value in effect after init ("0" after a fallback)
  fellBack: boolean;
  idBits: 11 | 29;
  voltage: string | undefined;           // ATRV content line as printed ("12.7V")
  response0100: ElmResponse;             // kind "data", frames.length >= 1
}

export type SessionErrorKind = "timeout" | "closed" | "blocked" | "init";
export class ElmSessionError extends Error {
  readonly kind: SessionErrorKind;
  readonly command: string;
  readonly response?: ElmResponse;
}

export class Elm327Session {
  constructor(transport: Transport);
  init(profile: VehicleProfile): Promise<InitResult>;                // ATZ ATI ATE0 ATL0 ATS0 ATH1 ATSPn ATDPN ATRV 0100; fixed protocol falls back to ATSP0
  send(cmd: string, opts?: SendOptions): Promise<ElmResponse>;       // one command, one response; rejects anything off the read-only allowlist ("blocked"); docs/ELM327.md §Write safety
  close(): Promise<void>;
}
```

Recording format (`fixtures/recordings/<car>/<date>-<slug>.jsonl`), one JSON object per line:

```json
{"t": 0.000, "dir": "tx", "data": "ATZ\r"}
{"t": 1.012, "dir": "rx", "data": "\r\rELM327 v1.5\r\r>"}
{"t": 1.100, "dir": "meta", "car": "chrysler-200-2013", "dongle": "veepeak-obdcheck-ble", "note": "cold, ignition on engine off"}
```

`t` is seconds since recording start. `ReplayTransport` feeds `rx` lines back in order and asserts each `tx` matches what the session sends; a mismatch fails the test, which is the point. Recordings are never edited by hand (AGENTS.md rule 2).

### `packages/obd-battery` (pure TypeScript)

```
src/
  session.ts     ChargeSession: resampled log of SOC, pack voltage, cell min/max, current/energy when available
  capacity.ts    deterministic capacity estimate: integrated energy / ΔSOC, or charger kWh / ΔSOC (Gate B fallback), with error band
  imbalance.ts   cell spread vs SOC, flags
  twelve-volt.ts 12 V thresholds (sourced)
  report.ts      BatteryReport and UsedEvReport types; embed the obd-core CodesReport
  templates.ts   plain-language text from templates: the offline default and the LLM fallback
  models/        on-device model evaluation (BM4), e.g. a tree ensemble loaded from JSON
```

Every number in a report carries its source (logged value, derived value, or model estimate with interval) and the signal tier. Model estimates never replace measured values.

### `packages/obd-assist` (pure TypeScript; replaces the withdrawn `obd-diagnose`)

```
src/
  client.ts      LlmClient interface; AnthropicClient implementation (@anthropic-ai/sdk); proxy client later
  summary.ts     summarize(report, {model, effort}) → structured summary (zod)
  assistant.ts   tool-calling loop: list_sessions, get_session, get_capacity_estimate, get_codes
  check.ts       deterministic faithfulness check: every number in output must match the report or tool results
  prompts/       versioned prompts; stable reference material as a cacheable system block
```

Opt-in only (ADR-012). The user's key lives in the app's secure store (BYOK) until a paid release adds the proxy. VIN and identifying free text never leave the device. If `check.ts` rejects an output, the app shows the template text instead. Imported files and beta notes are untrusted input to the assistant. Exact model identifiers, SDK methods, and pricing are verified in the implementing spec.

The package rename from `obd-diagnose` to `obd-assist` and the new `obd-battery` package are small code tasks done with the first Phase 2 spec that needs them, not part of the documentation change.

### `packages/obd-eval` (Node)

Runs the deterministic report and models over labeled fixtures (capacity error and interval coverage, anomaly detection), and the LLM suite (faithfulness, judge scores with agreement against owner labels, assistant question set, prompt-injection cases, cost, latency). Writes a markdown report to `docs/eval-results.md`. A replay mode feeds saved model responses through the checkers so CI runs without paid calls; live runs are `pnpm eval` only. See `docs/EVAL.md`.

### `apps/mobile` (Expo, Android)

```
src/
  ble/BleTransport.ts    react-native-ble-plx → Transport (MTU chunking, notify reassembly)
  relay/                 relay mode: WebSocket to tools/relay, forwards one command at a time (ADR-013)
  screens/Garage, AddVehicle (supported models only), Connect, Console, BatteryReport, UsedEvReport, ChargeLogger, Assistant, Settings
  logger/                 foreground service for multi-hour charge logging (T2.4)
  storage/                recordings, charge logs, consent records, secure key store
```

The app contains no protocol logic. It owns BLE, screens, storage, the foreground service, and relay mode. Everything it shows comes from `obd-core`, `obd-battery`, and `obd-assist`. One codebase; two store listings later via EAS build variants (ADR-012).

### `tools/relay` (Node, in WSL2) and the car MCP server

The phone connects out to the relay over WebSocket. The relay exposes the car to agents as an MCP server:

- `send_command {cmd}` → `{lines: [...], ms}`
- `start_recording {path}` / `stop_recording` → writes `fixtures/recordings/*.jsonl` in the standard format
- `list_signals {vehicle}` → signals from the vehicle profile with their tier

A read-only allowlist is enforced in the relay, not in prompts: Mode 04 requires a confirmation tapped on the phone; UDS writes (`2E`, `31`, `2F`) and anything not on the allowlist are rejected and logged. `RelayTransport` in `obd-core` lets `pnpm hil:smoke` and replay-style tests use the same path. Exact MCP SDK and dependencies are chosen in the T0.6 spec.

### `tools/hil-bridge` (Python, on the laptop; spike and fallback)

`bleak` client plus FastAPI, used for the T0.2 spike and kept as a fallback (ADR-003, ADR-013):

- `GET /status` → `{connected, device, service, write_char, notify_char, mtu}`
- `POST /cmd {cmd}` → `{lines: [...], ms}` (sends `cmd\r`, collects until `>`)
- `POST /record/start {path}` / `POST /record/stop` → appends every exchange to a `.jsonl` in the recording format above

## Data flow

**Codes report (Phase 0):** connect → `session.init(profile)` → supported PIDs → Mode 09 VIN → Mode 03/07/0A → Mode 02 per stored DTC → PID 01/41 readiness → PIDs 30/31/4E → `buildCodesReport()` → render → share.

**Charge session (Phase 2):** logger polls the profile's battery signals into a charge log during a charge → `capacity()` and `imbalance()` → `BatteryReport` → template text → optional `summarize()` → `check()` → display (template on failure).

**Used-EV scan (Phase 2):** one snapshot of battery signals, 12 V, and the codes report → `UsedEvReport`; capacity shown only if a logged charge exists.

**Assistant (Phase 2, opt-in):** question → tool calls over the user's stored sessions → answer with cited values → `check()` → display.

**Agent discovery (T2.3):** agent → MCP tools on the relay → phone → dongle; every exchange recorded; the owner approves signals before they count.

### `tools/ml/` (planned, isolated Python experiments)

Battery modeling for BM1–BM4 and BM8 (dataset builds and the OCV curve, the independent capacity estimator and Bayesian trend, resistance and circuit models, per-group fault detection with injected faults, export to the on-device format) and the BM7 distillation stretch. Separate from the relay, bridge, TypeScript packages, and phone. Datasets and models are derived artifacts with manifests pointing back to recordings; private data and large checkpoints stay out of git. See [ML.md](ML.md).

## What is deliberately not here

No production backend or accounts yet. BYOK for the LLM feature until a paid release adds a thin proxy with a usage cap. No automatic model routing. No plugin system for vehicle profiles; a profile is a TypeScript object plus vendored OBDb JSON. No LLM on the device; on-device models are small non-LLM battery models (BM4).
