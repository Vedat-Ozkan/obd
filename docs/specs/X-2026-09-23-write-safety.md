# X-2026-09-23-write-safety: read-only allowlist for the `obd-core` session guard

## Goal

`Elm327Session` refuses, with `blocked` and before writing a byte, every command that is not on a sourced read-only allowlist. Today it blocks only services `04`/`2E`/`2F`/`31`. Three gaps from T0.4 review round 3 (`docs/task-runs/T0.4.md`) get closed. (a) An empty or whitespace-only command puts a bare CR on the wire, and the ELM327 answers a bare CR by repeating the previous command. (b) Every other UDS or J1979 service that resets, clears, writes, actuates, or changes a session is currently allowed, including Mode `08`, "control operation of on-board component/system". (c) `ATCAF0` makes the caller's first byte the PCI, so `0104` would go out as service `04`. A fourth gap turned up while sourcing: custom headers survive a protocol change, and on 11-bit CAN only the rightmost 11 bits are used. So `ATSH DA1DF1` followed by `ATSP6` would put frames on an arbitrary 11-bit CAN ID. A small sequence rule closes that one (open question 1).

What a test sees when this is done:
- `send("")`, `send("   ")`, `send("ATCAF0")`, `send("at caf 0")`, `send("08 01")`, `send("11 01")`, `send("14 FF FF FF")`, `send("ATPP 24 SV FF")`, and `send("ATMA")` reject `blocked` with zero transport writes.
- A sweep over all 256 first bytes allows exactly `01 02 03 06 07 09 0A 22`.
- A fresh session refuses `ATSH DA1DF1`. After `ATZ` and an `OK` to `ATSP7` it is accepted, and after that `ATSP6` is refused until the next `ATZ`.
- The two tracked Equinox recordings still replay byte for byte through `init()` and `send()`. `pnpm replay` gives the same summaries as before on every tracked recording and synthetic fixture.
- `docs/ELM327.md` has a new §Write safety that sources each rule.

## Non-goals

- **No Mode 04 path.** `04` stays blocked in `send()`. T0.7 adds the confirmed clear as its own method.
- **No change to `apps/mobile/`.** Another session is editing it, and its console allowlist needs no change (see Follow-ups).
- **No change to `tools/spike/`.** `check_allowed` is already stricter than this list and refuses `""`; see Follow-ups.
- **No relay work.** What T0.6 must enforce is listed under Follow-ups for its spec.
- **No new `ATCAF1` init step.** It would change `init()`'s wire sequence and break the byte-for-byte Equinox init replay. See Risks.
- **No privacy filtering by DID.** VIN-bearing DIDs (`22 F190`, `22 4193`) are a privacy matter handled by redaction (ADR-017), not by the write guard.
- **No new services or AT commands beyond what the recordings, fixtures, and `init()` already use.** That rules out `19` ReadDTCInformation, 11-bit `ATSH 7E0`, and `ATST`, among others. Each addition later needs its own spec row and source.
- No package `exports` entry for the guard. T0.6 adds one if the relay imports it.
- No `ElmSessionError` shape change (no reason field).

## Interfaces

```ts
// packages/obd-core/src/elm/guard.ts (new). Pure: no imports.

export const NON_PRINTABLE: RegExp;            // moved from session.ts unchanged: /[^\x20-\x7E]/
export function normalize(cmd: string): string; // moved from session.ts unchanged: spaces removed, upper case

/** The normalized command if it is on the read-only allowlist (docs/ELM327.md §Write safety); otherwise undefined. */
export function allowedCommand(cmd: string): string | undefined;

/** Dongle state that decides whether a header or protocol command is safe to send. */
export interface HeaderState {
  /** The last ATSP value the ELM answered OK to since the last reset; undefined when unknown. */
  readonly protocol: string | undefined;
  /** An ATSH or ATFCSH value may be in effect (they persist until ATD/ATWS/ATZ). */
  readonly customHeader: boolean;
}
/** The state before any reset has been seen: assume the worst. */
export const UNKNOWN_STATE: HeaderState; // { protocol: undefined, customHeader: true }

/** For an allowedCommand() result: the state to hold while it is in flight, or undefined if the sequence rule blocks it. */
export function beforeWrite(state: HeaderState, norm: string): HeaderState | undefined;
/** After a '>' arrived for `norm`; ok = the response kind was "ok". */
export function afterReply(state: HeaderState, norm: string, ok: boolean): HeaderState;
```

