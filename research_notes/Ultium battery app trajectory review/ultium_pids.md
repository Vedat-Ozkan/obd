# Ultium (GM BEV3 / BT1) diagnostic identifiers for battery health — public and community inventory, September 2026

Scope note: I checked everything below on 2026-09-23. "OBDb test case" means a raw captured CAN response paired with a decoded value, committed to an OBDb repo by that repo's automated "Update command data" PRs. Those PRs are generated from user-contributed captures. Headers are written the way the sources write them. `DAxx` is OBDb shorthand for the 29-bit physical request `18DAxxF1` (or `14DAxxF1` at CAN priority 0x14), and the reply is `18DAF1xx` (or `142AF1xx`).

## Q1. Which projects and apps publish Ultium battery DIDs, and what exactly do they publish?

### Takeaway
There is no mature public Ultium PID set. The public sources come down to:
- OBDb (4 BECM/DMCM DIDs, shared across the Chevrolet, Cadillac, GMC and Buick make signalsets)
- two unmerged OBDb Lyriq PRs (August 2026)
- one open WiCAN issue for the 2027 Bolt, plus two small WiCAN profiles
- one very detailed 2024 Hummer EV reverse-engineering repo (September 2026)
- one Flutter/Lyriq RE repo

Pack current (DMCM `0x17` DID `2414`) and pack voltage (DMCM `0x17` DID `2885`) both come from these community sources. Both were cross-validated independently on a Hummer EV, and `2414` also on a Lyriq. I found no published Equinox-specific current, SOH or capacity DID.

### Cited Findings

