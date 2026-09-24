# X-2026-09-24-first-write: a fresh session writes only ATZ or ATI until the ELM answers cleanly

## Goal

A new `Elm327Session` or app `ConsoleSession` does not know whether the ELM is idle. After an app restart or a BLE reconnect, the ELM may still be running the previous command or reset. A character that reaches a busy ELM interrupts it and is discarded (docs/ELM327.md §Framing; §Write safety, Input rules, DS p.9, p.48). The datasheet does not bound how many characters are lost. So a session's first write can turn a read into a refused service: `0131` → `31` (RoutineControl) after two drops, `22 33E5` → `23 3E` (ReadMemoryByAddress) after one. Today both sessions start non-stale and write whatever comes first.

This task mirrors the relay's rule (`tools/relay/broker.ts:85`, `:138`). Each session starts in an **unknown state**. In that state it writes only `ATZ` or `ATI`, and refuses everything else before any byte goes out. The state ends only when an `ATZ` or `ATI` gets a `>`-terminated reply with no error line. A `STOPPED` reply to any command puts the session back in the unknown state. Before its next write, `Elm327Session` then waits up to `RESYNC_MS` for the second `>`, the reply to whatever part of the interrupted command survived. `init()` stops with `init` on `ATZ` unless `ATZ` is answered cleanly, so `ATE0` is never written into an ELM whose reset was not confirmed. Without this, two drops would turn `ATE0` into `E0`, which the ELM sends as a request. `pnpm replay` is exempt, because `ReplayTransport` answers only what is written and has no busy state. It declares that with a new optional `Transport.startsIdle`.

What a test sees when this is done:
- On a fresh `Elm327Session` over a transport without `startsIdle`, `send("0131")`, `send("22 33E5")`, `send("ATE0")` and `send("ATSP7")` reject with `blocked`, and nothing is written. After `ATZ` is answered with the banner, `0131` is written.
- On a fresh `ConsoleSession` in the app, `send("0100")` rejects with `ELM state unknown; send ATZ or ATI first`. No tx line is recorded and nothing is written. `ATI` is now accepted.
- A plain capture whose `ATZ` is answered `?` stops after one command with that reason. It no longer writes `ATE0`…`03`.
- `init()` on a fresh session whose `ATZ` is answered `STOPPED` rejects with `{kind:"init", command:"ATZ"}`. The only write is `ATZ`. A second `init()` waits for the late `?>` and then completes.
- Every `pnpm replay`, `pnpm -s codes-report`, and profile-scan-replay output is byte-identical to the pre-change tree. The codes-scan E2E over the spike and phone recordings passes unchanged.
- `docs/ELM327.md` §Write safety states the rule and carries the six T0.7 A2 re-review follow-ups (`docs/task-runs/T0.7.md`).

## Non-goals

- **No change to `tools/relay/broker.ts`.** The relay already has this rule. It keeps its stricter "any error reply means not idle" variant, because it cannot see a late `>`.
- **No handling of `LV RESET`** beyond what exists (Q3).
- **No automatic `ATZ` retry inside `init()`** (Decision D2). The caller re-runs `init()`.
- **No console drain after `STOPPED`.** The console's unknown state already limits the next write to `ATZ`/`ATI`, and the codes scan stops on an `ATZ` not answered as data.
- **No alignment of the console allowlist with `guard.ts`**, apart from adding `ATI` (Q2). The T0.7 Risks item still stands.
- **No new `SessionErrorKind`** (Q1).
- **No provoking of `STOPPED` or dropped characters on a car.** §Write safety: "Do not test it on a car."
- **Out of bounds for this task:** `apps/mobile/App.tsx`, `pnpm-lock.yaml`, `packages/obd-battery/`, and `fixtures/synthetic/twelve-volt-vpwr.jsonl` (Codex T2.5). None of them needs a change: the app shows `send()` errors as `Command error: <message>` (App.tsx:127-128), and the T2.5 script uses `ReplayTransport`.
- **No new dependencies.**