`Elm327Session`'s public signatures are unchanged. Behavior before and after:

```ts
// before: send() rejects "blocked" on non-printable input or a first byte in {04, 2E, 2F, 31}
// after:  send() rejects "blocked" when allowedCommand(cmd) === undefined (checked when send() is called),
//         or when beforeWrite() returns undefined (checked in queue order, just before the write).
```

### Allowlist (`allowedCommand`)

Reject any non-printable input, then `normalize`. Accept only these:

| Normalized form | Class |
|---|---|
| hex digits only, even length ≥ 2, first byte in `01 02 03 06 07 09 0A 22` | read request |
| `ATZ` `ATI` `ATE0` `ATL0` `ATS0` `ATH1` `ATSP0` `ATSP6` `ATSP7` `ATDPN` `ATRV` `ATAT1` | plain |
| `ATCRA18DAF1` + 2 hex | plain (receive filter only) |
| `ATFCSD300000` | plain (exact) |
| `ATCP18` | header class |
| `ATSHDA` + 2 hex + `F1` | header class |
| `ATFCSH18DA` + 2 hex + `F1` | header class |
| `ATFCSM1` | header class |

Everything else is refused, including `""`, a lone trailing response-count digit (`0100 1`), `ATCAF0`, `ATCAF1`, every `ATPP…`, `ATD`, `ATWS`, `ATMA`, `ATCSM0`, `ATAL`, `ATCEA…`, other `ATSH`/`ATCP`/`ATFCSH`/`ATFCSD`/`ATFCSM` values, and `ST…` commands.

### Sequence rule (`beforeWrite` / `afterReply`)

Restrictive effects apply before the write. Permissive effects apply only after the ELM confirms.

- `beforeWrite`:
  - `ATSP<p>`: `undefined` if `customHeader` is true and `p ≠ 7`. Otherwise `{ protocol: undefined, customHeader }`.
  - Header class: `undefined` unless `protocol === "7"`. `ATSH…`/`ATFCSH…` return `{ protocol, customHeader: true }`. `ATCP18`/`ATFCSM1` return the state unchanged.
  - Anything else: the state unchanged.
- `afterReply`:
  - `ATZ`: `{ protocol: undefined, customHeader: false }` on any reply.
  - `ATSP<p>` with `ok`: `{ protocol: p, customHeader }`.
  - Anything else: the state unchanged.

### Session wiring (`session.ts`)

- `private headerState: HeaderState = UNKNOWN_STATE`.
- `send()`: replace the non-printable check and the `BLOCKED_SERVICES` check with `allowedCommand(cmd) === undefined → reject blocked`. Delete `BLOCKED_SERVICES`.
- `run()` is used by both `send()` jobs and `runInit()`:
  - First, `beforeWrite(this.headerState, normalize(cmd))`. If the result is `undefined`, throw `ElmSessionError("blocked", cmd)` and write nothing. Otherwise store it.
  - After the final response, store `afterReply(…, r.kind === "ok")`.
  - If an attempt throws (timeout, closed, write rejection), the restrictive in-flight state stays.
- `exchange()`: the defense-in-depth check becomes `allowedCommand(cmd) === undefined → reject blocked`, which also covers empty commands. Every string `runInit()` builds is on the list.
- `toResponse()` imports `NON_PRINTABLE` and `normalize` from `guard.ts`.

## Files

- `packages/obd-core/src/elm/guard.ts` — create — allowlist, `normalize`, `NON_PRINTABLE`, sequence rule; one comment per rule citing `docs/ELM327.md` §Write safety.
- `packages/obd-core/src/elm/session.ts` — modify — use the guard in `send()`, `run()`, `exchange()`; remove `BLOCKED_SERVICES` and the moved helpers.
- `packages/obd-core/test/guard.test.ts` — create — pure tests G1–G7 below.
- `packages/obd-core/test/session.test.ts` — modify — extend test 9; add tests 14 and 15 below; existing tests unchanged.
- `docs/ELM327.md` — modify — add §Write safety (text below) after §J1979 conventions.
- `docs/ARCHITECTURE.md` — modify — line 108 comment becomes `rejects anything off the read-only allowlist ("blocked"); docs/ELM327.md §Write safety`; add a `guard.ts` line under `src/elm/` in the tree (line 17–19 block).