**OBDb (main branch, merged)**
- OBDb/Chevrolet-Equinox-EV `signalsets/v3/default.json` defines exactly four commands:
  - `DA1D 22 33E5` "DMCM battery voltage", 8-bit ÷10 V, max 25.5 V. It is scoped to MY2024–2026.
  - `DACB 22 27C6` SoC (high res), u16 ×100/65535 %.
  - `DACB 22 2AF5` cell voltage avg/min/max, u16 ÷10000 V at bit offsets 0/16/32.
  - `DACB 22 2B43` SoC, u8 ×100/255 %.
  - The three DACB commands have `dbgfilter from 2025`.
  - These signals were added on 2025-04-28 in commits "Add potential SoC pid", "Add more battery pids" and "Add min/max voltage pids".
  - — [OBDb signalset](https://github.com/OBDb/Chevrolet-Equinox-EV/blob/main/signalsets/v3/default.json); [commit history](https://github.com/OBDb/Chevrolet-Equinox-EV/commits/main/signalsets/v3/default.json)
- The same four DIDs, with identical formulas, sit in the make-level signalsets OBDb/Chevrolet, OBDb/Cadillac, OBDb/GMC and OBDb/Buick. Those signalsets also list the Bolt-era `7E4 22 434F` HV battery temp (byte − 40 °C). — [OBDb/Chevrolet](https://github.com/OBDb/Chevrolet/blob/main/signalsets/v3/default.json), [OBDb/Cadillac](https://github.com/OBDb/Cadillac/blob/main/signalsets/v3/default.json), [OBDb/GMC](https://github.com/OBDb/GMC/blob/main/signalsets/v3/default.json)
- **Equinox EV 2024 test cases (real captures, reply header `18DAF1CB`):**
  - 27C6: `18DAF1CB056227C6B18E` decodes to 69.358 %.
  - 2B43: `...622B43 B0 00 B1 | B1×7 | B1 B1 00…` decodes to 69.02 % from byte 0. The 29-byte payload is 3 header bytes, 26 data bytes.
  - 2AF5: `...622AF5 9916 990D 991F 2F 06 02 01` decodes to avg 3.9190 / min 3.9181 / max 3.9199 V.
  - — [DACB.2227C6.yaml](https://github.com/OBDb/Chevrolet-Equinox-EV/blob/main/tests/test_cases/2024/commands/DACB.2227C6.yaml), [DACB.222B43.yaml](https://github.com/OBDb/Chevrolet-Equinox-EV/blob/main/tests/test_cases/2024/commands/DACB.222B43.yaml), [DACB.222AF5.yaml](https://github.com/OBDb/Chevrolet-Equinox-EV/blob/main/tests/test_cases/2024/commands/DACB.222AF5.yaml)
- **Equinox EV 2024 `command_support.yaml`:**
  - Supported: DACB 27C6/2AF5/2B43, and Mode 01 on DB33 (0101, 010D, 011C, 011F, 0121, 0130, 0131, 0141, 0142, 01A6 odometer).
  - Unsupported: DA1D 33E5, every Bolt 11-bit DID on 7E4 (434F, 4368, 4369, 436B, 436C, 4373, 43A5, 43AF, 4531, 8334), and every 7E7 4181–4240 cell DID.
  - — [2024 command_support.yaml](https://github.com/OBDb/Chevrolet-Equinox-EV/blob/main/tests/test_cases/2024/command_support.yaml)
- **Equinox EV 2025 `command_support.yaml`:**
  - DA1D 33E5 is supported, with replies of 12.0 and 14.5 V (`18DAF11D046233E578` / `…91`).
  - DACB 27C6, 2AF5 and 2B43 are listed as **unsupported**.
  - — [2025 command_support.yaml](https://github.com/OBDb/Chevrolet-Equinox-EV/blob/main/tests/test_cases/2025/command_support.yaml), [DA1D.2233E5.yaml](https://github.com/OBDb/Chevrolet-Equinox-EV/blob/main/tests/test_cases/2025/commands/DA1D.2233E5.yaml)
- **OBDb/Cadillac-LYRIQ 2024 test cases:**
  - The same three DACB DIDs answer.
  - 2B43 carries pack SOC, a 00 byte, then **12** per-module bytes, e.g. `87 00 86 87 87 86 86 87 87 87 86 87 87 86`.
  - 2AF5 includes `…5A 0C 37 07` and `…60 0C 13 03`.
  - DA28 4A7A, 4A7C, 4C2D, 4C2F and 4C30 (wheel speeds, brake pressure, steering, lateral/longitudinal g) also answer.
  - The same Bolt 7E4 and 7E7 DIDs are unsupported.
  - — [Lyriq command_support](https://github.com/OBDb/Cadillac-LYRIQ/blob/main/tests/test_cases/2024/command_support.yaml), [Lyriq 2AF5](https://github.com/OBDb/Cadillac-LYRIQ/blob/main/tests/test_cases/2024/commands/DACB.222AF5.yaml), [Lyriq 2B43](https://github.com/OBDb/Cadillac-LYRIQ/blob/main/tests/test_cases/2024/commands/DACB.222B43.yaml)
- **Other OBDb Ultium repos:**
  - Chevrolet-Blazer-EV, Chevrolet-Silverado-EV and Cadillac-LYRIQ have empty model signalsets (`"commands": []`), so they inherit from the make signalset.
  - Blazer EV 2024 test data shows only Mode 01.
  - Honda-Prologue and Acura-ZDX test data show only Mode 01. Honda-style DA01/DA16 cell DIDs (202x) are all unsupported on them.
  - I found no OBDb repo for Hummer EV, Sierra EV, Optiq, Escalade IQ or BrightDrop (raw URL 404s and an org search).
  - — [Blazer](https://github.com/OBDb/Chevrolet-Blazer-EV), [Prologue 2025 command_support](https://github.com/OBDb/Honda-Prologue/blob/main/tests/test_cases/2025/command_support.yaml), [Acura ZDX](https://github.com/OBDb/Acura-ZDX/blob/main/tests/test_cases/2024/command_support.yaml)

**OBDb/Cadillac-LYRIQ PR #13 and #14 (open, unmerged; author Daniel085; 2026-08-14 and 2026-08-16; 2025 Lyriq)**

PR #14 table:

| DID | Formula | Evidence given |
|---|---|---|
| `DA17 22 2414` pack current | s16 ÷20 A, negative = charging | test vectors `18DAF11705622414FE39` = −22.75 A and `…0012` = +0.9 A; −22.75 A at a 9.22 kW AC charge |
| `DA17 22 2429` | u16 ÷64 "nominal V", constant 352.1 V | copies at 2428, 242D, 2434, 2489 |
| `DA40 22 448F` odometer | u32 ÷64 km | — |
| `DA40 22 4149` EVSE pilot current | u16 ÷10 A | — |
| `DA40 22 416C/416D/416E` group voltages | u16 ÷100 V, ~51 V | read 0 when off |
| `DA40 22 434F` HV battery temp | byte − 40 °C | — |
| `DA40 22 4127/4124` pack temps | u16 ÷32 °C | — |
| `DA40 22 40E5/40E6` coolant temps | u16 ÷32 °C | — |

PR #14 also says `2233E5` is **the 12 V rail, not pack voltage**. It answers on ECUs 17, 1D and 28 at 13.1–13.9 V. — [PR #14](https://github.com/OBDb/Cadillac-LYRIQ/pull/14), [PR #13](https://github.com/OBDb/Cadillac-LYRIQ/pull/13)

**Daniel085/OBD_Battery-diagnostics (Flutter app, created 2026-08-17, last pushed 2026-09-18)**

This repo documents Lyriq ECU-40 (`18DA40F1`) candidates that are not in the PRs:
- `44C0`: displayed SOC candidate, 4 bytes.
- `44C1`: SOC min/max pairs.
- `443C` and `4441` = 100, and `451D` = 99: all "SOH% candidates".
- `44C5`: static "capacity record candidate". Its bytes `01 60 03 62 00 60 03 62` are read as 352/866 and 96/866, i.e. "86.6 kWh?".
- `441F`: a durable charge-session record.
- `415B`: the same register as `448F`.

It also reports:
- Bolt capacity and SOC DIDs `41A3`, `8334`, `43AF`, `4531` and `43A5` return NRC 0x31. Its conclusion: "GM-reported capacity via OBD port: CLOSED".
- A coulomb-count capacity measurement of 292 ± 8 Ah ≈ 103 ± 3 kWh, about 100 % SOH.
- A hidden ECU `53` that rejects `1003` with `7F 10 12`.

— [lyriq-re-log.md](https://github.com/Daniel085/OBD_Battery-diagnostics/blob/main/docs/lyriq-re-log.md), [lyriq-did-map.md](https://github.com/Daniel085/OBD_Battery-diagnostics/blob/main/docs/lyriq-did-map.md), [README](https://github.com/Daniel085/OBD_Battery-diagnostics)

**meatpiHQ/wican-fw issue #884 "Chevrolet Bolt EV (2027 Ultium/BEV3)" (open, 2026-08-14, user skyw33)**

Init: `ATSP7;ATCP14;ATSHDACBF1;ATCRA142AF1CB;ATFCSH14DACBF1;ATFCSD300000;ATFCSM1`. Offsets count from the start of the ISO-TP payload, so B4 is the first data byte.

| DID | Module | Name | Formula |
|---|---|---|---|
| `27C6` | BECM | SOC | [B4:B5]/655.35 |
| `27C0` | BECM | distance since full charge | [B4:B6]×0.060849+0.354 mi |
| `27BF` | BECM | charge-cycle regen gained | [B4:B6]×0.059116+0.1234 mi |
| `27BB` | BECM | charge-cycle thermal kWh | [B4:B6]×0.009560+0.1733 |
| `27B5` | BECM | charge-cycle thermal distance | — |
| `2709` | BECM | A/C compressor temp | B4×1.3988−35.974 °F |
| `2AF1` | BECM | battery module temp | B5×1.8−112 °F |
| `2885` | DMCM1, `ATSHDA17F1` / `142AF117` | pack voltage | [B4:B5]/100 V |

The author says these are fitted and "verified with WiCAN's Test button". — [wican-fw #884](https://github.com/meatpiHQ/wican-fw/issues/884)

**meatpiHQ/wican-fw vehicle profiles (merged)**
- `vehicle_profiles/bt1/bt1.json` (2026-06/07) covers "BT1: Hummer EV, Silverado EV, Sierra AV; BEV3: Lyriq, Celestiq, Blazer EV, Equinox EV, Prologue, ZDX". It has one DID: `2227C6` SOC `[B8:B9]/655.35`, at CAN priority 0x14. — [bt1.json](https://github.com/meatpiHQ/wican-fw/blob/main/vehicle_profiles/bt1/bt1.json)
- `gmc/sierra-ev.json` (2025-11-08) has these DIDs, all at `14DACBF1`/`142AF1CB`: — [sierra-ev.json](https://github.com/meatpiHQ/wican-fw/blob/main/vehicle_profiles/gmc/sierra-ev.json)
  - `27C6` SOC /655.35
  - `27AF` "HV_CAPACITY_R" [B4:B5]/100
  - `0046` TMP_A (B4−40)×1.8+32 °F
  - `27C7` range [B4:B6]/103
  - `5401` "CHARGER_DC_PWR" [B4:B5]/4350
  - `27C0` distance since full charge /16.09344
- `honda/prologue.json` (2025-05-05) has one entry, `222B435`, "SOC B5/255". The DID string looks malformed (5 hex digits), and the formula gives a fraction rather than a percent. — [prologue.json](https://github.com/meatpiHQ/wican-fw/blob/main/vehicle_profiles/honda/prologue.json)

**JeremyWhittaker/hummer_obdII (2024 GMC Hummer EV, BT1; created 2026-09-01, last pushed 2026-09-21; OBDLink MX+ at `ATSP7`)**

This is the most rigorous public Ultium reverse-engineering source. Every signal carries an evidence level.

Module `CB` (BSM):

| DID | Signal | Formula | Level |
|---|---|---|---|
| `27C6` | SOC | /655.35 | measured; 0.5 pp quantum discharging, 0.4 pp charging |
| `27AF` | energy remaining | /100 kWh | measured; energy ÷ SOC gives a constant 191.8–191.9 kWh |
| `27C7` | range | /103 mi | measured |
| `2AF5` | cell avg/min/max | ÷10000 | measured |
| `27C0` | distance since full | — | read |
| `0046` | temp | — | read |
| `5401` | charging-state enum | 0x00 parked; 0x91–0x99 charging; other states seen | "the /4350 charger-power scaling is wrong" |
| `2AF1` | 24 values | (x−40)/2 ≈ pack temp | raw |
| `27BB` | accumulator, not a mode signal | — | — |

Module `17` (DMCM):

| DID | Signal | Formula | Level |
|---|---|---|---|
| `2885` | pack voltage | u16/100 V | measured; `1D` and `1E` also answer it |
| `2414` | pack current | s16/20 A, negative = charging | measured; V×I = 8.14 kW vs 7.7 kW from the energy slope |
| `2429` | **not a voltage** | — | a bipolar torque/load signal with zero at 0x5806 |

Modules `17`/`1D`/`1E`: `33E5` is the 12 V rail.

Module `40` (reachable only at priority 0x18): Lyriq PR #14 DIDs answer, kept raw.

Other results:
- Measured pack resistance was 18.6 mΩ.
- The pack is 96 series cells (2885/2AF5 ratio 95.99).
- — [TELEMETRY_CATALOG.md](https://github.com/JeremyWhittaker/hummer_obdII/blob/main/docs/TELEMETRY_CATALOG.md), [PACK_ARCHITECTURE.md](https://github.com/JeremyWhittaker/hummer_obdII/blob/main/docs/PACK_ARCHITECTURE.md), [GM_ENHANCED_CANDIDATES.md](https://github.com/JeremyWhittaker/hummer_obdII/blob/main/docs/GM_ENHANCED_CANDIDATES.md)

Hummer deep scan of 7,424 DIDs across six modules (912 answers):
- CB runs:
  - `2AE1–2AF0`: **16 DIDs × 36 bytes**
  - `2B48–2B56`: 15 × 45 B
  - `2B74`: 448 B
  - `2B65`/`2B66`/`2B67`/`2B72`: 224 B each
  - Two runs of 24 single-byte DIDs, `276E–2785` and `2793–27AA`, whose length "match[es] the pack's module count".
- The author tested arrays against 2AF5 using only 1- and 2-byte element widths, and "No captured array reproduces it".
- Security-locked DIDs (`7F 22 33`) exist only on drive units: `27AC`, `27AD`, `27DC–27E2`, `27E9`, `27EC`.
- — [SCAN_RESULTS_2026-09-20.md](https://github.com/JeremyWhittaker/hummer_obdII/blob/main/docs/SCAN_RESULTS_2026-09-20.md)

**Commercial apps and forums**
- Car Scanner ELM OBD2 is widely described as the most versatile EV app, using manufacturer-specific profiles and custom PIDs. I found no page confirming an Equinox or Ultium battery profile with cell data. — [OBDadvisor](https://obdadvisor.com/obd2-scanner-electric-car/), [Car Scanner custom PIDs](https://www.carscanner.info/custompids/)
- An equinoxevforum thread ("My OBD2 Adventure") reports a Veepeak OBDCheck BLE+ plus Car Scanner on Android, and says "GM is using a newer protocol in the 2026 models". I only saw this through a search snippet; the forum redirects to a paywalled tollbit host that did not resolve. — [equinoxevforum thread](https://www.equinoxevforum.com/threads/my-obd2-adventure.6851/)
- Also from search snippets only: Torque Pro is used on the Bolt but "doesn't work on the Equinox EV". — [equinoxevforum "Any battery health apps"](https://www.equinoxevforum.com/threads/any-battery-health-apps-for-equinox-ev.4983/)
- The Hummer author cites other threads on the Silverado EV, Hummer and Lyriq forums about OBD dongles. — [silveradoevforum](https://www.silveradoevforum.com/threads/obd2-solutions.3006/), [cadillacforums Lyriq OBD](https://www.cadillacforums.com/threads/lyriq-obdii-port-and-scan-tools.1133066/)
- The WiCAN protocol notes list GM Ultium addressing (priority 0x14, `0x14DACBF1` → `0x142AF1CB`) for Hummer, Silverado and Sierra EV, Lyriq, Celestiq, Blazer EV, Equinox EV, Prologue and ZDX. — [canair VEHICLE-PROTOCOLS.md](https://github.com/philipkocanda/canair/blob/main/profiles/VEHICLE-PROTOCOLS.md)

### Inferences
- **2B43 layout (strong):** pack SOC byte, a 00 byte, then N per-module SOC bytes, zero-padded to 26 bytes. N = 10 on the 2024 Equinox and N = 12 on the 2024 Lyriq, which matches the Lyriq's 12-module pack. The developer's reading ("pack SOC + 10 per-module SOC bytes") matches public captures, with one correction: a 00 byte sits between them. Scaling for the per-module bytes is presumably the same /255, but no source states it.
- **2AF5 tail bytes (strong):** on both vehicles, bytes 6–9 are `[group index][module]` twice. Examples:
  - Equinox: 0x2F=47/mod 6, 0x4B=75/mod 10, 0x42=66/mod 9, 0x14=20/mod 3; the other pair is always group 2 or 6 in module 1.
  - Lyriq: 0x5A=90/mod 12, 0x37=55/mod 7, 0x60=96/mod 12, 0x13=19/mod 3, 0x2E=46/mod 6.

  Group index/module is consistent with 8 groups per module every time. So this confirms the developer's reading and implies 80 groups on the Equinox and 96 on the Lyriq. Which pair is min and which is max is **not** established by any source. The Hummer author observed bytes 7 and 9 constant (15 and 23) and left them raw, which fits 24 modules and fixed extreme-cell locations.
- **2AE1–2AE7 as 80 × 3-byte records (moderately corroborated):** at 36 bytes per DID, a 3-byte `[u16 V][module]` record gives 12 records per DID. On the Equinox, 80 records need 7 DIDs (2AE1–2AE7). On the Hummer, 192 records (24 modules × 8) need exactly 16 DIDs, and the Hummer's observed run is exactly 2AE1–2AF0, 16 × 36 B. The Hummer author's 1-/2-byte-element test could not have found a 3-byte stride. This is my inference, not a published decode.
- **Pack size check:** 80 series groups × ~4.08 V at 85 % SOC ≈ 326 V. That matches the developer's `2AF7` ≈ 326.1 V candidate. It also fits 10 × ~8.5 kWh modules ≈ 85 kWh, with Lyriq at 12 modules ≈ 102 kWh. No public source defines `2AF7`, so it remains the developer's own candidate.
- **27AF:** the developer's "energy-like, rises when charging" matches the Hummer's measured `27AF` = energy remaining, u16/100 kWh (WiCAN name HV_CAPACITY_R). Energy ÷ SOC gives the BMS's working usable capacity, which is a usable SOH proxy.
- **Single-byte runs:** the Hummer run `2793–27AA` (24 = module count) starts at the same DID as the developer's `2793–27A1`. That supports the developer's per-module-temperature reading, but no public source decodes these as raw−40 °C. The `2AF1` module-temp scaling is itself contested: WiCAN #884 gives °F = x×1.8−112 (i.e. °C = x−80), while the Hummer gives (x−40)/2 as a single-sample fit.
- **276D ≈ SOC×65535, 2979/297D/2982, 27CD/27CE:** no public source mentions these DIDs.

### Gaps
- I could not read equinoxevforum, blazerevforum or lyriqforum threads (tollbit redirect or DNS failure), or reddit. Any PID lists posted only there are not captured here.
- I found no public source for Car Scanner's Ultium profile contents, OBD Fusion EV add-ons, EVNotify or ABRP Ultium support.
- commaai/opendbc: not checked in depth. It is CAN-bus DBC work, not diagnostic DIDs.
- I found no public source for Equinox 2AE1–2AE7, 2AF7, 276D, 2771–277F, 2793–27A1, 2979/297D/2982 or 27CD/27CE.

## Q2. Is pack current, and GM's own SOH or capacity estimate, readable over OBD on Ultium? Does it need a session or security access?

### Takeaway
Pack current is readable in the default session with plain Mode 22, on the **drive motor control module 0x17** (DID `2414`, s16/20 A, negative = charging), not on the BECM. It is confirmed on a 2025 Lyriq and a 2024 Hummer EV. GM's own SOH/capacity DID is not publicly identified. The candidates are Lyriq ECU-40 `443C`/`4441`/`451D` (single-sample SOH-like bytes) and the BECM energy-remaining `27AF` (/100 kWh), from which capacity can be derived.

### Cited Findings
- On a 2025 Lyriq, `18DA17F1 22 2414` → `18DAF117 05 62 2414 FE39` = −22.75 A while charging at 9.22 kW AC, and +0.9 A in Ready. It is described as the Lyriq analog of the Bolt's `7E1 22 2414`. — [OBDb/Cadillac-LYRIQ PR #14](https://github.com/OBDb/Cadillac-LYRIQ/pull/14); [lyriq-re-log.md](https://github.com/Daniel085/OBD_Battery-diagnostics/blob/main/docs/lyriq-re-log.md)
- On a 2024 Hummer EV, `2414` and `2885` on module 17 read 388.60 V, −20.95 A and −8.14 kW during AC charge. A drive swung current from −275 A to +630 A with 27 sign reversals. — [TELEMETRY_CATALOG.md §1b](https://github.com/JeremyWhittaker/hummer_obdII/blob/main/docs/TELEMETRY_CATALOG.md)
- No session change or security access was used for these. Security-locked DIDs (`7F 22 33`) exist only on the drive units (`27AC`, `27AD`, `27DC–27E2`, `27E9`/`27EC`). — [SCAN_RESULTS_2026-09-20.md](https://github.com/JeremyWhittaker/hummer_obdII/blob/main/docs/SCAN_RESULTS_2026-09-20.md)
- **SOH/capacity:**
  - Lyriq candidates `443C`=100, `4441`=100, `451D`=99, and capacity record `44C5`, all on ECU 40, all unconfirmed.
  - Bolt capacity DID `41A3` (u16 ÷10 Ah on 7E4) and SOC DIDs `8334`/`43AF` return NRC 0x31 on the Lyriq.
  - — [lyriq-re-log.md](https://github.com/Daniel085/OBD_Battery-diagnostics/blob/main/docs/lyriq-re-log.md)
- The Hummer project lists "state of health, contactor state" at CB/CD as absent. Module `CD` (a second BSM address) answers `7F 22 31` to everything tried. — [GM_MODULE_MAP.md](https://github.com/JeremyWhittaker/hummer_obdII/blob/main/docs/GM_MODULE_MAP.md)
- A marketing article claims a dealer can pull an SOH % from the BECM with GM tools, and recommends STN adapters for Lyriq 29-bit ISO-TP. It is a secondary, low-authority source. — [Recharged](https://recharged.com/articles/cadillac-lyriq-state-of-health)
- Charger-side Bolt DIDs `4368–436C`/`4373` return NRC 0x31 on the Lyriq even during AC charging. — [PR #14](https://github.com/OBDb/Cadillac-LYRIQ/pull/14)

### Inferences
- The developer's "no sign-flipping pack current found yet" fits both sources, which put current on DMCM 0x17 rather than the BECM. The first thing to try on the Equinox is `18DA17F1 22 2414` and `22 2885`. Module 0x17 already answers functional OBD in the developer's recordings.
- The developer's 2979/297D/2982 "unsigned power magnitude" candidates may be derived values. Nothing public supports that.

### Gaps
- I found no public Equinox capture of `2414` or `2885`.
- I found no published GM BECM SOH DID for any Ultium vehicle.
- Whether GDS2 reads SOH from CB with an authenticated session is not established publicly. The Hummer author lists it as an open question.

## Q3. Known issues: gateway and security changes, model-year and OTA differences, behaviour when off or charging

### Takeaway
There is real evidence that **2025+ Ultium vehicles gateway-filter Mode 22 to the BECM (CB)**. The 2025 Lyriq author proved CB answers J1979 but not 22xx. OBDb's 2025 Equinox capture lists all three DACB DIDs as unsupported, while the 2024 Equinox and 2024 Lyriq answer them. Addressing is also subtle: GM uses CAN priority 0x14 or 0x18 per module. Module availability also depends on wake mode.

### Cited Findings
- **2025 Lyriq:**
  - CB answers `0100` but never `22F190` or any 22xxxx.
  - "12+ combinations" of headers, flow control and sessions were tried.
  - All 256 physical 29-bit addresses were probed.
  - 11-bit 7E0–7E7 is "entirely gateway-filtered".
  - — [lyriq-did-map.md](https://github.com/Daniel085/OBD_Battery-diagnostics/blob/main/docs/lyriq-did-map.md); [PR #13/#14](https://github.com/OBDb/Cadillac-LYRIQ/pull/14)
- OBDb Equinox 2025: DACB 27C6/2AF5/2B43 are unsupported, and DA1D 33E5 is supported. Equinox 2024: the reverse. — [2025 command_support](https://github.com/OBDb/Chevrolet-Equinox-EV/blob/main/tests/test_cases/2025/command_support.yaml), [2024 command_support](https://github.com/OBDb/Chevrolet-Equinox-EV/blob/main/tests/test_cases/2024/command_support.yaml)
- **Priority is per module on the 2024 Hummer:**
  - Answers at both 0x14 and 0x18: CB, 17, 1D, 1E.
  - Answers only at 0x18: 40. At 0x14, 40 gives NO DATA.
  - Module 28 answers 0x14 but returns `7F 22 11` at 0x18.
  - Gateway 45 returns `7F 22 31` to ISO ID DIDs.
  - — [CAN_PRIORITY.md](https://github.com/JeremyWhittaker/hummer_obdII/blob/main/docs/CAN_PRIORITY.md)
- Parked, Mode 01 on module 17 answered 0142 in only 22–27 % of samples, while Mode 22 `33E5` answered reliably. — [CAN_PRIORITY.md](https://github.com/JeremyWhittaker/hummer_obdII/blob/main/docs/CAN_PRIORITY.md)
- Passive CAN monitoring at the DLC for 30.1 s, parked and awake, returned zero bytes (no broadcast traffic past the gateway). — [ACCESS_MATRIX.md](https://github.com/JeremyWhittaker/hummer_obdII/blob/main/docs/ACCESS_MATRIX.md)
- **Wake mode:**
  - Unattended AC charging leaves ECU 40 "sparse": `416C/D/E` read 0 and `441F` stays empty. Vehicle-on charging populates everything.
  - "ECU CB/1D/40 sleep fast when idle."
  - — [lyriq-re-log.md](https://github.com/Daniel085/OBD_Battery-diagnostics/blob/main/docs/lyriq-re-log.md), [lyriq-did-map.md](https://github.com/Daniel085/OBD_Battery-diagnostics/blob/main/docs/lyriq-did-map.md)
- SOC `27C6` steps in 0.4 pp quanta while charging and 0.5 pp while discharging, and lags. For live charge tracking, energy `27AF` works better. — [TELEMETRY_CATALOG.md](https://github.com/JeremyWhittaker/hummer_obdII/blob/main/docs/TELEMETRY_CATALOG.md)
- **Mislabels to avoid:**
  - `33E5` is the 12 V rail on 17/1D/1E/28, not HV. OBDb's signal ID `*_HVBAT_V` is misleading, although its name says "DMCM battery voltage".
  - `2429` is not nominal pack voltage.
  - `5401` is not charger DC power.
  - — [PR #14](https://github.com/OBDb/Cadillac-LYRIQ/pull/14), [TELEMETRY_CATALOG.md](https://github.com/JeremyWhittaker/hummer_obdII/blob/main/docs/TELEMETRY_CATALOG.md)

### Inferences
- The 2025 gateway block may be a model-year SDGM/firmware change, or a priority issue. The Lyriq author's write-up never mentions trying priority 0x14 (`ATCP14`), which WiCAN and the Hummer use for CB. That is my reading of the docs; I found no explicit test.
- OBDb's 2025 Equinox "unsupported" could also be a capture made while the BECM was asleep.
- Either way, the developer's 2024 Equinox results may not carry over to MY2025+, and the app should handle a CB that is silent on Mode 22.
- An OTA could plausibly change gateway filtering, but I found no public report of an OTA removing DIDs.

### Gaps
- I found no public report on the 2026 Equinox. The forum snippet says "GM is using a newer protocol in the 2026 models", unverified; it may mean CAN FD or J1979-2.
- I found no public report on OTA-driven DID changes.

## Q4. GM Global B / VIP architecture and third-party read-only access

### Takeaway
Global B (VIP) puts a Serial Data Gateway Module (SDGM) between the DLC and the internal buses. Public sources agree it blocks raw bus access and gates programming. Plain Mode 22 reads still pass to at least some modules, since everything above was read through the DLC with ELM/STN adapters. Whether GDS2-level data display needs authentication is publicly unresolved.

### Cited Findings
- The 2020 Cadillac CT5 was the first Global B vehicle. The Gen-3 SDGM "closes the front door (DLC)" to network-level tools. The DLC loop is now two 60 Ω resistors in series. Tool-access policy is unknown per the author. — [diag.net GM Network Diagnostic Opportunities](https://diag.net/msg/m10du7dhoyesvgeq01o1qvv9xu)
- Global B/VIP modules verify commands, and key or module programming needs an authorized session. — [search snippet, fwlocksmith](https://fwlocksmith.com/blog/gm-global-b-key-programming-2020-plus-fort-worth/)
- The Hummer author could not establish whether GDS2 Data Display on a 2021+ Global B vehicle needs an authenticated session. Third-party sources describe Techline Connect handling Secure Gateway authentication for programming. — [OEM_DIAGNOSTIC_WORKFLOW.md](https://github.com/JeremyWhittaker/hummer_obdII/blob/main/docs/OEM_DIAGNOSTIC_WORKFLOW.md)
- On the Lyriq, hidden ECU `53` acks `3E00` but rejects `1003` (`7F 10 12`) and ID DIDs. — [lyriq-did-map.md](https://github.com/Daniel085/OBD_Battery-diagnostics/blob/main/docs/lyriq-did-map.md)

### Inferences
- For a read-only app, Global B means: expect the gateway to decide per module and per service. Don't count on sniffing broadcast traffic. Never attempt 27/2E/31 (this also matches project hard rule 5).

### Gaps
- There is no GM public documentation of SDGM filtering rules.

## Q5. Standard J1979 / J1979-2 / J1979-3 (ZEVonUDS) EV PIDs on Ultium

### Takeaway
Standard Mode 01 EV PIDs exist: `5B` (hybrid battery remaining life) and `9A` (hybrid/EV system data, battery voltage). No public 2024–2025 Ultium capture shows them supported. ZEVonUDS (SAE J1979-3) defines standardized EV DIDs, including SOH at `F4B2`. It phases in from MY2026 (40 % of ZEVs) and reaches 100 % by MY2027–2028. For Ultium, the 2026+ models are the ones to watch.

### Cited Findings
- **Mode 01 PIDs:**
  - `0x5B` hybrid battery pack remaining life, 1 byte, 100/255·A %.
  - `0x9A` Hybrid/EV system data, battery, voltage, 6 bytes.
  - `0xA6` odometer.
  - — [Wikipedia OBD-II PIDs](https://en.wikipedia.org/wiki/OBD-II_PIDs)
- **Mode 01 support in Ultium captures:**
  - 2024 Equinox EV (DB33): 01, 0D, 1C, 1F, 21, 30, 31, 41, 42, A6. No 5B or 9A. — [OBDb 2024 command_support](https://github.com/OBDb/Chevrolet-Equinox-EV/blob/main/tests/test_cases/2024/command_support.yaml)
  - 2024 Hummer module 17 bitmap: `01 0D 1C 1F 20 21 30 31 40 42 60 80 A0 A6`. Other modules: `01 20 40 42`. — [CAN_PRIORITY.md](https://github.com/JeremyWhittaker/hummer_obdII/blob/main/docs/CAN_PRIORITY.md)
- ZEVonUDS (J1979-3) is a subset of OBDonUDS (J1979-2). It drops exhaust monitoring and runs on CAN (ISO 14229-2) or DoIP. Phase-in: 40 % of ZEVs and PHEVs in MY2026, 100 % in 2027, with CARB's alternative schedule allowing full compliance by MY2028. — [Vector ZEVonUDS](https://www.vector.com/en/business-unit/testing-validation-diagnostics/diagnostics/standards-knowhow/zevonuds/); [Kvaser](https://kvaser.com/the-future-of-on-board-diagnostics-obd-on-uds-and-zev-on-uds/)
- DID `0xF4B2` = SOH of the ZEV propulsion battery (per search-result summary of Vector/Kvaser material; not verified on the page I fetched). — [Vector press PDF](https://cdn.vector.com/cms/content/know-how/_press-releases/ZEVonUDS_PressRelease_202304_EN.pdf)
- CARB 13 CCR 1962.5 sets data standardization for MY2026+ ZEVs and PHEVs. 1962.8 warrants SOH (as defined in 1962.5(c)(4)(A)4.c/d) against falling below 70 % for 8 years/100k miles for MY2026–2030. — [LII 1962.5](https://www.law.cornell.edu/regulations/california/13-CCR-1962.5), [LII 1962.8](https://www.law.cornell.edu/regulations/california/13-CCR-1962.8)
- An InsideEVs feature headlined "Vetting A Used EV Battery Was About To Get Easier. Then Trump Happened" points to the ACC II federal waiver problem. The article was paywalled (402), so I could not verify its details. — [InsideEVs](https://insideevs.com/features/789263/battery-used-ev-trials-hardship/)

### Inferences
- For a 2024 Equinox, the standard PIDs will not give pack current or SOH. On MY2026+ Ultium vehicles, probing ZEVonUDS DIDs (the F4xx range, e.g. `22 F4B2` functional) is a cheap, standards-based read-only check worth adding. Its legal force outside California and Section 177 states may be weakened by the waiver situation.

### Gaps
- The full J1979-3 DID table (pack voltage, current, energy DIDs beyond F4B2) is paywalled SAE material. I did not verify exact DID numbers other than F4B2.
- I found no report of any Ultium vehicle answering F4xx DIDs.