## Design decisions (architect; open to the owner)

- **D1. The rule mirrors the relay, with two deliberate differences.**
  - The unknown state is set **only by `STOPPED`**. The relay sets it on any error reply. Only `STOPPED` says a character arrived while the ELM was busy (§Responses, `STOPPED` row). Other errors (`?`, `CAN ERROR`, `UNABLE TO CONNECT`, `BUFFER FULL`, `DATA ERROR`) come after the ELM has read the whole command. Tracked recordings and fixtures contain `BUFFER FULL`, `UNABLE TO CONNECT`, `CAN ERROR`, `DATA ERROR` and `?`. If those errors set the state, the `STOPPED`-only rule would not be replay-neutral beyond the start of a recording. No recording, tracked or local, contains `STOPPED`.
  - A timeout or failed write keeps its existing **stale-until-`>`** handling and does **not** set the unknown state. The sessions can see a late `>`; the relay cannot.
  - A late or stray `>` never *ends* the unknown state, because it may belong to an earlier command.
- **D2. `runInit` does not loop.** `init()` writes `ATZ` once. It throws `ElmSessionError("init", "ATZ", r)` when the reply is an error (`STOPPED`, `?`). Today it goes on to `ATI` and `ATE0`. The drain after `STOPPED` is general (next point), so a second `init()` by the caller waits for the late `?>` and cannot misread it as its own `ATZ` reply. A loop inside `runInit` would add a retry count and timing policy that nobody asked for.
- **D3. The drain after `STOPPED` is general in `Elm327Session`.** After a `STOPPED` reply, the next `attempt()` first waits up to `RESYNC_MS` for one `>` and discards it. It then writes whether or not a `>` arrived. This differs from stale: the `STOPPED` `>` already showed the ELM is idle, and the second `>` comes only if the rest of the command reached it. The next write is `ATZ` or `ATI` anyway (the unknown state), so a wrong guess costs at most a misread `?`, never hex.
- **D4. The replay exemption is a transport property, not a session option.** `Transport.startsIdle?: boolean` is set to `true` by `ReplayTransport`, and by wrappers that forward a replay. Live transports (BLE, relay) leave it unset. A constructor option would mean editing every replay call site, including `packages/obd-battery/scripts/twelve-volt-report.ts`, which this task may not touch and whose fixture starts with `ATRV`. It would also be easy to pass by mistake in the app. Alternatives are in Q4.
- **D5. `ConsoleSession` exposes the state once:** `get stateUnknown(): boolean`. `runCapture` checks it at the top of the loop. Without the check, a refused command would still be counted as `sent`: `send()` is async, and `sent++` follows the call (`capture.ts:52-54`).

## Interfaces

