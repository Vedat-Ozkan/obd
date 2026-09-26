# Charge log: fixtures/synthetic/charge-log-rested.jsonl

Synthetic: yes
Sessions: 2: t=0 start; t=1269 timeout
Samples: current 356 (largest gap 15 s at t=20.35), pack voltage 356, energy 356, SOC 356, group sets 354 (largest gap 20 s at t=0.75), cell min/max 356
Group sets dropped: 2 (incomplete 1; not 80 valid records 1, t=5.75 79 records)
Pre-charge rest: t=35.35–665.35 (630 s)
Charge: t=805.35–1705.35 (900 s), mean -20 A
Post-charge rest: t=1715.35–3515.35 (1800 s)
Gate (T2.4 verify line): PASS (largest current gap 10 s at t=35.35, largest group-set gap 10 s at t=35.75, recovery gaps: 1, longest 15 s)
Power check: I×V 6.24 kW, 27AF slope 6.2292 kW, ratio 1.0017

## Capacity (estimates, not truth)

BMS-SOC-referenced: divides by the BMS's own SOC, so it is not independent of the BMS (ADR-016). Not truth.
Integrated current ÷ ΔSOC: 11.9654 Ah ± 0.5027 Ah
  SOC0 → SOC1: 39.2157 % at t=655.65 → 80.3922 % at t=3505.65 (ΔSOC 41.1765 %), Q 4.9269 Ah
  Bounded terms (worst case, added linearly): current resolution 0.0198 Ah; integration 0.0569 Ah; SOC resolution on ΔSOC 0.3922 %; recovery gap at t=1255.35 0.0833 Ah
  Unbounded: current sensor gain and offset; BMS SOC model error and lag; temperature (not measured)
  BM2 selection: pass
BMS figure: 27AF energy remaining ÷ SOC. A comparison, not the reference (ADR-016). Not truth.
BMS figure first: 3.75 kWh ± 0.0309 at t=0.65; last: 3.7317 kWh ± 0.0153 at t=3545.65; range 3.7235–3.774 kWh over 356 cycles
  Bounded terms (each figure): 27AF resolution 0.005 kWh; SOC resolution 0.1961 %
  Unbounded: the BMS energy model; whether the SOC basis is displayed or raw

## Cell-group spread (community tier; no fault verdict)

2AF5 spread at pre-rest-end: 30.8 mV at t=655.7
2AF5 spread at charge-max: 30.8 mV at t=805.7, SOC 40.3922 %
2AF5 spread at post-rest-end: 30.8 mV at t=3505.7
Group extremes at t=655.75: min record 21 of 80 (module 3), max record 5 of 80 (module 1), spread 30.8 mV
Group extremes at t=805.75: min record 21 of 80 (module 3), max record 5 of 80 (module 1), spread 30.8 mV
Group extremes at t=3505.75: min record 21 of 80 (module 3), max record 5 of 80 (module 1), spread 30.8 mV
Group min/max equal to 2AF5 min/max (exact; a statistic, not a gate): 354 of 354 cycles
  no state mark: 354 of 354
Temperature: not measured (no sourced scaling)

# Charge log: fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-23-discovery-targeted.redacted.jsonl

Synthetic: no
Sessions: 1 (no charge-log session boundary; replayed as one session)
Samples: current 9 (largest gap 98.939 s at t=678.629), pack voltage 9, energy 116, SOC 116, group sets 111 (largest gap 22.89 s at t=465.075), cell min/max 115
Group sets dropped: 6 (incomplete 6; not 80 valid records 0)
Pre-charge rest: not found
Charge: not found
Post-charge rest: not found
Gate (T2.4 verify line): FAIL: no pre-charge rest window; no charge window; no post-charge rest window; largest current gap 98.939 s at t=678.629 > 10 s; largest group-set gap 22.89 s at t=465.075 > 10 s
Power check: not computed: no charge window

## Capacity (estimates, not truth)

BMS-SOC-referenced: divides by the BMS's own SOC, so it is not independent of the BMS (ADR-016). Not truth.
Integrated current ÷ ΔSOC: NOT ESTIMATED: no pre-charge rest window; no charge window; no post-charge rest window
  BM2 selection: fail (no pre-charge rest window; no charge window; no post-charge rest window)
BMS figure: 27AF energy remaining ÷ SOC. A comparison, not the reference (ADR-016). Not truth.
BMS figure first: 88.5417 kWh ± 0.2109 at t=20.778; last: 88.7329 kWh ± 0.2103 at t=910.347; range 88.3646–88.8132 kWh over 115 cycles
  Bounded terms (each figure): 27AF resolution 0.005 kWh; SOC resolution 0.1961 %
  Unbounded: the BMS energy model; whether the SOC basis is displayed or raw

## Cell-group spread (community tier; no fault verdict)

2AF5 spread: not computed: no rest or charge window
Group min/max equal to 2AF5 min/max (exact; a statistic, not a gate): 27 of 111 cycles
  idle baseline: 10 of 30
  heater max on: 1 of 14
  heater off: 5 of 14
  plugged in and charging: 7 of 42
  unplugged: 4 of 11
Temperature: not measured (no sourced scaling)