## Sources

Abbreviations:
- **DS** is the ELM327 datasheet, revision `ELM327DSJ` (© 2014 Elm Electronics; covers firmware v2.1; 94 pp.). It was fetched 2026-09-23 from `https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf` into `/tmp`, never into the repo. SHA-256 `43cab005c9e1678325a3ba64066db93e09e2a78a23eb5fa360ee1eaf9a585428`.
  - It is the manufacturer's primary source. Elm Electronics has closed (farewell notice on its homepage, seen 2026-09-23), but the PDF is still served.
  - It is copyrighted: cite it and paraphrase it, never copy it.
  - Page numbers are the printed "n of 94".
- **Wiki-UDS** is Wikipedia "Unified Diagnostic Services" `oldid=1334951853` (2026-01-26, CC-BY-SA-4.0), §Services. It is **secondary**, because ISO 14229-1 is paywalled. Only IDs and short names are used, paraphrased.
- **Wiki-PIDs** is the already-pinned Wikipedia "OBD-II PIDs" `oldid=1374011962`, §Services / Modes.
- **spike** is `fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl`.

| Constant / behavior | Source |
|---|---|
| A bare CR repeats the last command (AT or OBD); one command remembered | DS p.9 "Communicating with the ELM327"; p.12 AT Command Descriptions `<CR>`; in firmware since v1.0 (p.90 Version History) |
| Spaces and control characters in input are ignored; commands are case-insensitive; so whitespace-only equals a bare CR | DS p.9 |
| Input the ELM does not understand gets `?` and is not acted on | DS pp.8–9 |
| CAF1 (default): the ELM builds the PCI byte on send, even with H1 on; CAF0: the caller supplies every byte including PCI, the ELM only pads | DS pp.13–14 "CAF0 and CAF1"; p.44 "CAN Message Types"; since v1.0 (p.90) |
| Our Veepeak sends with CAF1 after `ATZ` | spike line 32: `0100` answered `06 41 00…` (under CAF0 the request would have been PCI `01` + service `00`) |
| PP 24 sets the power-on CAF default; `ATPP hh SV yy` / `ATPP hh ON` program it in the dongle | DS p.23 (PP commands), p.72 (PP summary row 24), p.90 (PPs and PP 24 since v1.1) |
| `ATSH` values persist until `ATD`/`ATWS`/`ATZ`; on 11-bit CAN only the rightmost 11 bits of the header are used | DS p.25 "SH xx yy zz" |
| `ATCP` sets the top 5 bits of a 29-bit ID, default `18` | DS p.15 |
| `ATZ` returns all settings to defaults | DS p.28 "Z"; `ATD`, `ATWS` same effect on headers (p.16, p.28) |
| `ATFCSM 1` = the user supplies the FC header and data; `ATFCSD` 1–5 data bytes; `ATFCSH` FC header | DS p.17, p.60 "Altering Flow Control Messages" |
| FC data `30 00 00` = PCI type 3 (flow control) | docs/ELM327.md §Multi-frame (PCI nibble `3`); spike line 140 |
| `ATMA` monitors quietly unless `CSM0`, which makes the ELM acknowledge frames | DS p.21 |
| A trailing single hex digit on an OBD request = expected response count | DS p.32 |
| `CRA 18 DA F1 xx` = replies from ECU `xx` to the scan tool `F1` | DS p.46 |
| J1979 services 01–0A and their meaning, including `04` clear and `08` control | Wiki-PIDs §Services / Modes; docs/ELM327.md §Standard modes |
| Service `22` = ReadDataByIdentifier; UDS service IDs start at `0x10` | Wiki-UDS §Services; Wiki-PIDs §Services / Modes (22 per SAE J2190 for GM); spike line 162 (`22 2B43` → `62 2B 43…`) |
| Every other UDS service ID and its class | Wiki-UDS §Services (table below) |
| AT commands on the list: `ATZ` `ATI` `ATE0` `ATL0` `ATS0` `ATH1` `ATSP0` `ATDPN` `ATRV` | docs/ELM327.md §Init sequence; spike lines 2–22 |
| `ATSP6`, `ATAT1` | docs/ELM327.md §Init sequence (ATSP6 alternative; ATAT1 optional); DS p.13 (AT1 is the default); `fixtures/synthetic/session-branches.jsonl`, `elm-framing.jsonl` |
| `ATSP7` `ATCP 18` `ATSH DA<tt>F1` `ATCRA 18DAF1<tt>` `ATFCSH 18DA<tt>F1` `ATFCSD 300000` `ATFCSM 1` | docs/ELM327.md §Per-car Equinox; spike lines 129–150 |
| Write-safety policy | AGENTS.md hard rule 5; ADR-008; ADR-013 |

