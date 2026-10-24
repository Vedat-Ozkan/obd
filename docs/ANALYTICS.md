# Analytics

Plan date: 2026-10-23. A solo-sized battery trend analysis: the practical step before `docs/ML.md` BM2 (Bayesian capacity trend) and BM3 (per-group faults), producing the series and tests they need.

## Which kinds of analytics fit this app

| Kind | Useful here? | Why |
|---|---|---|
| Data analysis of battery measurements (metrics, trends, anomalies) | **Yes, core** | Owners want to know whether the pack is changing. |
| Product analytics (events, funnels, retention) | **Not now** | A few testers and one car; a five-person funnel is noise. |
| Experimentation (A/B tests) | **No** | Too few users for power. |

## What the app already captures

- **Battery check reports.** These are saved on the phone, one JSON history file across all cars, newest first (`apps/mobile/src/batteryReports.ts:5,35-37`). Each `BatteryDiagnosisReport` (`packages/obd-battery/src/report.ts:21-35`) holds:
  - `scannedAt` and `scanStatus` (complete or partial)
  - decoded `signals` with value, unit and evidence tier
  - `parked.groupVoltages`: 80 cell-group voltages, with module numbers
  - `parked.bmsFigure`: the BMS energy remaining divided by SOC, in kWh
  - `parked.temperatureRaw`: raw hex, **not decoded**
  - `cellSpread`
  - a 12 V report and a codes report
  - `capacity: not-measured` and `health: not-assessed`
- **Charge logs and test drives.** Raw ELM327 JSONL under `captures/` on the phone, copied to a folder the user picks (`apps/mobile/src/app/runtime.ts:54-93`). They are **not** parsed in the app. History says "showing them per car comes later" (`ReportScreens.tsx:29`).
  - `packages/obd-battery` already parses them into a `ChargeLog` (`session.ts:162`) and computes phases (`session.ts:256`), capacity in Ah with an error band (`capacity.ts:31-84`), BMS kWh figures (`capacity.ts:98`), power (`capacity.ts:116`), group imbalance (`imbalance.ts:33`) and per-group resistance under load (`driveGroups.ts:40`).
- **Beta uploads.** Consented and scrubbed; provenance has month, catalog id, random tester and vehicle keys, no VIN (`packages/obd-core/src/recording/provenance.ts:10-24`).

### Limits that shape the plan

