# Test drive feasibility, 2026-09 (T2.12)

Findings for `docs/specs/T2.12-test-drive-capture.md`, Stage C. Two real drives on the 2024 Chevrolet Equinox EV, recorded 2026-09-30 by the Record test drive button. Written 2026-10-01 from the redacted copies:

- Drive 1: `fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-30-test-drive.redacted.jsonl` (79672 lines).
- Drive 2: `fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-30-test-drive-2.redacted.jsonl` (24097 lines).

Both are real recordings (Synthetic: no). Line numbers below are 1-based lines of the redacted files. Both copies were written by `tools/spike/redact_vin.py`; its meta line on each reports `masked_messages: 0` (no VIN was in either drive). `pnpm -F obd-core test` replays both (`recordings.test.ts`, 241 tests passed).

**Verdict: NO-GO for absolute pack resistance, pending owner confirmation.** G1, G2 and G4 pass on both drives; G3 fails on both. The cell-group measurements are not what failed (see Answers). ADR-023 moves T2.13 to cell groups under load.

## 1. Session setup (H1 to H4)

From the recordings:

- H1: both files start with a meta line (line 1) whose note is `T2.12 test drive: Equinox Ready, Park; one-button capture`, then `charge-log session`, reason `start` (line 2), then `ATZ`. PASS for the start.
- H2: drive 1 ran 1201.2 s (t=0.03 to t=1201.235) in one session, with no recovery or boundary after the start (Sessions: 1). Drive 2 ran 361.0 s, also one session. Drive 2 is shorter than the 15 to 20 min the spec asked for, because the owner stopped it on arrival.
- H3: drive 1 stopped by itself at the cap, `test drive stopped: 20 min recorded` (line 79671). Drive 2 stopped on Disconnect, `test drive stopped: disconnect pressed` (line 24096). The car-off silent stop (60 s with no current) did not run on the car: NOT RUN.
- H4: both files are in `fixtures/recordings/chevrolet-equinox-ev-2024/`.
- Build type and Metro: the meta line does not record whether the app was the dev client. Drive 1 ran 20 minutes in one session, so the JS loop kept running for that long. Intervals are the phone's, as the spec Risks asked, and may include dev-mode slowdown if it was a dev client.

Owner-recalled on 2026-10-01 (not recorded in either file):

- Dash SOC about 77 % at the start of drive 1, and about 74 % at the end of drive 2.
- About 18 °C outside.
- Phone: OnePlus 12R.
- Drive 2 was stopped on arrival.

The recorded `2B43` SOC is close to those recollections: 76.08 % at t=7.6 s (drive 1, first) and 73.73 % at t=359.4 s (drive 2, last). Drive 1 ended at 74.51 % and drive 2 started at 74.51 %, so the two drives are consecutive.

## 2. drive-capture output (verbatim)

`pnpm drive-capture` on each redacted file, unedited.

### Drive 1