### Text for `docs/ELM327.md` §Write safety

The implementer adds this section as written, apart from wording polish. Rows paraphrase the sources above; no datasheet text is copied.

> ## Write safety
>
> Why `packages/obd-core/src/elm/guard.ts` allows what it allows. Sources: Elm Electronics ELM327 datasheet `ELM327DSJ` (firmware v2.1; "DS", with page; URL and SHA-256 in `docs/specs/X-2026-09-23-write-safety.md`; copyrighted, paraphrased, not checked in); Wikipedia "Unified Diagnostic Services" `oldid=1334951853` ("Wiki-UDS", **secondary**, ISO 14229-1 is paywalled); Wiki `oldid=1374011962` §Services / Modes. The datasheet describes a genuine ELM327; clones may differ, so where a clone matters a recording is cited.
>
> **Input rules.**
> - A bare CR repeats the previous command, AT or OBD (DS p.9, p.12). The ELM ignores spaces and control characters and is case-insensitive (DS p.9), so a whitespace-only command is a bare CR. The guard compares normalized forms and refuses empty ones.
> - With CAN auto formatting on (CAF1, the default), the ELM builds the PCI byte on send, even with headers on. With CAF0 the caller's first byte becomes the PCI, so `0104` would go out as a single frame carrying service `04` (DS pp.13–14, p.44). Our Veepeak sends with CAF1 after `ATZ`: spike line 32. `ATCAF0`, `ATCAF1` and all `ATPP` commands are refused, because PP 24 sets the power-on CAF default (DS p.23, p.72).
> - Headers set with `ATSH`/`ATFCSH` persist until `ATD`/`ATWS`/`ATZ`, and on 11-bit CAN only their rightmost 11 bits are used (DS p.25). So a 29-bit header followed by an 11-bit protocol would send on an arbitrary 11-bit ID. The sequence rule allows header commands only after `ATSP7` was answered `OK`. After a header is set, it allows no protocol other than 7 until `ATZ`.
> - Flow control mode 1 sends user-defined FC frames (DS p.17, p.60). The FC data is pinned to `30 00 00` (spike line 140) and the FC header to `18DA<tt>F1`.
>
> **Services.** First byte of an OBD request, CAF1 in effect. Allowed: `01 02 03 06 07 09 0A 22`. Everything else is refused, including IDs not listed here.
>
> | ID | Name (paraphrased) | Class | Allowed |
> |---|---|---|---|
> | 01, 02, 03, 06, 07, 09, 0A | J1979 current data, freeze frame, stored DTCs, test results, pending DTCs, vehicle info, permanent DTCs | read | yes (§Standard modes) |
> | 04 | J1979 clear DTCs and stored values | clear | no; T0.7 adds a confirmed path |
> | 05 | J1979 O2 sensor test results, non-CAN only | read | no (not used on CAN) |
> | 08 | J1979 control of an on-board component or system | actuation | no |
> | 10 | DiagnosticSessionControl | session | no |
> | 11 | ECUReset | reset | no |
> | 14 | ClearDiagnosticInformation | clear | no |
> | 19 | ReadDTCInformation | read | no (not needed yet) |
> | 22 | ReadDataByIdentifier | read | yes (spike line 162) |
> | 23 | ReadMemoryByAddress | read (raw memory) | no |
> | 24 | ReadScalingDataByIdentifier | read | no (not needed) |
> | 27, 29 | SecurityAccess, Authentication | security | no |
> | 28 | CommunicationControl | comms | no |
> | 2A | ReadDataByPeriodicIdentifier | starts periodic sending | no |
> | 2C | DynamicallyDefineDataIdentifier | defines DIDs | no |
> | 2E | WriteDataByIdentifier | write | no |
> | 2F | InputOutputControlByIdentifier | actuation | no |
> | 31 | RoutineControl | routine | no |
> | 34–38 | RequestDownload, RequestUpload, TransferData, RequestTransferExit, RequestFileTransfer | transfer | no |
> | 3D | WriteMemoryByAddress | write | no |
> | 3E | TesterPresent | session | no |
> | 83–87 | AccessTimingParameter, SecuredDataTransmission, ControlDTCSetting, ResponseOnEvent, LinkControl | timing/security/DTC/event/link | no |
>
> **AT commands allowed** (normalized, spaces removed): `ATZ ATI ATE0 ATL0 ATS0 ATH1 ATSP0 ATSP6 ATSP7 ATDPN ATRV ATAT1` (§Init sequence; spike lines 2–22, 129), `ATCRA18DAF1<tt>` (DS p.46; spike line 136), `ATFCSD300000` (spike line 140). Header class, only after `ATSP7` was answered `OK`: `ATCP18` (DS p.15; spike line 132), `ATSHDA<tt>F1` (spike line 134), `ATFCSH18DA<tt>F1` (spike line 138), `ATFCSM1` (spike line 142). Anything else is refused, including resets other than `ATZ` (`ATD`, `ATWS`), monitoring (`ATMA`, `ATCSM0`; DS p.21), and the response-count digit (DS p.32).