```ts
// packages/obd-core/src/transport/types.ts
// before
export interface Transport {
  write(bytes: Uint8Array): Promise<void>;
  onData(cb: (bytes: Uint8Array) => void): () => void;
  close(): Promise<void>;
}
// after: one optional member
export interface Transport {
  write(bytes: Uint8Array): Promise<void>;
  onData(cb: (bytes: Uint8Array) => void): () => void;
  close(): Promise<void>;
  /** true only when the far end cannot be mid-command when a session starts (a recording replay).
   *  Unset: the session assumes the ELM may be busy (docs/ELM327.md §Write safety). */
  readonly startsIdle?: boolean;
}

// packages/obd-core/src/transport/replay.ts
export class ReplayTransport implements Transport {
  readonly startsIdle = true; // added; it only answers what is written
  // ...unchanged
}

// packages/obd-core/src/elm/session.ts: public surface unchanged; behavior:
//  - private unknown = transport.startsIdle !== true   (read once in the constructor)
//  - run(): if unknown and normalize(cmd) is not "ATZ"/"ATI" -> throw ElmSessionError("blocked", cmd),
//    checked in queue order before beforeWrite(), so the header state is untouched
//  - after the final attempt's reply: error kind "stopped" -> unknown = true, drain = true;
//    else if norm is "ATZ"/"ATI" and r.kind !== "error" -> unknown = false
//  - attempt(): stale path unchanged; else if drain -> await resync(cmd) (result ignored); drain = false
//  - runInit(): const reset = await this.run("ATZ"); if (reset.kind === "error") throw new ElmSessionError("init", "ATZ", reset);
//    the rest unchanged

// apps/mobile/src/console.ts
// before
export const ALLOWED_AT_COMMANDS: readonly string[] = ["ATZ", "ATE0", "ATL0", "ATS0", "ATH1", "ATSP0", "ATDPN", "ATRV"];
// after (Q2)
export const ALLOWED_AT_COMMANDS: readonly string[] = ["ATZ", "ATI", "ATE0", "ATL0", "ATS0", "ATH1", "ATSP0", "ATDPN", "ATRV"];

export class ConsoleSession {
  /** true until an ATZ or ATI gets a '>'-terminated reply without an error line; true again after a STOPPED reply. */
  get stateUnknown(): boolean;
  // send(): after the closed and stale checks, before recording tx:
  //   unknown and command not "ATZ"/"ATI" -> throw new Error("ELM state unknown; send ATZ or ATI first")
  // finish(): status = parseElmResponse(response, pending.command).status (obd-core/elm, already used by capture.ts);
  //   error kind "stopped" -> unknown = true; else ATZ/ATI with status.kind !== "error" -> unknown = false.
  //   The onData path for a '>' with nothing pending does NOT touch unknown.
}

// apps/mobile/src/capture.ts, runCapture loop top, after the closed check and before step++:
//   if (session.stateUnknown && command !== "ATZ" && command !== "ATI") { stoppedEarly = "ELM state unknown; send ATZ or ATI first"; break; }
// The meta line then reads "capture stopped at step <n> (<the command that left it unknown>): ELM state unknown; ...".
```

## Files

Thirteen files, so the task is split. **Stage A goes first.** Stage B needs A's `Transport.startsIdle`.

### Stage A: `obd-core` (8 files)
- `packages/obd-core/src/transport/types.ts`: modify. Add the optional `startsIdle`.
- `packages/obd-core/src/transport/replay.ts`: modify. `readonly startsIdle = true`.
- `packages/obd-core/src/elm/session.ts`: modify. Unknown state, drain after `STOPPED`, `runInit` requires a clean `ATZ`.
- `packages/obd-core/src/elm/guard.ts`: modify, **comment only** (follow-up 6). Rewrap the `READ_LENGTHS` comment so that no line is longer than 120 characters (line 16 is 131 today). The wording and examples stay.
- `packages/obd-core/scripts/profile-scan-replay.ts`: modify. The wrapper transport forwards `startsIdle: true`. It wraps a `ReplayTransport`, and its first tx is `ATSP7`.
- `packages/obd-core/test/session.test.ts`: modify.
  - `ScriptedTransport` gains a constructor parameter `startsIdle = true`, exposed as `readonly startsIdle: boolean`. Existing tests keep their assertions.
  - `runEquinox` wraps `ReplayTransport` in a transport without `startsIdle` (E2E A2).
  - Add the isolated tests F1–F7.
- `packages/obd-core/test/profile-scan.test.ts`: modify. The two object-literal transports declare `startsIdle: true`. The setup-failure test replays a fixture whose first tx is `ATSP7`, and the invalid-profile tests must keep failing on profile validation, not on the new rule.
- `docs/ARCHITECTURE.md`: modify. Add the `Transport` member to "Core interfaces". The `Elm327Session` `send` comment gains "a fresh session sends only ATZ/ATI until a clean reply".

### Stage B: app and docs (5 files)
- `apps/mobile/src/console.ts`: modify. Add `ATI` to the allowlist, the unknown state, `stateUnknown`, and the message.
- `apps/mobile/src/capture.ts`: modify. The loop-top stop (D5).
- `apps/mobile/test/console-recording.test.ts`: modify.
  - `FakeTransport` gains a public `startsIdle = true`, which new tests set to `false` before constructing the session.
  - The allowlist assertion includes `ATI`, and `"ATI"` leaves the `rejected` list. Both are expected changes (Q2).
  - Add tests C1–C4.
