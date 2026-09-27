# Feasibility

Hardware findings reviewed 2026-09-16; product and ML scope revised 2026-09-22 (ADR-012). Each area has a status, evidence, and next step. "Verified" means checked against a primary source or hardware; "reported" means secondhand; "assumed" means unchecked. This documentation revision does not verify hardware or market claims beyond what is marked verified.

## Summary

| Area | Status | Risk | Mitigation |
|---|---|---|---|
| Generic OBD-II on the two ICE cars (optional bench) | Verified by protocol (both are 2008+ CAN); hardware unverified | Low | No Phase 0 acceptance depends on an ICE session (ADR-015) |
| Veepeak BLE from an app | Reported working (BLE service FFF0) | Low | T0.2 discovers characteristics rather than assuming |
| Equinox EV via ELM327 | Reported working with Car Scanner and a Veepeak BLE+ | Medium | T0.2 spike on this exact car and dongle |
| Equinox EV battery signals | Six community signals in OBDb; upstream 2024 test data (2026-09-22) shows the three `DACB` commands (SOC, SOC high-res, cell min/avg/max) answering on a 2024 and `33E5` not; `33E5` is ≤25.5 V, not HV pack voltage; no temps, current, pack voltage, SOH | **High** | Gate A (T0.2); verify on hardware; port Bolt PIDs as candidates (T2.3) |
| Ultium pack current / energy counter | Unknown; not in OBDb | **High** | Gate B (T2.3); fallback: charger-reported kWh over ΔSOC, with a wider stated error band |
| Non-Ultium hybrids/PHEVs/EVs | Community signalsets only; no such car owned | Medium | Shown as `community`; promoted to `verified` only by a recording (T2.8) |
| HIL bridge from WSL2 | Not feasible as planned: WSL2 has no Bluetooth and the desktop is out of range | Low | Laptop for the T0.2 spike (ADR-003); the phone afterwards (ADR-013); WSL2 mirrored networking confirmed |
| Long BLE sessions on Android (multi-hour charge) | Feasible with a foreground service; power management varies by phone | Medium | Phase 0 is foreground only; charging logger is T2.4 with a full charge as the test |
| Expo dev builds from WSL2 | Feasible via EAS Build plus Metro over LAN | Low–Medium | Start the EAS build early; `--tunnel` as fallback |
| Battery ML data | None yet; needs many charge sessions from several vehicles | High | Beta export with consent (T2.9) before fleet claims; own-car work framed as n=1 case study |
| Beta data consent and privacy | Planned; no backend | Medium | Explicit consent, VIN redaction, provenance in the meta line; user-initiated file export only |
| On-device model runtime in Expo | Pure-TS tree models need nothing; ONNX/TFLite would be a new native module | Low–Medium | Choose in the BM4 spec (rule 7) |
| LLM cost | Opt-in feature; BYOK in beta, per-use cost at store time | Medium | Measure cost per report and per question in BM5; usage cap via the proxy (ADR-007, ADR-009) |
| LLM stating wrong numbers | Real risk for any generated summary | Medium | Deterministic number check before display, template fallback (T2.10) |
| Phone as bridge + MCP relay | Feasible: BLE already on the phone, WebSocket built into React Native, WSL2 mirrored networking | Low–Medium | T0.8 then T0.6; app must stay open during relay sessions (ADR-013) |
| Market claims | Mostly reported, few verified (see Market check) | Medium | Verify before any claim reaches the app or store listing |
| Timeline | Battery phase follows Phase 0 directly; dates provisional | Medium | Re-estimate at each gate; retain task IDs |

## Findings in detail

### The Equinox EV

What is known:

- The [OBDb Chevrolet-Equinox-EV repository](https://github.com/OBDb/Chevrolet-Equinox-EV) (CC-BY-SA-4.0, model years 2023+) defines four Mode 22 commands over 29-bit headers `DA1D` and `DACB`, producing six signals: SOC, SOC high-resolution, HV pack voltage from the drive motor control module, and cell voltage min/avg/max. Three of the four commands are filtered to 2025+ model years in the signalset. Nothing for pack current, temperatures, capacity, state of health, odometer, tire pressure, or 12 V.
- Owners on the [Equinox EV forum](https://www.equinoxevforum.com/threads/odb-2-dongle-and-app-that-you-recommend.6454/) report a Veepeak OBDCheck BLE+ working with the Car Scanner app on a 2024, which means the port is not gatewayed against read-only diagnostics on that model year. Reports also mention protocol changes on 2026+ Ultium vehicles, which do not affect this car.
- [Sidecar](https://sidecar.clutch.engineering/cars/chevrolet/equinox-ev/) lists the car as supported, using the same OBDb data.

Update 2026-09-22: upstream test cases (commit `15ee122`) report the three `DACB` commands answering on a 2024 and `DA1D` `33E5` not; `33E5` decodes to 0–25.5 V, so HV pack voltage is not covered by any known signal and joins current, energy, and temperatures on the T2.3 discovery list. The same test data shows a 2024 answering standard Mode 01 PIDs `30`, `31`, `42`, and `A6` via the 29-bit functional header `DB33`, which matters for the codes report on the EV. Reported, not verified on our car.

What is not known: whether our 2024 car answers the three `DACB` commands (upstream says a 2024 did); what the BECM (battery energy control module) header is on this platform; whether Bolt EV BECM PIDs (well documented at [allev.info](https://allev.info/boltpids/) and on the [Bolt forum](https://www.chevybolt.org/threads/chevrolet-bolt-obd2-pids.26666/)) transfer to Ultium modules. The Bolt uses 11-bit headers to the BECM; Ultium uses 29-bit. Expect some PIDs to carry over and most to need rediscovery.

Consequence: the EV battery report is a Phase 2 item with a hardware spike as its gate. Signal names in the app are never shown as verified unless a recording from this car backs them. Standard Mode 01 on the EV: expect PID 5B (hybrid/EV battery remaining charge) and possibly little else; the spike will show.

### Generic OBD-II on the ICE cars

The Chrysler 200 and Hyundai Elantra are optional bench cars, not recording or app acceptance gates (ADR-015); protocol specifics (CAN headers, per-car Mode 06 support) are in `docs/ELM327.md`.

### The dongle

Veepeak OBDCheck BLE (the non-plus model) is an ELM327-compatible clone over BLE. Per the [ESPHome integration](https://github.com/rubenmuehlhans/esphome-obd2-ble) and [Harry's LapTimer forum](http://forum.gps-laptimer.de/viewtopic.php?t=5332), the BLE service is `FFF0` with `FFF1` and `FFF2` as the two characteristics; which is write and which is notify differs between reports, so T0.2 discovers by properties rather than hardcoding. Default MTU is 20 bytes, so commands and responses are chunked. Clone firmware sometimes lacks `ATAT`, flow-control commands, or `ATFCSM`; the session layer treats `?` as "unsupported, continue" for optional init commands.

### Development environment

WSL2 has no Bluetooth and the desktop is out of BLE range, so the T0.2 spike ran the bridge on a laptop (ADR-003); the phone is the long-term bridge (ADR-013). WSL2 mirrored networking (confirmed on) lets both reach it without port forwarding, and the phone reaches Metro the same way. Expo Go cannot load `react-native-ble-plx`, so development uses an EAS-built dev-client APK with Metro over WSL2, `expo start --tunnel` as fallback; the [config plugin](https://github.com/expo/config-plugins/blob/main/packages/react-native-ble-plx/README.md) sets `isBackgroundEnabled`/`neverForLocation`, and a foreground service for long logging sessions (T2.4) is evaluated against a [fork with built-in support](https://github.com/sfourdrinier/react-native-ble-plx) or a notification library.

### Model and compute costs

The in-app LLM (summary and assistant) is opt-in (ADR-012). In beta it runs on the user's own key; a paid release needs the proxy and a usage cap priced from BM5's measured cost per report and per question. Specs verify model availability and dated rates. Battery models are small and train on CPU; the BM7 distillation stretch states any GPU or rental cost in its spec.

### Battery ML (ADR-012)

The binding constraint is data, not compute: a useful capacity model needs many charge sessions across several vehicles, and a trustworthy interval needs held-out calibration sessions. Until beta data arrives (T2.9), results are an own-car case study. Public lab datasets (listed in [ML.md](ML.md)) are cell-cycling data under their own licenses; they help with method practice, not with Ultium packs.

### Ground truth

No faults are induced; battery faults exist only as synthetic injections into real logs. Capacity is scored against a reference estimate from logged charges, which is itself an estimate (BMS SOC; charger losses if the charger-kWh fallback is used). A handful of vehicles and sessions is enough to catch a biased estimate or a too-narrow interval, not to certify state of health. See `docs/EVAL.md`.

### Market check (2026-09-22)

No dedicated consumer Ultium battery-health app exists, and AI gas-car diagnosis is a crowded space (OBDAI, MECH AI, Skanyx, and others), which is why ADR-012 withdrew that track. Two unverified figures to confirm before any claim reaches the app or a store listing: GM Canada's reported 8-year/160,000 km Equinox EV battery warranty with a ~70% capacity-loss threshold ([thinkev.ca](https://thinkev.ca/blog/ev-warranty-guide-canada-2026)), and a "300,000+ EVs off lease in 2026" figure that has no primary source.

### Timeline

Dates are provisional. BLE and session work depend on spike recordings. The battery phase follows Phase 0 directly (ADR-012) and has two gates: T0.2 (Mode 22 answers) and T2.3 (a current or energy signal exists). BM1–BM6 overlap with data collection and depend on beta vehicles arriving. Re-estimate at each gate.

## Answered questions (2026-09-16)

1. Verified Equinox EV signals are contributed back to OBDb (ADR-010). The app is intended to be sold at a modest price eventually (ADR-009); that is compatible with contributing the data.

## Sources

- [OBDb organization](https://github.com/obdb)
- [My OBD2 Adventure](https://www.equinoxevforum.com/threads/my-obd2-adventure.6851/)
- [Veepeak OBDCheck BLE (product page)](https://veepeak.com/products/obdcheck-ble)
- [react-native-ble-plx](https://github.com/dotintent/react-native-ble-plx)
