# Battery diagnosis

Garage vehicle: 1
Vehicle: chevrolet-equinox-ev-2024
Scan timestamp (caller replay label; not verified car-session time): 2026-09-22T00:00:00.000Z
Recording: fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl
Scan status: complete

## Battery observations

- SoC (high res): 69.6147 percent | verified | 22 27C6 | ECU CB | fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl
- Cell voltage (avg): 3.9297 volts | community | 22 2AF5 | ECU CB | fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl
- Cell voltage (min): 3.9287 volts | community | 22 2AF5 | ECU CB | fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl
- Cell voltage (max): 3.9317 volts | community | 22 2AF5 | ECU CB | fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl
- SoC: 69.8039 percent | verified | 22 2B43 | ECU CB | fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl
- Cell spread: 0.003 volts | community | min 22 2AF5 ECU CB fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl | max 22 2AF5 ECU CB fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl

## Capacity and health

capacity: NOT MEASURED
Reason: No completed charge log and reviewed capacity estimator are available.
battery health: not assessed
Reason: A single scan and community cell readings cannot establish battery health.

## 12 V observations

12 V voltage: 12.7 V | ELM adapter supply | ATRV | state ready | fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl
12 V battery health: not assessed
Reason: In-car adapter and control-module supply voltage are not rested battery-terminal measurements; a load test or service assessment is needed for battery health.
OCV advice: not assessed.

## Diagnostic codes

Observed data from 5 modules: 17, 28, 40, 45, CB. Each value is shown as the module reported it.

### Recently cleared: unknown

Unknown: no counter since codes cleared (PID 30, 31 or 4E) was read, so the data cannot show when codes were last cleared.

| Check | Result |
|---|---|
| No stored codes (Mode 03) | yes |
| A readiness monitor incomplete (PID 01) | no |
| A counter since codes cleared below policy (PIDs 30, 31, 4E) | unknown |
| Permanent codes present (Mode 0A) | no |

Policy thresholds, set by this project and not taken from a standard: warm-ups below 10, distance below 100 km, time below 600 min.

### Module 17

- Stored codes (Mode 03): none
- Pending codes (Mode 07): none
- Permanent codes (Mode 0A): not answered (negative response 11)
- MIL (PID 01): off; stored emission codes: 0
- Readiness monitors (PID 01): components complete
- Warm-ups since codes cleared (PID 30): not read
- Distance since codes cleared (PID 31): not read
- Time since codes cleared (PID 4E): not supported
- Distance with MIL on (PID 21): not read
- Time with MIL on (PID 4D): not supported
- Freeze frame (Mode 02): not read

### Module 28

- Stored codes (Mode 03): none
- Pending codes (Mode 07): none
- Permanent codes (Mode 0A): none
- MIL (PID 01): off; stored emission codes: 0
- Readiness monitors (PID 01): components complete
- Warm-ups since codes cleared (PID 30): not read
- Distance since codes cleared (PID 31): not read
- Time since codes cleared (PID 4E): not supported
- Distance with MIL on (PID 21): not read
- Time with MIL on (PID 4D): not supported
- Freeze frame (Mode 02): not read

### Module 40

- Stored codes (Mode 03): none
- Pending codes (Mode 07): none
- Permanent codes (Mode 0A): none
- MIL (PID 01): off; stored emission codes: 0
- Readiness monitors (PID 01): components complete
- Warm-ups since codes cleared (PID 30): not supported
- Distance since codes cleared (PID 31): not supported
- Time since codes cleared (PID 4E): not supported
- Distance with MIL on (PID 21): not supported
- Time with MIL on (PID 4D): not supported
- Freeze frame (Mode 02): not read

### Module 45

- Stored codes (Mode 03): none
- Pending codes (Mode 07): none
- Permanent codes (Mode 0A): none
- MIL (PID 01): off; stored emission codes: 0
- Readiness monitors (PID 01): components complete
- Warm-ups since codes cleared (PID 30): not supported
- Distance since codes cleared (PID 31): not supported
- Time since codes cleared (PID 4E): not supported
- Distance with MIL on (PID 21): not supported
- Time with MIL on (PID 4D): not supported
- Freeze frame (Mode 02): not read

### Module CB

- Stored codes (Mode 03): none
- Pending codes (Mode 07): none
- Permanent codes (Mode 0A): not answered (negative response 11)
- MIL (PID 01): off; stored emission codes: 0
- Readiness monitors (PID 01): components complete
- Warm-ups since codes cleared (PID 30): not supported
- Distance since codes cleared (PID 31): not supported
- Time since codes cleared (PID 4E): not supported
- Distance with MIL on (PID 21): not supported
- Time with MIL on (PID 4D): not supported
- Freeze frame (Mode 02): not read