- `apps/mobile/test/capture.test.ts`: modify. Add test C5. The existing `ScriptedTransport` has no `startsIdle`, so C1–C7 already run under the new rule. They must pass unchanged.
- `docs/ELM327.md`: modify. The §Responses `STOPPED` row, plus §Write safety (text below). **Last step of the task.**

`apps/mobile/test/codes-scan.test.ts` is **not** modified. Its `RecordingAnswerTransport` has no `startsIdle`, so it is the app E2E under the new rule.

### `docs/ELM327.md` text (Stage B)

1. §Responses, `STOPPED` row, Handling cell. Replace "our bug: the queue let two commands overlap" with: "a byte reached a busy ELM: after an app restart or reconnect, or our bug (overlapping commands). The sessions then write only `ATZ` or `ATI` until one is answered cleanly (§Write safety)."
2. §Write safety, **Input rules**. After the bullet that ends "…until a `>` arrives." (line 132), add two bullets:
   - "A new `Elm327Session` or app `ConsoleSession` cannot tell whether the ELM is idle. After an app restart or a reconnect it may still be running the last command or the reset. So a fresh session writes only `ATZ` or `ATI` until one of them gets a `>`-terminated reply without an error line. Everything else is refused before a byte is written: `blocked` in `Elm327Session`, "ELM state unknown; send ATZ or ATI first" in the console. A late `>` does not end this state, because it may belong to an earlier command. A `STOPPED` reply to any command starts it again. `pnpm replay` is exempt: `ReplayTransport` answers only what is written and declares `startsIdle`."
   - "After `STOPPED`, the part of the command that reached the ELM may still be answered with a second `>` (DS p.9, p.48). Before its next write, `Elm327Session` waits up to `RESYNC_MS` for it. `init()` fails with `init` on `ATZ` unless `ATZ` is answered cleanly. So `ATE0` is never written after an unconfirmed reset (two drops would leave `E0`, a hex byte the ELM would send as a request)."
3. §Write safety, **What the length rule does not do.** Replace the paragraph and its bullets (lines 138–146) with:

   > **What the length rule does not do.** Characters dropped at the start of a request (DS p.9, p.48) do not stop the ELM from sending the rest. Whatever the number of drops, the remaining characters pair up into bytes from the left, and an odd one left over is read as the maximum number of responses to wait for, the count digit (DS p.32; write-safety review round 3, finding 2). The datasheet does not bound the number of drops (relay bullet above). Examples use requests our tools send and the recorded Equinox DIDs (`packages/obd-core/vehicles/chevrolet-equinox-ev/default.json`; spike lines 144, 152, 156, 162):
   > - One drop. A 4-character request leaves one byte plus a count digit: `0140`, which the codes flow sends, leaves `14` with count digit `0`; `0111` leaves `11` with count digit `1`. A 6-character request leaves two bytes plus a count digit: `22 33E5` → `23 3E` with count digit `5`; `22 27C6`, `22 2AF5`, `22 2B43` → `22` with a one-byte DID (`7C`, `AF`, `B4`); `02 90 00` → `29 00` with count digit `0`. A 2-character request leaves a lone digit (`03` → `3`).
   > - Two drops. A 4-character request leaves its PID as a whole byte: `0131`, which the codes flow sends, → `31` (RoutineControl); `0111` → `11`. A 6-character request leaves its last two bytes, so `22 <DID>` leaves the DID: `22 27C6` → `27 C6`, `22 2AF5` → `2A F5`, `22 2B43` → `2B 43`, `22 33E5` → `33 E5`; `02 90 00` → `90 00`.
   > - Three drops leave a 4-character request as a lone digit.
   > - Several leftover first bytes are refused services: `11`, `14`, `23`, `27`, `29`, `2A`, `31`. The length rule only limits them to one or two bytes.
   > - Unverified: DS p.32 does not say what a count digit of `0` does, or what a lone digit with no request bytes does. So the cases left with a count digit of `0` (`0140`, `02 90 00` after one drop) and the lone-digit cases are unverified. The others follow from DS p.9 and p.32.
   > - What prevents the drop is that nothing is written into an ELM that may be busy. That covers the stale-until-prompt rule and the fresh-session rule above, which apply to `Elm327Session` and the app `ConsoleSession`, and the relay's `ATI`/`ATZ`-only rule. `ATZ` and `ATI` leave no hex after any number of drops (relay bullet). What remains: if all three letters drop, a bare CR is left, and the ELM repeats its previous command (Input rules, first bullet). That command came from a guarded writer or from an earlier leftover. Unverified.
   > - It is unverified whether an ECU acts on such a request. Do not test it on a car.

   Deviation from follow-up 1, stated so the reviewer can check it: the hypothetical `22 701x` → `27 01` and `22 C03x` → `2C 03` examples are replaced by recorded DIDs, so `2C` leaves the refused-leftover list and `23` and `2A` join it. Follow-ups 2 (the one general sentence), 3 ("count digit of `0`"), 4 (`init()`, `E0`), and 5 (the app `ConsoleSession` in the gap sentence) are covered by points 2 and 3 above. Follow-up 6 is the `guard.ts` rewrap.

