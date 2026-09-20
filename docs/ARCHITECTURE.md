# Architecture

The design has one load-bearing idea: **everything that talks to a car goes through one `Transport` interface, and everything above it is pure TypeScript that runs identically on the phone, on the desk against the HIL bridge, and in CI against recordings.** If that holds, agents can develop and test protocol code without a phone in hand, and every bug found on hardware becomes a recording and then a regression test.

## Packages

### `packages/obd-core` (pure TypeScript, no platform imports)

```
src/
  transport/
    types.ts        Transport interface
    replay.ts       ReplayTransport: plays a recording, asserts the commands match
    http.ts         HttpTransport: talks to the HIL bridge (fetch is injected, not imported)
  elm/
    reader.ts       ElmLineReader: byte chunks → complete responses (until '>')
    session.ts      Elm327Session: init, protocol select, single-flight queue, timeouts, retries
    isotp.ts        multi-frame reassembly with headers on
    errors.ts       classification of NO DATA / UNABLE TO CONNECT / CAN ERROR / BUFFER FULL / STOPPED / ?
  obd/
    j1979.ts        table-driven Mode 01 PID definitions (bytes, formula, unit, source)
    dtc.ts          Mode 03/07/0A parsing and P/C/B/U decoding
    freeze.ts       Mode 02
    vin.ts          Mode 09
    readiness.ts    PID 01 / 41 bitfields
    supported.ts    supported-PID bitmap walk
  vehicles/
    profile.ts      VehicleProfile: protocol, headers, extra commands, decoders
    generic.ts      the default 11-bit CAN profile
    obdb/           importer for OBDb signalset JSON (Phase 2)
  report/
    ppi.ts          PpiReport type, buildPpiReport(), recentlyCleared()
    render.ts       markdown renderer
  recording/
    format.ts       recording line schema (zod) and writer/reader
vehicles/
  chevrolet-equinox-ev/   vendored OBDb signalset + LICENSE (CC-BY-SA-4.0)   (Phase 2)
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

export interface Elm327Session {
  init(profile: VehicleProfile): Promise<InitResult>;   // runs ATZ/ATE0/..., selects protocol
  send(cmd: string, opts?: { timeoutMs?: number }): Promise<ElmResponse>;  // one command, one response
  close(): Promise<void>;
}

export type ElmResponse =
  | { kind: "data"; frames: Frame[]; raw: string[] }
  | { kind: "nodata"; raw: string[] }
  | { kind: "error"; error: ElmError; raw: string[] };

export interface Frame { header?: string; ecu?: string; data: Uint8Array; }
```

Recording format (`fixtures/recordings/<car>/<date>-<slug>.jsonl`), one JSON object per line:

```json
{"t": 0.000, "dir": "tx", "data": "ATZ\r"}
{"t": 1.012, "dir": "rx", "data": "\r\rELM327 v1.5\r\r>"}
{"t": 1.100, "dir": "meta", "car": "chrysler-200-2013", "dongle": "veepeak-obdcheck-ble", "note": "cold, ignition on engine off"}
```

`t` is seconds since recording start. `ReplayTransport` feeds `rx` lines back in order and asserts each `tx` matches what the session sends; a mismatch fails the test, which is the point. Recordings are never edited by hand (AGENTS.md rule 2).

### `packages/obd-diagnose` (pure TypeScript)

```
src/
  case.ts        Case schema (zod): vehicle, dtcs, freezeFrame, readiness, features, anchors, symptomText
  features/      pure functions: DriveLog → Features (fuel trim by load bin, warm-up slope, ...)
  llm/
    client.ts    LlmClient interface; AnthropicClient implementation (@anthropic-ai/sdk)
    prompt.ts    system prompt with reference material (stable, cacheable) and the case rendering
    schema.ts    Diagnosis output schema (zod): hypotheses[] { title, confidence, evidence[], nextTest }
    diagnose.ts  diagnose(case, {model, effort}) → Diagnosis
```