```text
# Test drive: fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-30-test-drive.redacted.jsonl

Recording: fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-30-test-drive.redacted.jsonl
Synthetic: no
Stop: 20 min recorded
Span: 1201.205 s (t=0.03 to t=1201.235)
Sessions: 1

## Intervals

Intervals and times are nearest rank; a sample's time is its tx line's t.

- Current, fast (no group read between): n=3293, median 0.162 s, p90 0.182 s, max 0.51 s
- Current, across a group read: n=365, median 1.836 s, p90 1.919 s, max 2.545 s
- Voltage, fast: n=3292, median 0.163 s, p90 0.181 s, max 0.498 s
- Voltage, across a group read: n=365, median 1.834 s, p90 1.922 s, max 2.545 s
- Current to voltage within a pair: n=3657, median 0.078 s, p90 0.092 s, max 0.257 s
- Complete group sets: 349, dropped 17
- Group set to group set: n=348, median 3.311 s, p90 3.48 s, max 9.228 s
- Group set span (2AE1 tx to 2AE7 tx): n=349, median 0.687 s, p90 0.723 s, max 0.803 s

## Skew

Per complete group set with a decoded current on each side (n=348 of 349).

- Before (2AE1 tx minus previous 2414 tx): n=348, median 0.46 s, p90 0.495 s, max 0.761 s
- After (next 2414 tx minus 2AE7 tx): n=348, median 0.69 s, p90 0.736 s, max 1.286 s
- Bracket (before + span + after): n=348, median 1.843 s, p90 1.922 s, max 2.545 s
- Bracketing currents within 10 A: 193 of 348 sets

## Command times

Median time from a tx to the next tx in the same session.

- AT commands: n=5133, median 0.042 s
- 22 on 17: n=7320, median 0.078 s
- 22 on CB: n=3659, median 0.107 s

## Steps

Consecutive fast current samples with |ΔI| >= 20 A; R = -ΔV/ΔI, ΔV between the 2885 reads of the same two pairs.

- Steps: 147
- R (mΩ): median 10.2, Q1 -3.7, Q3 28.2

| t (s) | Δt (s) | I a→b (A) | V a→b (V) | R (mΩ) | tx lines: 2414 a, 2885 a, 2414 b, 2885 b |
|---|---|---|---|---|---|
| 139.492 | 0.163 | 443.7 → 212.7 | 313.21 → 316.9 | 16.0 | 8916, 8920, 8924, 8928 |
| 139.655 | 0.156 | 212.7 → 57 | 316.9 → 318.52 | 10.4 | 8924, 8928, 8932, 8936 |
| 150.829 | 0.15 | 51.3 → 193.5 | 311.67 → 307.13 | 31.9 | 9630, 9634, 9638, 9642 |
| 51.217 | 0.18 | 271.2 → 153.9 | 315.44 → 318.13 | 22.9 | 3098, 3102, 3106, 3110 |
| 51.397 | 0.182 | 153.9 → 41.7 | 318.13 → 319.6 | 13.1 | 3106, 3110, 3114, 3118 |
| 385.991 | 0.178 | -52.75 → 30.9 | 317.75 → 318.44 | -8.2 | 25215, 25219, 25223, 25227 |
| 382.539 | 0.18 | -6.85 → 70.8 | 316.06 → 315.59 | 6.1 | 24996, 25000, 25004, 25008 |
| 139.811 | 0.161 | 57 → -8.65 | 318.52 → 319.75 | 18.7 | 8932, 8936, 8940, 8944 |
| 215.921 | 0.176 | 54.6 → -10.75 | 318.37 → 320.14 | 27.1 | 14085, 14089, 14093, 14097 |
| 164.468 | 0.177 | 4.8 → -58.75 | 321.44 → 320.9 | -8.5 | 10641, 10645, 10649, 10653 |

## Context

- SOC (2B43): first 76.0784 % at t=7.608, last 74.5098 % at t=1201.131
- 2AF1 raw hex (no scaling): first 696969696969696969686969696969696969696900000000, last 696969696969696969696969696969696969696900000000
- Current: min -156.85 A, max 562.5 A
```

### Drive 2

```text
# Test drive: fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-30-test-drive-2.redacted.jsonl

Recording: fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-30-test-drive-2.redacted.jsonl
Synthetic: no
Stop: disconnect pressed
Span: 361.047 s (t=0.035 to t=361.082)
Sessions: 1

## Intervals

Intervals and times are nearest rank; a sample's time is its tx line's t.

- Current, fast (no group read between): n=997, median 0.158 s, p90 0.181 s, max 0.509 s
- Current, across a group read: n=110, median 1.832 s, p90 1.905 s, max 2.042 s
- Voltage, fast: n=996, median 0.156 s, p90 0.181 s, max 0.508 s
- Voltage, across a group read: n=110, median 1.831 s, p90 1.911 s, max 2.057 s
- Current to voltage within a pair: n=1107, median 0.077 s, p90 0.091 s, max 0.255 s
- Complete group sets: 110, dropped 0
- Group set to group set: n=109, median 3.286 s, p90 3.415 s, max 3.585 s
- Group set span (2AE1 tx to 2AE7 tx): n=110, median 0.684 s, p90 0.711 s, max 0.779 s

## Skew

Per complete group set with a decoded current on each side (n=110 of 110).

- Before (2AE1 tx minus previous 2414 tx): n=110, median 0.455 s, p90 0.492 s, max 0.503 s
- After (next 2414 tx minus 2AE7 tx): n=110, median 0.693 s, p90 0.732 s, max 0.78 s
- Bracket (before + span + after): n=110, median 1.832 s, p90 1.905 s, max 2.042 s
- Bracketing currents within 10 A: 49 of 110 sets

## Command times

Median time from a tx to the next tx in the same session.

- AT commands: n=1556, median 0.043 s
- 22 on 17: n=2214, median 0.077 s
- 22 on CB: n=1100, median 0.107 s

## Steps

Consecutive fast current samples with |ΔI| >= 20 A; R = -ΔV/ΔI, ΔV between the 2885 reads of the same two pairs.

- Steps: 58
- R (mΩ): median 12.0, Q1 0.0, Q3 25.7

| t (s) | Δt (s) | I a→b (A) | V a→b (V) | R (mΩ) | tx lines: 2414 a, 2885 a, 2414 b, 2885 b |
|---|---|---|---|---|---|
| 24.233 | 0.178 | 469.2 → 303.6 | 307.59 → 312.59 | 30.2 | 1421, 1425, 1429, 1433 |
| 24.411 | 0.169 | 303.6 → 146.7 | 312.59 → 315.44 | 18.2 | 1429, 1433, 1437, 1441 |
| 24.58 | 0.148 | 146.7 → 57.9 | 315.44 → 317.29 | 20.8 | 1437, 1441, 1445, 1449 |
| 231.759 | 0.169 | -51.85 → 18.6 | 316.98 → 316.75 | 3.3 | 15574, 15578, 15582, 15586 |
| 257.935 | 0.169 | 51.9 → -16.15 | 316.98 → 318.06 | 15.9 | 17327, 17331, 17335, 17339 |
| 216.661 | 0.172 | 83.7 → 28.2 | 317.29 → 317.59 | 5.4 | 14508, 14512, 14516, 14520 |
| 260.181 | 0.152 | 1.2 → -53.95 | 319.9 → 319.83 | -1.3 | 17496, 17500, 17504, 17508 |
| 258.277 | 0.168 | -17.05 → -62.35 | 318.9 → 319.21 | 6.8 | 17343, 17347, 17351, 17355 |
| 219.351 | 0.135 | 5.4 → 46.8 | 316.29 → 315.75 | 13.0 | 14693, 14697, 14701, 14705 |
| 219.041 | 0.161 | -57.85 → -17.35 | 316.75 → 316.36 | 9.6 | 14677, 14681, 14685, 14689 |

## Context

- SOC (2B43): first 74.5098 % at t=7.658, last 73.7255 % at t=359.443
- 2AF1 raw hex (no scaling): first 69696969696A696969696969696969696969696900000000, last 69696A6A696A696969696969696969696A69696900000000
- Current: min -167.35 A, max 476.4 A
```