## Sources

| Constant / behavior | Source |
|---|---|
| A character reaching a busy ELM interrupts it, is discarded, and `STOPPED` is printed | docs/ELM327.md §Framing last bullet; §Write safety Input rules (DS p.9, p.48); §Responses `STOPPED` row |
| `ATZ`/`ATI` leave no hex after any number of drops; the drop count is unbounded | docs/ELM327.md §Write safety, relay bullet (DS pp.8–9) |
| The rule being mirrored | `tools/relay/broker.ts:85` (refusal while not idle), `:138` (`idle = kind !== "error"`); citations corrected 2026-09-24 (Stage A review finding 3) |
| A bare CR repeats the previous command (residual) | docs/ELM327.md §Write safety Input rules, first bullet (DS p.9, p.12) |
| Count digit, pairing of leftover characters | docs/ELM327.md §Write safety "What the length rule does not do" (DS p.32) |
| An `ATZ` answered with an error resets nothing | docs/ELM327.md §Write safety Input rules; `guard.ts` `afterReply` |
| The banner reply to `ATZ` is `data`, not an error | spike L2–5; phone-console L3–6 (the codes scan already stops on `ATZ` ≠ `data`, `codesScan.ts:17`) |
| `ATI` is an allowed AT command | docs/ELM327.md §Write safety "AT commands allowed"; spike L6 |
| Recorded Equinox DIDs `33E5` (`DA1D`), `27C6`, `2AF5`, `2B43` (`DACB`) | `packages/obd-core/vehicles/chevrolet-equinox-ev/default.json` lines 2, 6, 10, 16; `2026-09-22-spike.redacted.jsonl` and `-spike-2.redacted.jsonl` L144, L152, L156, L162 |
| Service names `23` ReadMemoryByAddress, `2A` ReadDataByPeriodicIdentifier, `27`, `29`, `31`, `11`, `14` | docs/ELM327.md §Write safety table |
| `RESYNC_MS` = 1000 (policy, not an ELM constant) | `packages/obd-core/src/elm/session.ts:72` |
| A second `>` after `STOPPED` | Inferred from DS p.9, p.48 (only the interrupting character is discarded). **Not recorded:** no tracked or local recording contains `STOPPED`. The drain is defensive. If no second `>` comes, it costs `RESYNC_MS` and nothing else. |
| Replay has no busy state | `packages/obd-core/src/transport/replay.ts` `write()`: rx is delivered only after a matching tx |
| First tx of each replayed file (whether the exemption is needed) | Checked 2026-09-24. `ATZ`: every tracked recording, `elm-framing`, `session-branches`. **Not `ATZ`/`ATI`:** `codes-cleared` `0100`, `codes-conflict` `0100`, `codes-permanent` `0100`, `codes-stored` `0101`, `standard-decoding` `0101`, `profile-setup-failure` `ATSP7`, `twelve-volt-vpwr` (Codex, untracked) `ATRV`. The two profile-scan tails start at `ATSP7`. All of these go through `ReplayTransport` (or a wrapper that forwards `startsIdle`), so their output does not change. |

