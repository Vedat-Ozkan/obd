# 2024 Equinox EV OBDb verification (T2.2)

This is the owner run card and evidence worksheet for [T2.2a](specs/T2.2a-equinox-soc-evidence.md) and [T2.2b](specs/T2.2b-equinox-car-validation.md). The current car evidence is two committed, redacted September 22 spike recordings. Their notes say the dashboard showed **70% SOC** in Ready/Park. T2.2a replay decodes `CB/27C6` as 69.6147% and `CB/2B43` as 69.8039% in both recordings, both of which round to 70%. The three `2AF5` cell-voltage readings have no dashboard counterpart and remain `community`.

## What the owner needs to do at the car

Use the **laptop and Veepeak OBDCheck BLE** that produced the first spike. The current phone debug console cannot send the Equinox `ATSP7`/module-header/flow-control setup, and its **Run capture** button does not read Mode 22. A phone-console file would not satisfy this check.

### Before leaving the desk

1. On the laptop, get the pushed repository state with `tools/spike/go.py`, `spike.py`, and `redact_vin.py`; run commands below from the repository root. Run `uv run tools/spike/spike.py --help` once at the desk to confirm `uv` works and fetch `bleak` before going to the car. `go.py` is an interactive launcher and has no `--help` option.
2. Use a vehicle SOC visibly different from the earlier **70%** if practical (for example after ordinary charging or driving; about 5–10 displayed percentage points gives a clear comparison). No special charge session is required. If the dash is still about 70%, keep the capture, but the different-SOC check remains **NOT RUN** until a later capture.
3. Charge the laptop. If the Veepeak is paired in the laptop's Bluetooth settings, remove that pairing; the script discovers it itself. Ensure the laptop can stay near the parked car for about **1–3 minutes** per run.

### Capture, parked

1. Park safely, apply the parking brake, and put the 2024 Equinox EV in **Ready/Park**. Plug in the Veepeak. Read and write down the **dash battery percentage**, local clock time, ambient temperature, and whether the vehicle is charging or unplugged. Do not use the laptop while driving. The script asks for SOC and ambient and includes them in the recording's first meta note; keep the other observations in the worksheet below.
2. From the repo root run:

   ```sh
   uv run tools/spike/go.py
   ```

   At “Which car [3]”, press Enter for Equinox. Enter the dash battery percent and outside temperature when prompted. If more than one BLE device appears, choose the Veepeak's number. The script announces a **new** path such as `fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-24-spike.jsonl` or `2026-09-24-spike-2.jsonl`; copy that exact filename into the worksheet. Never choose an existing path or edit the file. It sends the fixed standard and four OBDb reads, and prints rows as they finish. Expect roughly 1–3 minutes; a response to `22 27C6`, `22 2AF5`, and `22 2B43` is the relevant battery evidence. Record `NO DATA` or error exactly if a command does not answer.
3. If the run times out or the BLE link drops, keep the partial original and rerun `uv run tools/spike/go.py`, which chooses another filename. Do not merge the files. Note which commands failed. At the end unplug the dongle to avoid 12 V drain.
4. A second capture after a normal SOC change can add a second state. Take a fresh dash/time/state note and run the same command again. A charge while parked is fine; **do not** handle the laptop or dongle while moving. There is no requirement to change the car's state during one fixed scan.

### Redact and hand off

1. On the laptop, use the **exact raw path that `go.py` printed**. The following is a template; substitute its actual filename:

   ```sh
   uv run tools/spike/redact_vin.py "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-24-spike.jsonl"
   ```

   Replace the example date and suffix with the exact printed path. The tool writes a *separate* `.redacted.jsonl` copy, prints its SHA-256 and a mask summary, and refuses to overwrite. Keep the original untouched and local. If redaction refuses, stop the handoff and report the error; never send the original.
2. From the repo root, replay **only the redacted copy**:

   ```sh
   pnpm replay "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-24-spike.redacted.jsonl"
   ```

   Replace the example date and suffix with the redactor's actual output path. If the `pnpm replay` wrapper hits the known `tsx` IPC `EPERM` in this environment, use the same script with `node --import tsx packages/obd-core/scripts/replay.ts "<actual redacted path>"`. The replay must show the three `DACB` reads, their decoded values when the car answers, and a summary; `33E5` may still say `nodata`.