## Verification

- [ ] `pnpm -F obd-core test` includes `test/guard.test.ts`, which covers:
  - **G1.** `""`, `" "`, `"   "`, `"\t"`, `"\r"`, `"0100\r"`, `"\x00"` → `undefined`.
  - **G2.** For every byte `b` in 0x00–0xFF, `allowedCommand(hex(b) + "00")` is defined exactly when `b ∈ {01,02,03,06,07,09,0A,22}`. For each refused ID in the doc table (`04 05 08 10 11 14 19 23 24 27 28 29 2A 2C 2E 2F 31 34 35 36 37 38 3D 3E 83 84 85 86 87`), these forms are all `undefined`: `s`, `s + " 00"`, lower case, and space-separated nibbles (`" 2 e 0 0 "`).
  - **G3.** `"010"`, `"0100 1"`, `"01G0"`, `"0x0100"`, `"01-00"`, `"AT"` → `undefined`.
  - **G4.** `"ATCAF0"`, `"atcaf0"`, `"AT CAF 0"`, `" a t c a f 0 "`, `"ATCAF1"`, `"ATPP 24 SV FF"`, `"ATPP 24 ON"`, `"ATPP FF ON"`, `"ATPPS"`, `"ATD"`, `"ATWS"`, `"ATMA"`, `"ATCSM0"`, `"ATMR 01"`, `"ATAL"`, `"ATCEA 01"`, `"ATBRD 23"`, `"STDI"` → `undefined`.
  - **G5.** `"ATSH 7DF"`, `"ATSH 7E0"`, `"ATSH 000"`, `"ATSH DB33F1"`, `"ATSH DA1DF2"`, `"ATSH DA1D"`, `"ATCP 00"`, `"ATCP 1F"`, `"ATFCSD 0104"`, `"ATFCSD 30"`, `"ATFCSM 0"`, `"ATFCSM 2"`, `"ATFCSH 7E0"`, `"ATFCSH 18DB33F1"`, `"ATCRA 7E8"` → `undefined`.
  - **G6.** Every tx command in the two tracked spike recordings and the three synthetic fixtures (read from the files) is defined. So are `"at sh da1df1"`, `"22 2b43"`, and `"0100 "` (→ `"0100"`).
  - **G7.** Sequence rule, pure:
    - From `UNKNOWN_STATE`: `ATSP6` and `ATSHDA1DF1` → `undefined`; `ATSP7` → allowed.
    - `afterReply(ATZ)` → `ATSP6` is allowed.
    - `ATSP7` then `afterReply(ok=true)` → `ATSH`, `ATCP18`, `ATFCSH`, `ATFCSM1` are allowed. After `ATSH`, `ATSP0` and `ATSP6` → `undefined`, `ATSP7` is allowed.
    - `ATSP7` then `afterReply(ok=false)` → `ATSH` → `undefined`.
    - After `ATSP0` + ok, the header-class commands → `undefined`.
    - `ATCRA18DAF11D` and `ATFCSD300000` are allowed in every state.