## Verification

Baseline first, before any edit, into the session scratchpad (`$S`):

```
for f in fixtures/recordings/chevrolet-equinox-ev-2024/*.redacted.jsonl fixtures/synthetic/*.jsonl; do
  pnpm -s replay "$f" > "$S/before/$(basename "$f").out" 2> "$S/before/$(basename "$f").err"; echo "$? $f"; done
for f in fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike{,-2}.redacted.jsonl; do
  node --import tsx packages/obd-core/scripts/profile-scan-replay.ts "$f" > "$S/before/scan-$(basename "$f").out"; done
```

### E2E

- [ ] **A1 replay unchanged.** Re-run both loops above into `$S/after`. Then `diff -r $S/before $S/after` must be empty: stdout, stderr and exit codes for the 3 tracked recordings, all 9 synthetic fixtures (`twelve-volt-vpwr.jsonl` included, read-only), and both profile-scan tails. Optional, as in T0.7 A1: the local gitignored `2026-09-22-spike.jsonl`, `-spike-2.jsonl`, `2026-09-24-phone-console.jsonl`, `2026-09-23-discovery-targeted.jsonl`, compared by exit code and line/byte counts only. The full `2026-09-23-discovery.jsonl` (~1.5 h) is NOT RUN.
- [ ] **A1 artifact unchanged.** `pnpm -s codes-report fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike-2.redacted.jsonl fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-24-phone-console.redacted.jsonl fixtures/synthetic/codes-cleared.jsonl fixtures/synthetic/codes-permanent.jsonl fixtures/synthetic/codes-stored.jsonl fixtures/synthetic/codes-conflict.jsonl | diff - packages/obd-core/test/codes-reports.md` is empty.
- [ ] **A2 live-like init.** `session.test.ts`: `runEquinox` now wraps `ReplayTransport` in a transport **without** `startsIdle`. Both spike recordings still pass "init and every following tx replay byte for byte", with the same assertions. This shows the fresh-session rule lets the real init sequence through. `replayRecording` VIN test: unchanged.
- [ ] **B1 app E2E.** `apps/mobile/test/codes-scan.test.ts` passes **unmodified**: "matches the T0.7 artifact block" for the spike and phone recordings, and failures 1–5. Its transport has no `startsIdle`, so every scan runs from the unknown state. `capture.test.ts` C1–C7 pass unmodified.
- [ ] `pnpm check` green after each stage. `git diff --check` clean. Purity grep on `packages/obd-core/src` is unchanged (no new imports).

### Isolated tests: failure modes, listed before any code

`Elm327Session` (`session.test.ts`; the transport is `ScriptedTransport` with `startsIdle` false unless stated):

1. **A fresh session writes something other than `ATZ`/`ATI`.** Test F1: each of `0131`, `22 33E5`, `ATE0`, `ATSP7` rejects `{kind:"blocked"}`, and `transport.writes` is `[]`. Then `ATZ` (banner reply) is written, and `0131` after it: writes `["ATZ","0131"]`. It also catches a session that treats a missing `startsIdle` as idle.
2. **The rule is checked when `send()` is called, not in queue order.** Test F2: the session is known after a clean `ATZ`. `send("0100")` (reply `STOPPED\r\r>`) and `send("0101")` are called without awaiting. `0101` rejects `blocked`, and writes end at `0100`.
3. **An error reply to `ATZ` or `ATI` ends the unknown state.** Test F3, `it.each` over `ATZ`/`ATI` answered `?\r\r>`: the next `send("0100")` rejects `blocked` and is not written.
4. **A late `>` ends the unknown state.** Test F4 (fake timers): `ATZ` times out (`timeoutMs: 50`), then the banner is emitted. `send("ATE0")` rejects `blocked` with no write. `send("ATI")` (clean) is written, and then `ATE0` is too.
5. **`STOPPED` in a known state does not restart the unknown state.** Test F5 (awaited): after a clean `ATZ`, `0100` → `STOPPED`. `send("0101")` rejects `blocked`. `send("ATI")` is written.
6. **After `STOPPED` the next write does not wait for the second `>`, so the stray reply is taken as its own.** Test F6 (fake timers):
   - `0100` → `STOPPED` (known session). Then `send("ATI")`: no write happens before `RESYNC_MS − 1`.
   - Emit `?\r\r>`. `ATI` is written, and its response `lines` equal `["ELM327 v1.5"]`.
   - Second case: with no stray, `ATI` is written at `RESYNC_MS`.