## 3. The three answers

All times are the tx-line times in the recording, from the Intervals and Skew sections above.

**1. How often can current and voltage be read?**

- Alone (fast pairs, no group read between): median 0.162 s between current samples on drive 1 (n=3293) and 0.158 s on drive 2 (n=997). That is about 6 samples per second. Voltage is the same, 0.163 s and 0.156 s. Current to voltage inside a pair takes 0.078 s and 0.077 s. p90 is 0.182 s and 0.181 s, and the worst gap is 0.51 s.
- When group voltages are read too: the current sample on either side of a group read is 1.836 s apart (drive 1, n=365) and 1.832 s apart (drive 2, n=110). A group set comes every 3.311 s (drive 1) and 3.286 s (drive 2). The seven group reads take 0.687 s and 0.684 s from the `2AE1` tx to the `2AE7` tx.

**2. How far apart in time are a group reading and the currents around it?**

Median bracket (before + span + after) is 1.843 s on drive 1 (p90 1.922 s, max 2.545 s) and 1.832 s on drive 2 (p90 1.905 s, max 2.042 s). The before gap is about 0.46 s and the after gap about 0.69 s. The two bracketing currents differ by 10 A or less in 193 of 348 sets on drive 1 and 49 of 110 on drive 2, so under half to just over half of the group sets sit in a steady current.

Dropped group sets, drive 1: 17 of 366 (349 complete). Drive 2: 0 of 110. I checked all 17 against the recording. Every one contains at least one reply that is the negative-response frame `18DAF1CB 03 7F 22 21` (service 22 rejected, code 21), 32 such replies across the 17 sets (1 to 5 per set, on any of `2AE1` to `2AE7`). The file has no other error text (no `NO DATA`, `CAN ERROR` or similar). Drive 1 has 7 more of the same frame on other reads (`2885` x2, `2414` x1, `2B43` x2, `2AF1` x2), 39 in total; the script does not count those as dropped sets. Drive 2 has one such reply, on `2B43` (line 17035), and drops none. The code 21 is not interpreted here, because no source in the repo defines it. All 17 start between line 1029 and line 31537 of 79672, so they fall in the first part of the drive and none in the later part. I did not look for a cause.

**3. Are acceleration and regen current steps large and clean enough for ΔV/ΔI?**

Large: yes. Current reaches 562.5 A on drive 1 and 476.4 A on drive 2, and regen to -156.85 A and -167.35 A. There are 147 and 58 steps of 20 A or more, and the largest single step is 231 A on drive 1 and 166 A on drive 2, each inside one fast interval of under 0.2 s.

