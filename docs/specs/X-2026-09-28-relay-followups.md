# X-2026-09-28-relay-followups: deferred T0.6 relay follow-ups

## Goal

Close the five small follow-ups left open by T0.6a and T0.6b (`docs/task-runs/T0.6.md` Current state, "Open follow-ups" and the round-3 review minors; `docs/specs/T0.6b-android-relay-mode.md` "Notes for a separate task"). What a test or reader sees when done:

1. `pnpm hil:smoke` (`tools/relay/hil-smoke.ts` `main`) fails with `relay: disconnected` when the phone disconnects after the last reply but before the recording is stopped, not with `relay: no recording active`. It never reports PASS in that case.
2. The relay broker treats a whitespace-only `OBD_RELAY_TOKEN` as unset, the same way it treats an empty one. A phone presenting that whitespace cannot connect.
3. `docs/ELM327.md` §Write safety states the documented model: the ELM discards one character, the one that interrupted it. `ATI`/`ATZ` are the margin for a second drop. The text no longer rests the relay rule on "not bounded".
4. The `docs/ELM327.md` §Write safety Mode 04 table row describes the confirmation UI that shipped in T0.6b (`2c81845`). It no longer says the UI "is not built yet".
5. `parseRelayAddress` rejects userinfo without a password (`ws://user@host:8765`), and the test now exercises that case. The screen clears a rejected paste that contains `@`. The parser rejects `ws://host:8765phone`.

## Non-goals

- Changing hil-smoke's command sequence, its replay comparison, or the broker's disconnect or recording semantics.
- Failing startup on a bad token, trimming a token that has real characters around whitespace, or any other token-policy change.
- Rewriting the "What the length rule does not do" drop examples. They stay as margin analysis. Only the sentence that points back to the relay bullet changes (see Design 3).
- New datasheet claims. The wording cites only DS p.9 and p.48, and DS pp.8–9 as `docs/ELM327.md` already uses them.
- Editing the closed T0.6b spec's failure list (items 10–16). This spec owns the three new parser failures below.
- The expo-doctor baseline findings, release-build relay exposure, `ConsoleScreen.tsx` changes (it already honours `clearAddress`), and the T0.6 hardware gate.
- Any edit under `docs/task-runs/`.

## Interfaces

No public signature changes. `main(broker?)` in `hil-smoke.ts`, the `RelayBroker` constructor, and `parseRelayAddress(input, tokenField): RelayAddress` keep their current types.

## Design

1. **hil-smoke final stop.** Wrap the final `await broker.stopRecording()` so that a rejection while `!broker.isConnected()` throws `new Error("relay: disconnected")`. Any other rejection is rethrown unchanged. The `finally { await broker.close(); }` still runs, and the prompt/`4100` checks and the replay comparison are still never reached on this path, so nothing is printed to stdout. No retry and no PASS. The broker's disconnect path already wrote the `phone relay: disconnected` meta and ended the recording (`broker.ts` `disconnect` → `endRecording`). The raw file stays on disk, as in the mid-sequence case.
2. **Whitespace token.** In the `RelayBroker` constructor, a configured `OBD_RELAY_TOKEN` whose `.trim()` is `""` is unset, so the broker falls back to the injected token or a random one. Update the existing comment to say "empty or whitespace-only". A non-blank value is still used exactly as given.
3. **ELM327.md write-safety wording.** In the last Input-rules bullet (the relay bullet), replace "the datasheet does not bound how many characters are dropped, and neither command leaves hex behind" with wording that:
   - says the datasheet describes one discarded character, the one that interrupted the busy ELM (DS p.9, p.48), and that this is the model the rule is built on;
   - says `ATI`/`ATZ` are the margin for a second drop: two drops leave `I` or `Z`, which is still not hex, and no number of drops leaves hex behind (the three-drop bare CR case is covered in "What the length rule does not do").
   
   In "What the length rule does not do", change "The datasheet does not bound the number of drops (relay bullet above)" to say the examples go past the documented single drop as margin (relay bullet above). No other text changes.
4. **ELM327.md Mode 04 row.** Replace "the confirmation UI is T0.6b and is not built yet" with what exists. The phone relay client (`apps/mobile/src/relay/RelayClient.ts`, T0.6b, development builds only) checks the command again and asks for a fresh per-request native alert (`apps/mobile/src/screens/ConsoleScreen.tsx` `confirmMode04`). Cancel, back or a tap outside denies it, returns `confirmation-denied`, and writes nothing to BLE. A real approval has not been exercised on a car (T0.6b Decisions: denial is the physical check).
5. **Address parser.**
   - Path: the phone path must be introduced by `/`. Accepted suffixes after `host:port` are: nothing, `/`, `/phone`, `/phone/`, each optionally followed by `?query`, and a bare `?query` directly after the port, as today. For example the pattern fragment `(?:\/(?:phone\/?)?)?` replaces `\/?(?:phone\/?)?`.
   - Clearing: the `clearAddress` test also matches `@`, i.e. `/[?#@]|token=/i`. Update the function comment to match.
   - The host class `[^/?#\s:@]` is unchanged.

## Files

- `tools/relay/hil-smoke.ts`: modify. Map a post-disconnect final-stop rejection to `relay: disconnected`.
- `tools/relay/broker.ts`: modify. Treat a whitespace-only `OBD_RELAY_TOKEN` as unset.
- `tools/relay/server.test.ts`: modify. Add one hil-smoke case and extend the empty-token case to whitespace.
- `apps/mobile/src/relay/parseRelayAddress.ts`: modify. Require `/` before `phone`, and clear on `@`.
- `apps/mobile/test/relay.test.ts`: modify. Change the item-11 input and add two parser cases.
- `docs/ELM327.md`: modify. Update the relay bullet, the one length-rule sentence, and the Mode 04 row.