7. **`init()` goes past an `ATZ` answered with an error.** Test F7 (fake timers):
   - The fresh session's first `init(genericProfile)` has `ATZ` → `STOPPED\r\r>`. It rejects `{kind:"init", command:"ATZ"}`, and writes are `["ATZ"]`.
   - Set the `ATZ` reply to the banner and call `init()` again. While it waits (no write yet), emit `?\r\r>`. The stray is consumed, the second `init()` resolves `{protocol:"0"}`, and writes start `["ATZ","ATZ","ATI","ATE0"]`.
   - Also covers follow-up 4 (`ATE0` → `E0`).

`ConsoleSession` and capture (`console-recording.test.ts`, `capture.test.ts`; `FakeTransport.startsIdle = false`):

8. **A fresh console writes something other than `ATZ`/`ATI`.** Test C1: `send("0100")` rejects with the exact message `ELM state unknown; send ATZ or ATI first`. `transport.writes` is `[]`, and the recording holds only the meta line. `stateUnknown` is `true`. `send("ATI")` with reply `ELM327 v1.5\r\r>` is written, and `stateUnknown` is `false`.
9. **An error reply to `ATZ`/`ATI` ends the console's unknown state.** Test C2: `ATZ` answered `?\r\r>`, then `send("0100")` rejects with the message and nothing is written.
10. **A late `>` after a timeout ends the console's unknown state.** Test C3 (fake timers): `ATZ` times out, then `\r\rELM327 v1.5\r\r>` arrives late. `stateUnknown` stays `true`, and `send("ATE0")` rejects with the message.
11. **`STOPPED` in a known console does not restart the unknown state.** Test C4: after a clean `ATZ`, `0100` → `STOPPED\r\r>`. `stateUnknown` is `true`, and `send("0101")` rejects with the message.
12. **Capture keeps going, counting refused commands as sent, after the console is left unknown.** Test C5: `setup({ ATZ: ["?\r\r>"] })`, plain capture. The result is `{sent:1, total:10, stoppedEarly:"ELM state unknown; send ATZ or ATI first"}`, `transport.writes` is `["ATZ\r"]`, and the last meta is `capture stopped at step 1 (ATZ): ELM state unknown; send ATZ or ATI first`.

Mutations the implementer runs and records, each reverted with `cmp` clean:
- session: the unknown check moved into `send()`, which F2 must catch;
- session: `unknown = false` on any `>`, which F4 must catch;
- session: the drain removed, which F6 must catch;
- session: `runInit` ignores the `ATZ` kind, which F7 must catch;
- console: `unknown = false` in the no-pending `onData` branch, which C3 must catch;
- capture: the loop-top check removed, which C5 must catch.

Expected changes, and nothing else: the console allowlist assertion gains `ATI`, and `"ATI"` leaves the console `rejected` list. `ScriptedTransport`, `FakeTransport`, and the two profile-scan literals gain `startsIdle`. `runEquinox` wraps its transport.

### Hardware (optional; not required for done)