- **No true state of health.** Every capacity number is referenced to the BMS SOC and labelled "Not truth" (ADR-016, `capacity.ts:16-17`). This plan reports a **BMS-referenced capacity index**, not SOH, until an independent reference exists (BM2's OCV-anchored estimator).
- **Temperature is not measured** (`capacity.ts:81`); `2AF1` and `temperatureRaw` have no verified scaling. **Charge rate against temperature is blocked** until a temperature DID is decoded and checked. Do not guess a scaling.
- **One car.** The data so far:
  - no real charge log yet: the three local 2026-09-28 charge-log files are failed attempts (every `0100` answered `UNABLE TO CONNECT`, no pack current, voltage or SOC read)
  - two redacted test drives
  - `fixtures/synthetic/charge-log-rested.jsonl` with its label

  Limits drawn from one car can miss pack-wide fade (`report.ts` `limitation`).

## Trend analysis plan

One new pure module, `packages/obd-battery/src/trend.ts`: reports and summaries in, plain objects out, no I/O. The same code runs on the phone, in vitest and in a `pnpm trend-report` script.

### Step 0: persist charge-session summaries

After a charge log is saved, parse it with the existing functions and store a small `ChargeSessionSummary` (capacity and band, ΔSOC, rest lengths, `gateFailures`, power-by-SOC bins, spread points) in a second on-phone history file. This is the only new storage.

### Step 1: per-session points

Each session `i` gives `(t_i, y_i, b_i)`: time, value and band.

- **From battery checks:**
  - `y` = `parked.bmsFigure.valueKwh`
  - `b` = the band from `bmsFigure` (`capacity.ts:90`)
  - Keep only `scanStatus: complete`.
  - Keep only parked sessions within one SOC bin (for example 40–80%), because the figure moves with SOC (`bmsEnergyCapacity` range).
- **From charge logs:**
  - `y` = integrated Ah, only when `gateFailures` is empty
  - `b` = its band
- **Capacity index:** `x_i = y_i / C_ref`. `C_ref` is the median of the first three accepted sessions **of the same method**. kWh and Ah series get separate fits and are never pooled.

### Step 2: degradation trend

The band is a sum of worst-case resolution terms, not a standard deviation. Assume `σ_i = b_i / 2` and state that assumption in the output.

Weighted least squares, `w_i = 1/σ_i²`, weighted means `t̄`, `x̄`:

```
slope  β  = Σ w_i (t_i − t̄)(x_i − x̄) / Σ w_i (t_i − t̄)²
SE(β)     = sqrt( 1 / Σ w_i (t_i − t̄)² ) × max(1, sqrt(χ²/(n−2)))
fade %/yr = −100 × β    (t in years)
```

Here `χ² = Σ w_i (x_i − fit_i)²`, so the SE grows when the scatter is larger than the bands claim.

Show a trend only when all of these hold:

- n ≥ 5
- the sessions span at least 90 days
- |β| > 2·SE

Otherwise the output is "Not enough data yet: n sessions over d days". Kalman or Gaussian-process smoothing and coverage backtests stay in BM2.

### Step 3: charge rate against SOC (doable now)

1. During the charge window, compute `P = −I·V / 1000` in kW for each current sample paired with a pack-volts sample within 10 s. This is the same pairing as `powerCheck`.
2. Bin the samples by BMS SOC in 5% steps and take the **median** power per bin.
3. Compare sessions only on the same charger: the user tags each session as L1, L2 or DC.

Flag a session when bin medians fall more than 15% below that charger's earlier median in two or more adjacent bins. Also track the taper SOC (power below 80% of session peak). Temperature joins only after decoding is verified.

### Step 4: cell-group spread across sessions

For each complete parked check, using the 80 group voltages:

```
spread_mV = 1000 × (max V − min V)
z_g       = (V_g − median V) / (1.4826 × MAD)
MAD       = median |V_g − median V|
```

- **Spread trend:** run the same weighted fit on `spread_mV` inside an SOC bin, with `σ` from the voltage resolution.
- **Persistent weak group:** `z_g < −3` in at least 3 of the last 5 comparable checks. One low reading is not a flag.
- **Under load (drives):** track the `driveGroups` `flagged` list and `excessMohm` per group across drives. Flag a group that shows up in two or more drives.
- The existing rest thresholds stay as the per-check red-flag screen (`report.ts:58-61`). The trend adds "getting worse", not a new absolute verdict.

### Step 5: anomaly flags

- **Capacity:** a new point outside `fit ± 3·sqrt(σ_i² + SE_pred²)`, where `SE_pred` is the fit's standard error at that t.
- **Spread:** a step of more than 3 mV between two checks at the same SOC bin.
- **Charge power:** the rule from Step 3.
- **12 V:** resting voltage below its own median by more than 0.3 V in two consecutive checks. The basis is the existing `twelveVolt` report.
- **Codes:** a new DTC that was not present in the previous check.

## Outputs

- **Car screen, "Trends" section:**
  - a capacity-index chart with error bars
  - a spread-over-time chart
  - charge-power-by-SOC curves for the last three sessions on the same charger

  Each chart gets a one-sentence summary as its accessibility label and on-screen caption, for example: "Capacity index 0.98, change −1.2 %/yr ± 0.9 over 7 sessions; not significant."
- **Trend report:** `renderTrendReport()` produces Markdown, like `renderBatteryDiagnosis`. Shared from the phone or `pnpm trend-report <dir>`. It lists sessions used and rejected (with reasons), assumptions and flags.

## Privacy defaults

- All analysis runs on the phone. Summaries live in the app's document directory. No new network calls.
- Beta uploads stay as they are, under the existing consent. Trend summaries are **not** uploaded.
- The trend report contains no VIN and no garage id, only catalog id, dates and values.

## Usage analytics for the beta (only if needed)

**First choice: no client events.** Compute reliability server-side in `tools/beta-intake` from uploads testers already consented to: partial-scan rate per app version, stop reasons, recoveries per hour, dropped group sets, gate failures. Once ten or more cars upload, SQLite or DuckDB queries over that output are enough.

If client events become justified (for example, drop-off before a first check):

- a fixed list: `check_started`, `check_completed {status, reason}`, `charge_log_saved`, `app_version`
- no free text, no device ids beyond the existing random `testerKey`, month-level dates
- batched through the existing outbox
- a new `CONSENT_VERSIONS` entry, with an update to the pinned consent text and its tests (`apps/mobile/test/redesign-text.test.ts`)

## Tests

- **Unit tests on known maths:**
  - The weighted slope and SE on hand-computed series.
  - MAD and z on a vector with one planted outlier.
  - Binning of power by SOC.
- **Synthetic multi-session series:**
  - Refactor `packages/obd-battery/scripts/synthetic-charge-log.ts` (constants `CAPACITY_AH`, `WEAK_RECORD`, `WEAK_DROP_V`) into a seeded function.
  - 10 sessions over a year with 3%/yr fade: detected, estimate within 2·SE of 3%.
  - 200 seeded flat series: false-alarm rate at most 5%.
  - A weak group appearing in session 6: flagged only once the 3-of-5 rule is met.
- **Recorded sessions:**
  - Run `charge-log-rested` and the two redacted drives end to end: JSONL → summaries → trend report. Snapshot the rejected-session reasons.
  - Add the first real charge log (`docs/OWNER-QUEUE.md` C2), redacted with `tools/spike/redact_vin.py`, once it exists.

## Honest CV claims per finished step

| Step done and merged | Claim it justifies |
|---|---|
| 0–1 | "Built on-device storage and per-session capacity series from OBD-II charge logs (TypeScript, tested with recorded sessions)." |
| 2 | "Implemented weighted least-squares degradation trend with error propagation and a significance gate, on one EV (n=1, BMS-referenced)." |
| 3 | "Analysed EV charge power against state of charge across sessions, with per-charger baselines and drop detection." |
| 4–5 | "Added robust (median/MAD) cell-group outlier tracking and rule-based anomaly flags, validated on synthetic fault injection with a measured false-alarm rate." |
| Outputs | "Shipped accessible trend charts and a shareable Markdown trend report in a React Native app." |

Avoid "state of health", "ML" or fleet claims before BM2/BM3 and multi-car data.