## Sources

| Constant / behavior | Source |
|---|---|
| A busy ELM discards the character that interrupted it; prints `STOPPED` | docs/ELM327.md §Write safety, Input rules (DS p.9, p.48); §Responses `STOPPED` row |
| `TI`/`TZ` (and `I`/`Z`) are answered `?` and not acted on; not hex | docs/ELM327.md §Write safety relay bullet (DS pp.8–9); T0.6a spec Amendment item 6 |
| ATI/ATZ chosen as margin for a second drop (`ATE0` → `E0` after two) | docs/specs/T0.6a-node-relay-mcp.md Amendment item 6; docs/task-runs/T0.6.md Decisions line |
| Three drops leave a bare CR that repeats the previous command | docs/ELM327.md §Write safety, "What the length rule does not do" (DS p.9, p.12) |
| Mode 04 on-phone confirmation behaviour | apps/mobile/src/screens/ConsoleScreen.tsx `confirmMode04`; apps/mobile/src/relay/RelayClient.ts; T0.6b spec Decisions (`__DEV__` only; denial is the physical check) |
| Broker disconnect ends the recording with `phone relay: disconnected` meta | tools/relay/broker.ts `disconnect`/`endRecording`; existing test "appends the disconnect meta before the pending call rejects" |
| Empty-token rule | docs/specs/T0.6a-node-relay-mcp.md fix-round item 1 |
| hil-smoke command sequence (unchanged) | fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-24-phone-console.redacted.jsonl lines 3–37, as cited in hil-smoke.ts |

No new OBD PID, AT command, header or DTC format is introduced.

## Verification

Shared checks: `pnpm check` green; `git diff --check` clean; no new dependencies; nothing under `fixtures/recordings/` or `docs/task-runs/` touched.

Isolated tests, failure modes listed first. The hil-smoke and token cases go through the public entry points (`main(broker)` with the fake phone; the WebSocket upgrade), as the existing tests do.

1. A disconnect after the last reply and before the final stop reports `relay: no recording active` instead of the cause. Test `hil:smoke reports a disconnect after the last reply as a disconnect`: drive `main(broker)` with the existing fake phone through all seven commands with the fixture's replies. Make the window deterministic by wrapping `broker.stopRecording` in the test so that its first call closes the fake phone, waits for `!broker.isConnected()`, then delegates. Assert `run` rejects with `relay: disconnected` and not with `no recording active`, and `broker.port()` is `undefined` (closed). The raw recording's last line is `{ dir: "meta", note: "phone relay: disconnected" }`, preceded by 7 tx/rx pairs.
2. The fix turns that case into PASS (resolves or prints the success lines). Covered by the same test: `run` must reject. The test also captures `process.stdout.write` and asserts no `Replay matched live response.` line.
3. A whitespace-only `OBD_RELAY_TOKEN` becomes the token. Extend `treats an empty OBD_RELAY_TOKEN as unset` to `it.each(["", "   ", "\t"])`. `broker.token.trim()` is non-empty, and `rejectedSocket(broker, value)` is refused.
4. The `@` exclusion regresses unseen (the item-11 input is also rejected by `:`). Change the input in `rejects userinfo before the host` to `ws://user@host:8765` and assert `ok: false`.
5. A rejected paste with password-free userinfo leaves it on screen. Add a case to `clears the address field when a rejected paste contains a token`: `parseRelayAddress("ws://secret@host:8765x", "tok")` equals `{ ok: false, clearAddress: true }`.
6. `ws://host:8765phone` is accepted. New test `requires / before phone`: it is `ok: false`. `ws://host:8765/phone` with token `tok` still equals `{ ok: true, base: "ws://host:8765", token: "tok" }`.

Regression and artifacts:
- [ ] `pnpm exec vitest run tools/relay/server.test.ts` passes. This includes the unchanged "hil:smoke reports a mid-sequence disconnect…" test and every T1–T7 guard test. The reviewer reads the new test's recording assertions as the artifact.
- [ ] `pnpm -F mobile test` passes. The relay E2E artifact that `relay.test.ts` writes is still produced, its content is unchanged in meaning (`contains4100: true`, `tokenOnWire: false`, token absent), and the existing parser tests (items 10–16) still pass.
- [ ] Doc check (reviewer reads it): the relay bullet names DS p.9/p.48 for the one-character model and states `ATI`/`ATZ` as the margin for a second drop. No "does not bound" wording remains in §Write safety. The Mode 04 row names `RelayClient.ts`/`confirmMode04`, "development builds only", and "approval not exercised on a car". No new DS page citations appear.
- [ ] Hardware: **not needed** for this task. The T0.6 hardware gate (T0.6b hardware steps 1–5) stays separate and NOT RUN. If the case in item 1 happens there, the result is a FAIL to rerun, as before.

## Risks / open questions

- Wrapping `stopRecording` in the test is a test-only seam. It is the only deterministic way into the window: 40 loopback runs never reproduced it (T0.6.md). The reviewer should confirm the wrapper delegates to the real method, so the broker's own "no recording active" path is what gets mapped.
- Treating the item-1 case as FAIL rather than PASS is deliberate. The recording ended by disconnect, not by a clean stop, and the owner's standing instruction for the hardware gate is "rerun, do not count as PASS" (T0.6b Notes). No owner question.
- Open questions: none.

## Decisions

(none yet)
