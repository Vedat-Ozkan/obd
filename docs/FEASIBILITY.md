# Feasibility

Hardware findings reviewed 2026-09-16; ML scope revised 2026-09-20. Each area has a status, evidence, and next step. "Verified" means checked against a primary source or hardware; "reported" means secondhand; "assumed" means unchecked. This documentation revision does not verify hardware, model availability, GPU compatibility, or prices.

## Summary

| Area | Status | Risk | Mitigation |
|---|---|---|---|
| Generic OBD-II on the two ICE cars | Verified by protocol (both are 2008+ CAN); hardware unverified | Low | T0.2 spike |
| Veepeak BLE from an app | Reported working (BLE service FFF0) | Low | T0.2 discovers characteristics rather than assuming |
| Equinox EV via ELM327 | Reported working with Car Scanner and a Veepeak BLE+ | Medium | T0.2 spike on this exact car and dongle |
| Equinox EV battery signals | Six community signals in OBDb; three flagged 2025+; no temps, current, SOH | **High** | Phase 2 only; verify on hardware; port Bolt PIDs as candidates |
| HIL bridge from WSL2 | Not feasible as planned: WSL2 has no Bluetooth and the desktop is out of range | Low | Run on the laptop near the car (ADR-003); WSL2 mirrored networking confirmed |
| Background BLE logging on Android | Feasible with a foreground service; power management varies by phone | Medium | Phase 0 is foreground only; logger is T1.1 with a 30-minute drive as the test |
| Expo dev builds from WSL2 | Feasible via EAS Build plus Metro over LAN | Low–Medium | Start the EAS build early; `--tunnel` as fallback |
| LLM cost | Must be measured using dated, verified rates | Workload-dependent | Log usage and total experiment costs |
| Training and GPU serving | Planned; compatibility and budget undecided | Medium | Bounded feasibility check and compute choice in ML specs (ADR-011) |
| Training data | Candidate sources only; no audited training set | High | Provenance/license audit, target review, independent splits |
| Ground truth from induced faults | Feasible; small n | Medium | Report honestly; more cars later |
| Mode 06 | Assumed; varies by manufacturer | Low (stretch) | Spike includes it |
| Timeline | ML track added before EV delivery; dates provisional | Medium–High | Re-estimate after prerequisites; retain task IDs |

## Findings in detail

### The Equinox EV

What is known:

- The [OBDb Chevrolet-Equinox-EV repository](https://github.com/OBDb/Chevrolet-Equinox-EV) (CC-BY-SA-4.0, model years 2023+) defines four Mode 22 commands over 29-bit headers `DA1D` and `DACB`, producing six signals: SOC, SOC high-resolution, HV pack voltage from the drive motor control module, and cell voltage min/avg/max. Three of the four commands are filtered to 2025+ model years in the signalset. Nothing for pack current, temperatures, capacity, state of health, odometer, tire pressure, or 12 V.
- Owners on the [Equinox EV forum](https://www.equinoxevforum.com/threads/odb-2-dongle-and-app-that-you-recommend.6454/) report a Veepeak OBDCheck BLE+ working with the Car Scanner app on a 2024, which means the port is not gatewayed against read-only diagnostics on that model year. Reports also mention protocol changes on 2026+ Ultium vehicles, which do not affect this car.
- [Sidecar](https://sidecar.clutch.engineering/cars/chevrolet/equinox-ev/) lists the car as supported, using the same OBDb data.

What is not known: whether the 2024 car answers the three 2025+ commands; what the BECM (battery energy control module) header is on this platform; whether Bolt EV BECM PIDs (well documented at [allev.info](https://allev.info/boltpids/) and on the [Bolt forum](https://www.chevybolt.org/threads/chevrolet-bolt-obd2-pids.26666/)) transfer to Ultium modules. The Bolt uses 11-bit headers to the BECM; Ultium uses 29-bit. Expect some PIDs to carry over and most to need rediscovery.

Consequence: the EV battery report is a Phase 2 item with a hardware spike as its gate. Signal names in the app are never shown as verified unless a recording from this car backs them. Standard Mode 01 on the EV: expect PID 5B (hybrid/EV battery remaining charge) and possibly little else; the spike will show.

### Generic OBD-II on the ICE cars

Both cars are post-2008 US-market and therefore ISO 15765-4 CAN. Mode 01/02/03/07/09/0A and readiness monitors are mandated. Mode 06 is optional in practice; Chrysler generally supports it over CAN, Hyundai varies. Freeze frame is one record per stored DTC on most ECUs. Nothing exotic is expected. The "recently cleared" heuristic depends on PIDs 30 (warm-ups since clear), 31 (distance since clear), and 4E (time since clear), which are widely supported on this era.

### The dongle

Veepeak OBDCheck BLE (the non-plus model) is an ELM327-compatible clone over BLE. Per the [ESPHome integration](https://github.com/rubenmuehlhans/esphome-obd2-ble) and [Harry's LapTimer forum](http://forum.gps-laptimer.de/viewtopic.php?t=5332), the BLE service is `FFF0` with `FFF1` and `FFF2` as the two characteristics; which is write and which is notify differs between reports, so T0.2 discovers by properties rather than hardcoding. Default MTU is 20 bytes, so commands and responses are chunked. Clone firmware sometimes lacks `ATAT`, flow-control commands, or `ATFCSM`; the session layer treats `?` as "unsupported, continue" for optional init commands.

### Development environment

- **WSL2 has no Bluetooth, and the desktop is out of BLE range of the driveway.** The bridge therefore runs on the laptop, in or next to the car, on the home Wi-Fi. `bleak` runs on Windows (WinRT backend) and Linux (BlueZ), so the laptop's OS does not matter. It listens on all interfaces; WSL2 on the desktop reaches it at the laptop's LAN address.
- **WSL2 networking is already mirrored** (`.wslconfig` has `networkingMode=mirrored` and `hostAddressLoopback=true`, Windows build 26200). WSL2 shares the host's LAN address, so the phone reaches Metro and WSL2 reaches the laptop without port forwarding.
- **Consequence for the workflow.** Hardware verification is a session you schedule (laptop out, car on, bridge up), not a button an agent presses. Every session should end with recordings that cover the next several tasks. Longer term, the phone app can serve as the bridge itself (Phase 3 idea), which removes the laptop from the loop.
- **Expo on WSL2.** Expo Go cannot load `react-native-ble-plx`, so a development build is required. EAS Build produces the dev-client APK in the cloud; Metro runs in WSL2 and the phone connects at the desktop's LAN address thanks to mirrored networking, with `expo start --tunnel` as the fallback. Native rebuilds are needed only when native dependencies or the config plugin change, which is rare after T0.8. The [config plugin](https://github.com/expo/config-plugins/blob/main/packages/react-native-ble-plx/README.md) sets `isBackgroundEnabled` and `neverForLocation`; a foreground service for background logging is separate (T1.1) and there is a [fork with built-in foreground-service support](https://github.com/sfourdrinier/react-native-ble-plx) to evaluate against doing it with a notification library.

### Model and compute costs

Earlier model names and price estimates are not a verified current budget. Before an experiment, verify exact model availability and dated rates. Record input/output/cached tokens for APIs, and training/rental duration plus startup/idle time for GPU runs. Separate marginal request cost from the full experiment expense. Prompt size and cache savings are measured on the actual case workload. No spending cap is selected yet.

### Fine-tuning and inference engineering (ADR-011)

The recorded hardware inventory is an AMD RX 6600 and a 7900-class card on Windows/WSL2. Exact GPU, VRAM, OS/driver/runtime support, and usable training memory need verification; do not assume both cards form one usable memory pool. Local compute avoids rental expense but may add compatibility work. Rented compute can simplify environment selection but requires an agreed cap and teardown plan. The choice remains open.

Start with a small instruction model and LoRA, using QLoRA if memory warrants it. Run a bounded compatibility/memory smoke test before a full training job. Model size, context length, batch size, runtime, and precision affect feasibility. Candidate training tools and primary references are in [ML.md](ML.md); no dependencies are installed by the roadmap.

Serving experiments compare caching, quantization, concurrency, and request sizes under controlled workloads. Lower memory use does not guarantee lower latency; measure both and repeat quality checks. The hosted app baseline remains available regardless of experiment outcomes. Inference engineering is now justified as a learning goal, not an assumed cost-saving production requirement.

### Training data

No audited training dataset exists yet. Public automotive datasets vary in task fit, provenance, and permissions; some closely related instruction datasets are synthetic and labeled noncommercial. Candidate sources and limitations are listed in [ML.md](ML.md). They must be reviewed before use, especially given the paid-app intent.

Teacher-generated targets can reproduce teacher errors. Review targets, include healthy/ambiguous cases, deduplicate, and split by source session before augmentation. The small real fleet supports case studies and failure discovery, not broad generalization or calibrated confidence claims. Keep external, synthetic, and real measurements separate.

### Ground truth

Six induced faults on the Chrysler and three on the Elantra give about nine labeled fault cases plus baselines. That is enough to catch an engine that is confidently wrong and not enough to claim an accuracy percentage with any precision. The eval report states n, lists every case, and shows per-case results rather than a single headline number. See `docs/EVAL.md`.

### Timeline

The original Phase 0/1 dates are provisional. BLE and session work depend on spike recordings; diagnostic evaluation depends on independent labeled sessions. ML1–ML6 now follow that baseline and precede EV delivery. Data review and compute compatibility are additional schedule risks. Re-estimate Phase 2 after ML6; its scope still depends on what the car answers. No simultaneous product/ML delivery is assumed.

## Answered questions (2026-09-16)

1. The desktop is not within Bluetooth range; a laptop is available and hosts the bridge (ADR-003).
2. The dongle is the Veepeak OBDCheck BLE, non-plus. Forum reports of the BLE+ on the Equinox EV are encouraging but not the same unit; T0.2 settles it.
3. WSL2 mirrored networking is on (checked in `.wslconfig`).
4. Verified Equinox EV signals are contributed back to OBDb (ADR-010). The app is intended to be sold at a modest price eventually (ADR-009); that is compatible with contributing the data.

## Sources

- [OBDb Chevrolet-Equinox-EV](https://github.com/OBDb/Chevrolet-Equinox-EV) and the [OBDb organization](https://github.com/obdb)
- [Equinox EV forum: dongle and app recommendations](https://www.equinoxevforum.com/threads/odb-2-dongle-and-app-that-you-recommend.6454/) and [My OBD2 Adventure](https://www.equinoxevforum.com/threads/my-obd2-adventure.6851/)
- [Sidecar: Chevrolet Equinox EV OBD-II support](https://sidecar.clutch.engineering/cars/chevrolet/equinox-ev/)
- [Chevy Bolt OBD2 PIDs (allev.info)](https://allev.info/boltpids/), [Bolt forum PID thread](https://www.chevybolt.org/threads/chevrolet-bolt-obd2-pids.26666/)
- [Veepeak OBDCheck BLE](https://veepeak.com/products/obdcheck-ble), [ESPHome OBD2 BLE](https://github.com/rubenmuehlhans/esphome-obd2-ble), [Harry's LapTimer Veepeak thread](http://forum.gps-laptimer.de/viewtopic.php?t=5332)
- [react-native-ble-plx](https://github.com/dotintent/react-native-ble-plx), [Expo config plugin](https://github.com/expo/config-plugins/blob/main/packages/react-native-ble-plx/README.md), [foreground-service fork](https://github.com/sfourdrinier/react-native-ble-plx)