3. Send back the **redacted path or redacted file only**, its SHA-256, the dash SOC/local time/Ready-Park/charging note, and any error rows. The reviewer will fill line numbers, compare readings, rerun replay, and decide individual tiers. Do not share the raw file, VIN, plate, or a dashboard photo containing identifiers. Only the tool-produced `.redacted.jsonl` copy may be committed under `fixtures/recordings/` (ADR-017). If the raw original lives on a different laptop, copy the original to a local private location for redaction; do not put it in a public issue, PR, or chat.

## Evidence worksheet

`PASS` means the stated observation and recording support the signal at the claimed precision. `FAIL` means the observation contradicts it. `NOT RUN` means the needed capture or reference is absent. A positive ECU reply alone is not a plausibility check (`docs/EVAL.md`). The first two rows record T2.2a replay agreement at dashboard display precision. Independent review and a different-SOC car session remain pending.

| Signal / source | September 22 at dash 70% | New run at different SOC | Verification criterion | Status / tier |
|---|---|---|---|---|
| `EQUINOXEV_SOC_HD`, `CB/27C6` | Both spikes: 69.6147%, rounds to recorded dash 70% | NOT RUN | Same-session dash integer agrees after rounding; repeat at a distinct displayed SOC | PASS at 70% display precision / `verified` overlay; distinct-SOC check pending |
| `EQUINOXEV_SOC`, `CB/2B43` | Both spikes: 69.8039%, rounds to recorded dash 70% | NOT RUN | Same-session dash integer agrees after rounding; repeat at a distinct displayed SOC | PASS at 70% display precision / `verified` overlay; distinct-SOC check pending |
| `EQUINOXEV_HVBAT_C_V_AVG`, `CB/2AF5` | ≈3.9297 V first spike; ≈3.9288 V second | NOT RUN | Independent cell-voltage reference or sourced same-session group data, plus plausible state behavior; dash SOC is not a voltage reference | NOT RUN / `community` |
| `EQUINOXEV_HVBAT_C_V_MIN`, `CB/2AF5` | ≈3.9287 V first; ≈3.9278 V second | NOT RUN | Same independent cell reference; min≤avg is only an internal consistency check | NOT RUN / `community` |
| `EQUINOXEV_HVBAT_C_V_MAX`, `CB/2AF5` | ≈3.9317 V first; ≈3.9308 V second | NOT RUN | Same independent cell reference; avg≤max is only an internal consistency check | NOT RUN / `community` |
| `EQUINOXEV_HVBAT_V`, `1D/33E5` | `NO DATA` in both spikes | NOT RUN | Must first answer from the expected module and pass a voltage-reference check; OBDb maximum 25.5 V precludes treating it as pack voltage | FAIL for 2024 observations / `community` |

For each new run, add a row here without altering the recording:

| Redacted recording path and SHA-256 | Local start time | Dash SOC | Vehicle state / charging | Ambient | `27C6` / `2AF5` / `2B43` / `33E5` line numbers and status | Replay artifact SHA-256 |
|---|---|---|---|---|---|---|
| NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |

If the new SOC disagrees after display rounding, downgrade the corresponding T2.2a signal to `community` and record the mismatch. If the cell readings move sensibly but lack an independent reference, report that trend and keep them `community`. Do not label any value as battery health.

## Draft OBDb upstream correction — review only

Upstream source: [OBDb Chevrolet Equinox EV `signalsets/v3/default.json`](https://github.com/OBDb/Chevrolet-Equinox-EV/blob/main/signalsets/v3/default.json), vendored here at commit `15ee122df435d541d928dac8e7532bf43e39bdd4` under CC-BY-SA-4.0 (`packages/obd-core/vehicles/chevrolet-equinox-ev/README.md` and `LICENSE`). Current upstream still marks `DACB/27C6`, `DACB/2AF5`, and `DACB/2B43` with `dbgfilter: {"from": 2025}` as inspected 2026-09-24. Two redacted recordings of our 2024 car have positive replies for all three: `2026-09-22-spike.redacted.jsonl` lines 152–171 and `2026-09-22-spike-2.redacted.jsonl` lines 152–173. Proposed narrow metadata change for each of those three commands: `"from": 2025` → `"from": 2024`. Preserve their signal IDs, formulas, units, and license. Attach only redacted evidence and the verified SOC/dash comparison. State that this establishes support on one 2024 car, not every 2024 variant.

`DA1D/33E5` returned `NO DATA` on both runs and its OBDb scaling tops out at 25.5 V. Mention the observation in the PR discussion; do **not** propose an unsupported replacement DID or call it HV pack voltage. Recheck the upstream `main` file immediately before preparing an actual branch in case its filter has since changed. **PR publication: NOT RUN.** No external issue/PR is filed by this run card.
