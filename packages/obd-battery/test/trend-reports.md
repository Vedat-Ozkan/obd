# Trend report artifacts (T2.20 Stage A)

All series below are synthetic, built in memory by `trend.test.ts`. No real multi-session series exists yet.

## Measured false alarms

7 of 200 seeded flat series (10 sessions over 360 days, noise sd equal to the assumed sigma = band/2) were significant: 3.5 % (limit 5 %).

## Seeded series (a): 10 sessions, 12 months, 3 %/yr fade (synthetic)

# Battery trend report

All figures: BMS-referenced capacity index, not state of health. Limits come from one car; self-comparison can miss even pack-wide degradation or reflect a sensor offset.
Assumption: each point's uncertainty is sigma = band / 2, where band is the worst-case bound of the half-count terms. This is not a calibrated error; BM2 replaces it.

## Sessions used

- synthetic-series/0 (2025-10-01): bms-kwh 85.14 kWh +- 0.29 kWh
- synthetic-series/1 (2025-11-10): bms-kwh 84.84 kWh +- 0.29 kWh
- synthetic-series/2 (2025-12-20): bms-kwh 84.39 kWh +- 0.28 kWh
- synthetic-series/3 (2026-01-29): bms-kwh 84.13 kWh +- 0.28 kWh
- synthetic-series/4 (2026-03-10): bms-kwh 83.99 kWh +- 0.28 kWh
- synthetic-series/5 (2026-04-19): bms-kwh 83.49 kWh +- 0.28 kWh
- synthetic-series/6 (2026-05-29): bms-kwh 83.28 kWh +- 0.28 kWh
- synthetic-series/7 (2026-07-08): bms-kwh 83.09 kWh +- 0.28 kWh
- synthetic-series/8 (2026-08-17): bms-kwh 82.88 kWh +- 0.28 kWh
- synthetic-series/9 (2026-09-26): bms-kwh 82.50 kWh +- 0.28 kWh

## Rejected

None.

## Capacity index

### bms-kwh (kWh)

Trend: 3.07 % per year fade +- 0.33 % (2 SE), 10 sessions over 360 days, SE inflation 1.00. Reference value 84.84.

| Date | Value | Index |
|---|---|---|
| 2025-10-01 | 85.14 kWh | 1.0035 |
| 2025-11-10 | 84.84 kWh | 1.0000 |
| 2025-12-20 | 84.39 kWh | 0.9947 |
| 2026-01-29 | 84.13 kWh | 0.9917 |
| 2026-03-10 | 83.99 kWh | 0.9900 |
| 2026-04-19 | 83.49 kWh | 0.9841 |
| 2026-05-29 | 83.28 kWh | 0.9816 |
| 2026-07-08 | 83.09 kWh | 0.9794 |
| 2026-08-17 | 82.88 kWh | 0.9768 |
| 2026-09-26 | 82.50 kWh | 0.9724 |

### integrated-ah (Ah)

Not enough data yet: 0 sessions over 0 days (no sessions).

## Cell-group spread

2025-10-01: 2.0 mV; 2025-11-10: 2.0 mV; 2025-12-20: 2.0 mV; 2026-01-29: 2.0 mV; 2026-03-10: 2.0 mV; 2026-04-19: 2.0 mV; 2026-05-29: 2.0 mV; 2026-07-08: 2.0 mV; 2026-08-17: 2.0 mV; 2026-09-26: 2.0 mV

Not enough data yet: 10 sessions over 360 days (spread sigma 0.1 mV from the group voltage tick).

## Flags

None.

## Drive groups

No drive sessions.

## Charge power by SOC

No charge sessions.