- [ ] `test/session.test.ts`:
  - **Test 9 extended.** Add `""`, `" "`, `"ATCAF0"`, `"at caf 0"`, `"08 01"`, `"11 01"`, `"14 FF FF FF"`, `"10 03"`, `"3E 00"`, `"ATPP 24 SV FF"`, `"ATMA"`: each rejects `{ kind: "blocked", command: cmd }` with zero writes. `ATZ` and `0104` still go through.
  - **New 14** (scripted transport). On a fresh session, `ATSH DA1DF1` and `ATSP6` reject `blocked` with no writes. After `ATZ` → `ATSP7` (`OK`) → `ATSH DA1DF1` (`OK`), `ATSP6` rejects `blocked`. `transport.writes` equals exactly `["ATZ","ATSP7","ATSH DA1DF1"]`. After `init(genericProfile)`, `ATSP6` goes through.
  - **New 15.** When `ATSP7` is answered `?`, a following `ATSH DA1DF1` rejects `blocked`. When `ATZ` times out (fake timers), a following `ATSP6` still rejects `blocked`.
  - The existing Equinox tests ("init and every following tx replay byte for byte", both recordings) and `replay-decode.test.ts` pass unchanged.
- [ ] `pnpm replay <f>` exits 0, and its last line is unchanged from the baseline (recorded 2026-09-23 before this task):
  - `…/2026-09-22-spike.redacted.jsonl` and `…/2026-09-22-spike-2.redacted.jsonl`: `summary: 32 commands; data 15, ok 15, nodata 1, error 1 (buffer-full=1), timeout 0; frames 41; dropped malformed=1, incomplete=4, no-first-frame=1`
  - `fixtures/synthetic/session-branches.jsonl`: `summary: 21 commands; data 8, ok 6, nodata 0, error 6 (unable-to-connect=1, can-error=3, data-error=2), timeout 1; frames 4; dropped incomplete=1`
  - `fixtures/synthetic/standard-decoding.jsonl`: `summary: 12 commands; data 12, ok 0, nodata 0, error 0, timeout 0; frames 14; dropped none`
  - `fixtures/synthetic/elm-framing.jsonl`: `summary: 10 commands; data 3, ok 3, nodata 2, error 2 (unable-to-connect=1, unknown-command=1), timeout 0; frames 0; dropped incomplete=1`
- [ ] Local only (gitignored, not CI evidence; NOT RUN if absent). Run `pnpm replay` on `2026-09-23-discovery.jsonl` and `…-discovery-targeted.jsonl` and print **only the last line** (VIN privacy, ADR-017). Expect exit 0 and the baselines `summary: 16882 commands; data 16622, ok 216, nodata 40, error 3 (buffer-full=3), timeout 1; …` and `summary: 10434 commands; data 9860, ok 534, nodata 39, error 1 (buffer-full=1), timeout 0; …`. The one timeout is on `ATRV` (L49776), which has no state effect.
- [ ] Mutation checks, each run on a temp copy outside the repo and each expected to fail a named test:
  1. Accepting an empty normalized command fails G1 and test 9.
  2. Adding `ATCAF0` to the plain list fails G4.
  3. Adding `08` to the services fails G2.
  4. Making `beforeWrite` return the state unchanged fails G7 and test 14.
  5. Applying `ATSP` on `ok=false` fails G7 and test 15.
- [ ] Purity: `guard.ts` has no imports; `grep -nE "react-native|ble|fetch\(|node:" packages/obd-core/src/elm/guard.ts` is empty.
- [ ] `pnpm check` green; `git diff --check` clean; no new dependencies.
- [ ] Hardware: **none required.** Every change only refuses commands, and no new command reaches the car. The bare-CR repeat on the Veepeak clone does not need confirming: blocking it is safe whether or not the clone repeats. Do not test it on the car.

## Follow-ups (not in this task's files)

