---
paths:
  - "packages/obd-core/**"
  - "apps/mobile/src/**"
  - "tools/relay/**"
  - "tools/spike/**"
  - "tools/hil-bridge/**"
  - "docs/ELM327.md"
---
# Protocol work

- Before writing any OBD constant (PID, AT command, CAN header, scaling, DTC decode), open `docs/ELM327.md` and cite the section (AGENTS.md hard rule 1). No section, no constant: the spec names a hardware capture as a prerequisite.
- Questions about what a recording contains go to the `recording-analyst` subagent; never read a `fixtures/recordings/` file in the main conversation.
- Hardware goes through the phone relay (ADR-013) or the laptop bridge; neither is in this WSL2 shell by default. If `pnpm hil:smoke` cannot reach the car, report NOT RUN; do not simulate.
- Any new request the write guard admits (`packages/obd-core/src/elm/guard.ts`) is read-only per hard rule 5 and gets the isolated failure list in its spec.