The hosted baseline is one structured-output call through `LlmClient`, with zod validation and provider-supported effort controls. Exact model identifiers, SDK methods, and pricing are verified in the implementation spec; original roadmap model names are placeholders. Reference material is a stable, cacheable system block. VIN and identifying free text are redacted before the case leaves the device. Provider-specific caching and effort controls stay in adapters rather than becoming mandatory capabilities of every model.

The deterministic layer owns measured facts. The LLM ranks hypotheses from those facts and cites the features it used. Runtime validation rejects references that do not resolve into the case; a schema alone cannot establish diagnostic support. The output contract must also represent insufficient information and missing evidence. Semantic support and healthy-case behavior are scored separately in the eval.

### `packages/obd-eval` (Node)

Runs `diagnose()` over every labeled fixture, compares against the label, and writes a markdown report with per-case results, cost from `usage`, latency, model, and effort. Labels live next to recordings as `<name>.label.json` (`docs/EVAL.md`). No mocking of the model in eval; mocked runs are for unit tests only and are named as such.

### `apps/mobile` (Expo, Android)

```
src/
  ble/BleTransport.ts    react-native-ble-plx → Transport (MTU chunking, notify reassembly)
  screens/Connect, Ppi, Report, Case, Settings
  logger/                 foreground service + polling schedule (Phase 1)
  storage/                recordings, drive logs, secure key store
```

The app contains no protocol logic. It owns BLE, screens, storage, and the foreground service. Everything it shows comes from `obd-core` and `obd-diagnose`.

### `tools/hil-bridge` (Python, on the laptop near the car)

`bleak` client plus FastAPI:

- `GET /status` → `{connected, device, service, write_char, notify_char, mtu}`
- `POST /cmd {cmd}` → `{lines: [...], ms}` (sends `cmd\r`, collects until `>`)
- `POST /record/start {path}` / `POST /record/stop` → appends every exchange to a `.jsonl` in the recording format above
- `POST /raw {bytes}` for the spike only

`HttpTransport` in `obd-core` maps `write` to `/cmd`. This is deliberately a simplification: the bridge does prompt detection so the HTTP round trip is one command, not a byte stream. Byte-level behavior (chunking, partial notifications) is exercised by `BleTransport` on the phone and by recordings, not by the bridge.

## Data flow for the two products

**PPI (Phase 0):** connect → `session.init(profile)` → supported PIDs → Mode 09 VIN → Mode 03/07/0A → Mode 02 per stored DTC → PID 01/41 readiness → PIDs 30/31/4E → `buildPpiReport()` → render → share. Every step's exchange is optionally recorded.

**Diagnosis (Phase 1):** logger polls a PID schedule into a drive log → user taps anchor → on request, `features(log)` → `Case` → `diagnose(case)` → hypothesis list with evidence pointers back into features and DTCs.

### `tools/ml/` (planned, isolated Python experiments)

After Phase 1, ML1–ML6 add data preparation, supervised LoRA/QLoRA training, and serving benchmarks. This workspace is separate from the HIL bridge and does not introduce Python or GPU dependencies into the TypeScript packages or phone. No experiment tooling exists yet. See [ML.md](ML.md) for data, training, serving, and artifact requirements.

An experimental endpoint is consumed by a concrete `LlmClient` adapter. All arms use the same redacted `Case` and validated `Diagnosis` contract. The eval records model/prompt/dataset revisions and provider/runtime metadata; serving measurements additionally record workload, precision, hardware, and cache state. Exact interfaces are specified in the implementing task, not assumed to exist today.

Training inputs and adapters are derived artifacts with manifests; immutable recordings remain their original source. Training labels and held-out answers never enter inference cases. Large checkpoints and private data are kept outside git. Optional retrieval supplies sourced context and does not replace deterministic decoding. Hosted inference remains the app baseline pending measured quality and operational evidence.

## What is deliberately not here

No production model-serving backend or accounts yet. No proxy for the API key (BYOK in secure store) until distribution. A bounded experimental model endpoint is permitted for ML work; it is not a production deployment. No automatic routing tier or on-device LLM commitment. No plugin system for vehicle profiles; a profile is a TypeScript object. Keep model integration limited to the `LlmClient` seam the eval needs.