- **App console (`apps/mobile/src/console.ts`).** Exact delta: none required.
  - Its services are identical to this list (`01 02 03 06 07 09 0A 22`), and its 8 exact AT commands are a subset with no header-class, CAF, or PP commands.
  - `normalizeReadOnlyCommand("")` and `("   ")` already throw ("complete hexadecimal bytes").
  - When the console gains any AT command beyond those 8, it must switch to `allowedCommand` + `beforeWrite`/`afterReply` from `obd-core` instead of growing its own list.
- **Laptop tools (`tools/spike/`).** Exact delta: none.
  - `discover.check_allowed` accepts only its exact AT set and `01xx`/`09xx`/`22 xxxx`, and already refuses `""`, `ATMA`, `ATSP6`, `10 03`, `11 01`, `14FF00`, and `3E 00` (`test_discover.py` lines 145–154).
  - Its header/protocol order is fixed in code with no free input. `spike.py` sends a fixed list.
- **T0.6 relay (for its spec).**
  1. Enforce `allowedCommand` and the sequence rule per phone connection, either by routing through `Elm327Session` or by importing `guard.ts` (add a package export then).
  2. Start each (re)connect in `UNKNOWN_STATE`.
  3. Reach `04` only through T0.7's confirmed method, with the confirmation on the phone.
  4. Log every refusal.
  5. Relay tests: `""`, `"   "`, `ATCAF0`, `ATPP 24 SV FF`, `08 01`, `11 01`, `14 FF FF FF`, `ATSH DA1DF1` before `ATSP7`, and `ATSP6` after `ATSH`.
- **`ATCAF1` in init.** For other people's dongles (see Risks), add `ATCAF1` as a required init step the next time init recordings are made anyway (T0.6 `hil:smoke`). The Equinox init replay test then moves to the new recording.

## Risks / open questions

- **Open question 1: should the sequence rule go in now?** The stateless allowlist alone still permits `ATSP7`, `ATSH DA1DF1`, `ATSP6`, `0100`, which sends a read request on 11-bit ID `0x5F1` (DS p.25). The rule costs about 25 lines in `guard.ts` plus tests G7/14/15, and every recording already complies (checked: spike, spike-2, both discovery files). **Recommendation: include it now**, because T0.6 will expose `send()` to agents before T2.1 builds profile sequences. The alternative is a stateless list here, with the rule moved into the T0.6 relay and T2.1.
- **Risk: PP 24 on other dongles.** A dongle whose PP 24 was programmed by some other app powers up with CAF0. Every allowed request then goes out with its first byte as the PCI, and `0104` becomes a Mode 04 clear. Our Veepeak is shown to be CAF1 (spike line 32), so this matters for beta testers (ADR-014), not for Phase 0. Mitigation: the `ATCAF1` follow-up above.
- **Risk: a fresh session is strict.** In `UNKNOWN_STATE`, `send("ATSP0")` is refused until `ATZ` or `init()`. Current callers comply: `pnpm replay` recordings start with `ATZ`, and tests call `init()`. A caller that skips init gets `blocked`, which is the intended outcome.
- **Risk: clone deviations.** The datasheet describes a genuine v2.1. A clone that does not ignore spaces could only make the guard stricter, because the list is exact and normalized.
- **Risk: the list may be too tight later.** T2.1 on ICE cars may want 11-bit `ATSH 7E0`, and later work may want `19`. Each addition needs a source row in §Write safety and a spec.

Size: **M**. About 70 lines of guard, 15 in the session, ~150 of tests, and one doc section, in one implementer session. No split.

## Decisions

Answered by the user 2026-09-23 (orchestrator recorded):

1. Header/protocol sequence rule: **add it now** in this task (header commands only after `ATSP7` answered `OK`; no other protocol after a header is set until `ATZ`; a fresh session assumes the worst). As recommended.

Orchestrator amendment 2026-09-23 (review round 1, finding 1, blocking): `afterReply` for `ATZ` clears the header flag and the confirmed protocol **only when the reply kind is not `error` and the command did not time out** (the `ATZ` banner parses as `data`). Rationale: ELM327 datasheet rev J p.9 and p.48 — a character received while the ELM is busy interrupts it; the ELM prints `STOPPED` and discards the character, so a busy dongle answers `ATZ` with `STOPPED` and never resets. Pass the reply kind (or an equivalent success flag computed from it) into the guard instead of a bare `ok`. Tests: header set, `ATZ` answered `STOPPED\r\r>` (and `?\r\r>`), then `ATSP6` is rejected `blocked`. Finding 2: add to G7 `step(reset, "ATSP7")` → `beforeWrite("ATSP0")` → `afterReply(failure)` → `ATSHDA1DF1` refused (proves ATSP clears the confirmed protocol before the write). Replay summaries must stay byte-identical (no recorded `ATZ` reply is an error).