The rule does not depend on the transport, and fixtures cover it fully. The optional check is in the phone app, with the dongle in the Equinox (Ready, Park):
1. Connect.
2. First console command `0100`. Expect `Command error: ELM state unknown; send ATZ or ATI first`, with no tx line.
3. `ATI`. Expect the version.
4. `0100`. Expect data.

Export to `fixtures/recordings/chevrolet-equinox-ev-2024/<date>-first-write.jsonl` and commit only the `.redacted.jsonl`. **Do not** provoke `STOPPED` or a busy ELM on the car. If the check is not run, report it as NOT RUN, with the reason "optional; no car session".

## Risks / open questions

- **Q1. Error kind for the refusal in `Elm327Session`.** The recommendation is to reuse `blocked`, which is the guard's refusal and is also checked in queue order (like `beforeWrite`). The message names the command. A new `"unknown-state"` kind would change the public `SessionErrorKind` union and `docs/ARCHITECTURE.md` for a distinction no current caller needs.
- **Q2. Add `ATI` to the app console allowlist.** Recommendation: yes. It is sourced (§Write safety, spike L6). It lets the user end the unknown state without resetting the dongle, and it makes "send ATZ or ATI first" true. The alternative is to keep the list and say "send ATZ first".
- **Q3. `LV RESET`.** It means the dongle reset itself (§Responses: "re-init"). The recommendation is to leave it out of this task. It is not a dropped-character case, and no recording has it. It could be added later with one token in each session.
- **Q4. Replay exemption mechanism.** Recommendation: the optional `Transport.startsIdle` (D4). It is an additive change to a "Core interfaces" shape that `docs/ARCHITECTURE.md` says the architect may adjust. The alternatives:
  - an `Elm327Session` constructor option: it breaks Codex's `twelve-volt-report.ts` until Codex edits it;
  - `transport instanceof ReplayTransport`: it misses the wrappers in `profile-scan-replay.ts` and the tests.
- **Q5. `init()` now fails on an `ATZ` answered with an error** (D2). Today it continues. No tracked recording or fixture has an `ATZ` error, and no caller relies on it. The recommendation is to accept the change. The alternative is one automatic `ATZ` retry after the drain, a few more lines and a retry policy.
- **Risk: bare-CR residual.** If `A`, `T` and `Z` all drop, the ELM gets a bare CR and repeats its previous command. The relay has the same residual. It is documented in §Write safety and unverified. Nothing in software can close it without a reply from the ELM, and it must not be tested on a car.
- **Risk: the drain guess.** If a second `>` after `STOPPED` arrives later than `RESYNC_MS`, it lands on the next `ATZ`/`ATI` and makes it look like an error. The session stays unknown and refuses everything but `ATZ`/`ATI`. That is safe, and the user can try again.
- **Risk: Codex T2.5 overlap.** None expected. `packages/obd-battery` constructs `Elm327Session(new ReplayTransport(...))`, which is exempt. If Codex adds a live-transport caller, it must start with `init()` or `ATZ`.

## Decisions

Orchestrator, 2026-09-24, under the owner's standing delegation: Q1 yes (reuse `blocked`); Q2 yes (add `ATI` to the console allowlist); Q3 yes (`LV RESET` out of scope); Q4 optional `Transport.startsIdle`; Q5 accepted (`init()` fails on an `ATZ` error). Also accepted: the doc deviation (recorded DIDs replace the made-up ones, so `2C` leaves the list and `23`/`2A` join), and the documented, unverified residual that a bare CR repeats the previous command if all of `ATZ` drops.

Stage A review round 1 (orchestrator, 2026-09-24):
- Finding 1 (blocking): F1 gains a case over a transport with **no** `startsIdle` member, asserting `blocked` and zero writes. Mutation `this.unknown = transport.startsIdle === false` must fail it.
- Finding 2 (minor, recorded, no change): `parseElmResponse` classifies only the first error line, so `<DATA ERROR` then `STOPPED` is treated as a data error (no unknown state, and a retry with no drain). This is only possible on the known-session overlap path. Follow-up note for the next session-policy task.
- Finding 3: stale broker.ts citations corrected above.