Clean: no. R = -ΔV/ΔI has a median of 10.2 mΩ (drive 1) and 12.0 mΩ (drive 2), but the spread is wide: Q1 -3.7 and Q3 28.2 mΩ on drive 1, Q1 0.0 and Q3 25.7 mΩ on drive 2. Some steps give a negative R (a quarter or more of drive 1's steps, since its Q1 is below zero), which is not plausible for a pack resistance. Likely causes, not tested here: current and voltage are read 0.078 s apart (the pair skew named in the spec Risks), and the largest steps are inside a fast current transient that continues between the two reads. A resistance filter could be built, but the spec's G3 asks whether the raw step estimate is consistent, and it is not. Nothing in the repo gives a reference resistance, so the result cannot be checked for accuracy either, only for consistency.

## 4. Worked example (ΔV/ΔI)

Drive 1, the first row of the Steps table: tx lines 8916, 8920, 8924, 8928. Scalings from the spec `§Sources`: `2414` s16 ÷ 20 A, `2885` u16 ÷ 100 V. In a reply the bytes after `18DAF1 17 05 62 <DID>` are the value.

| Line | Direction | Content | Decoded |
|---|---|---|---|
| 8916 | tx | `22 2414` (t=139.492) | |
| 8917, 8918 | rx | `18DAF11705622414`, `22AA` | 0x22AA = 8874, ÷ 20 = 443.7 A (a) |
| 8920 | tx | `22 2885` (t=139.581) | |
| 8921, 8922 | rx | `18DAF11705622885`, `7A59` | 0x7A59 = 31321, ÷ 100 = 313.21 V (a) |
| 8924 | tx | `22 2414` (t=139.655) | |
| 8925, 8926 | rx | `18DAF11705622414`, `109E` | 0x109E = 4254, ÷ 20 = 212.7 A (b) |
| 8928 | tx | `22 2885` (t=139.721) | |
| 8929, 8930 | rx | `18DAF11705622885`, `7BCA` | 0x7BCA = 31690, ÷ 100 = 316.90 V (b) |

ΔI = 212.7 - 443.7 = -231.0 A over Δt = 0.163 s. ΔV = 316.90 - 313.21 = +3.69 V. R = -ΔV/ΔI = -3.69 / -231.0 = 0.0160 Ω = 16.0 mΩ, which matches the table. The next row (lines 8924 to 8936, 212.7 to 57.0 A, 316.90 to 318.52 V) gives 10.4 mΩ from the same drop in current, so one fall from 443.7 A to 57.0 A over 0.32 s gives two estimates that already differ by 5.6 mΩ.

Drive 2, first row: tx lines 1421, 1425, 1429, 1433. `24A8` = 9384, ÷ 20 = 469.2 A; `7827` = 30759 = 307.59 V; `17B8` = 6072, ÷ 20 = 303.6 A (line 1429 tx, rx on 1430 to 1431); `7A1B` = 31259 = 312.59 V (rx on 1434 to 1435). R = -(312.59 - 307.59) / (303.6 - 469.2) = 5.00 / 165.6 = 30.2 mΩ, matching the table. Against drive 1's first row (16.0 mΩ) the two first steps of each drive differ by almost a factor of 2.

## 5. G1 to G4

Criteria from the spec (accepted by the owner, 2026-09-29; policy values, not sourced references).

| Criterion | Drive 1 | Drive 2 | Result |
|---|---|---|---|
| G1: fast current median interval ≤ 1.0 s | 0.162 s | 0.158 s | PASS |
| G2: at least 20 steps with \|ΔI\| ≥ 20 A | 147 | 58 | PASS |
| G3: median R > 0 and IQR ≤ 50 % of the median | median 10.2 mΩ > 0; IQR 31.9 mΩ = 313 % of the median | median 12.0 mΩ > 0; IQR 25.7 mΩ = 214 % of the median | FAIL |
| G4: median bracket ≤ 2.0 s | 1.843 s | 1.832 s | PASS |

IQR is Q3 - Q1 from the printed quartiles (28.2 - (-3.7) and 25.7 - 0.0), so the percentages carry the rounding of the printed one-decimal values. The G3 interquartile range is 214 to 313 % of the median across the two drives, which is the figure ADR-023 cites.

Verdict by the spec rule: G1 to G3 do not all pass, so **NO-GO** for T2.13 as an absolute-resistance feature; G3 is the failing criterion. G4 passes, so the group-voltage bracket is short enough for a group-sag measurement (this is why ADR-023 keeps cell groups under load). **Pending owner confirmation.**

## 6. Not run

- The car-off silent stop on the car (H3): NOT RUN.
- The car-off `UNABLE TO CONNECT` line citation for the spec's Sources table: NOT RUN. The 2026-09-28 charge logs (`2026-09-28-charge-log*.jsonl`) are not in this checkout, so no line numbers can be given.