Orchestrator amendment 2026-09-23 (review round 2, finding 1 — pre-existing since T0.4, fixed here under the owner's delegation): ELM327 datasheet rev J p.9 and p.48: a character received while the ELM is busy interrupts it and is discarded, so a write to a busy ELM can lose its first character and turn an allowed request into a refused service (e.g. `014FFFFFF1` → `14 FF FF FF` ClearDiagnosticInformation; `011011` → `11 01` ECUReset). Two independent layers:
1. **No write without a prompt.** When the resync window after a timeout (or any stale state) expires without a `>`, the next command is rejected with a timeout/stale error and the session stays stale; it never writes into a possibly busy ELM. `init()` must not clear `stale` and write `ATZ` blindly: it waits for the same resync (a `>` or the window) and, if no `>` arrived, rejects without writing. A later `>` (late prompt) clears stale as today. Tests: timeout, no `>` within RESYNC_MS → next `send()` rejects with zero writes; timeout then late `>` → next send writes; `init()` after a timeout with no `>` → zero writes.
2. **Exact request lengths per service** (normalized hex characters): `01` 4, `02` 6, `03` 2, `06` 4, `07` 2, `09` 4, `0A` 2, `22` 6; anything longer or shorter is refused `blocked`. This removes payload room for a first-character drop to smuggle a refused service. Multi-PID requests are already a T0.5 non-goal. Tests: `014FFFFFF1`, `011011`, `02EF190ABCD1`, `0100FF`, `2233E5FF`, `0` + allowed patterns of wrong length → blocked, zero writes; every tx line in the tracked and synthetic recordings still passes (G6).
Also finding 2: add one sentence to `docs/ELM327.md` §Write safety: an `ATZ` answered with an error (`STOPPED`, `?`) resets nothing (DS p.9, p.48; §Responses STOPPED row). Replay summaries must stay byte-identical; if a recording contains a request of a length now refused or a write after an unanswered timeout, stop and report instead of changing the rule.

Orchestrator decision 2026-09-23 (repair round 2 stop-report): the only conflict with rule 1 is hand-written synthetic data and scripted tests that encode the old write-after-unanswered-timeout behaviour — `fixtures/synthetic/session-branches.jsonl` lines 37–39 and the session tests "covers fallback, … timeout, resync, CAN ERROR and DATA ERROR" and test 11; no real recording conflicts, and rule 2 conflicts with nothing. Resolution (option a): (1) edit `fixtures/synthetic/session-branches.jsonl` (synthetic, `synthetic: true`; AGENTS.md rule 2 immutability covers `fixtures/recordings/` only) so the `0100` timeout is followed by a late `>` before the next tx, preserving the resync-then-write path the fixture exists to cover; add a new synthetic case (in the same fixture or inline in the session test) where no `>` arrives and the next command is rejected with zero writes; (2) update the synthetic session test and test 11 to the new rule (write failure → stale → next send rejects with zero writes unless a `>` arrives; add the late-`>` positive case); (3) the replay summary of `session-branches.jsonl` may change — record the before and after summaries in the report as an intended change; all other replay outputs (both redacted spikes, `elm-framing`, `standard-decoding`, both local discovery files) must stay byte-identical. Rules 1 and 2 and the §Write safety sentences all go in this round.

Orchestrator decision 2026-09-23 (second stop-report): the only remaining conflict with rule 1 is the local, gitignored `fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-23-discovery.jsonl` at tx line 49776 — the known T2.3a recorder-ordering defect (its `>` was recorded at line 49775, before the tx; see `docs/task-runs/T2.3a.md` and the T2.3b `EARLY_PROMPT` exemption). Under rule 1, `pnpm replay` of that one file correctly stays stale after that tx. Accepted (option a): that file is removed from the replay-identity check; `recordings.test.ts` (which does not use the session) is unaffected; no rule is weakened. All other replay outputs stay byte-identical, and `session-branches.jsonl`'s summary change is intended.
