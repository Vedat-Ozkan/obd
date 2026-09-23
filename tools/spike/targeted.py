# /// script
# requires-python = ">=3.11"
# dependencies = ["bleak>=0.22"]
# ///
"""T2.3b Equinox EV targeted watch: phase A sweep, then a cited watch list polled through five marked states.

Sources: docs/specs/T2.3b-targeted-watch.md (Sources table). Every polled DID cites a phase-B positive of the
2026-09-23 discovery recording in targeted_watch.json. Every byte goes through discover.check_allowed.
"""

import argparse
import asyncio
import datetime
import hashlib
import importlib.metadata
import json
import math
import os
import platform
import sys
import time

from discover import CAR, STATES, Elm, check_allowed, select, sweep
from go import ask, find_dongle, next_out_path
from spike import SERVICE, Recorder

WATCH_LIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "targeted_watch.json")
ROTATE_S = 6  # rotating-slice time per cycle (spec Time budget)
CHARGE_STATE = STATES[3]  # "plugged in and charging"
CHARGE_MIN_S = 5 * 60  # task text: charging state >= 5 min
_INSTRUCTIONS = (
    ("HVAC off, car in Ready, Park. Wait for 'full rotation done', then set the heater to max (hot, fan high) "
     "and press Enter once hot air flows."),
    "After 'full rotation done', turn the heater off and press Enter.",
    ("After 'full rotation done', plug in the home charger. Press Enter once the car/charger shows it is charging. "
     "If it does not start within about 1 minute in Ready, switch the car off, wait for charging, then press "
     "Enter. Leave the laptop in the car."),
    "Keep charging until the console says 5:00 reached and 'full rotation done', then unplug and press Enter.",
    "After 'full rotation done', press Enter to finish.",
)


def load_watch_list(path: str = WATCH_LIST) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    core, rotate = ([(m, did) for m, did, _ in data[k]] for k in ("core", "rotate"))
    seen: set[tuple[str, str]] = set()
    for m, did in core + rotate:
        if m not in ("CB", "17") or (m, did) in seen:
            raise ValueError(f"bad watch-list entry: {m} {did}")
        check_allowed(f"22 {did}")
        seen.add((m, did))
    return core, rotate


def _sha256(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _mmss(s: float) -> str:
    return f"{int(s) // 60}:{int(s) % 60:02d}"


async def _poll(elm: Elm, entry: tuple[str, str], selected: str | None) -> str:
    if entry[0] != selected:
        await select(elm, entry[0])
    await elm.send(f"22 {entry[1]}")
    return entry[0]


async def watch_targeted(elm: Elm, rec: Recorder, core: list[tuple[str, str]],
                         rotate: list[tuple[str, str]], marks: "asyncio.Queue[str]") -> None:
    rec.meta(phase="C", watch_list="tools/spike/targeted_watch.json", watch_list_sha256=_sha256(WATCH_LIST),
             core=len(core), rotate=len(rotate), rotate_s=ROTATE_S, charge_min_s=CHARGE_MIN_S)
    ptr = 0  # persists across cycles and states
    for state, text in zip(STATES, _INSTRUCTIONS, strict=True):
        rec.meta(phase="C", state=state)
        print(f"\nC state: {state}\n  {text}")
        entered, cycles, rotated = time.monotonic(), 0, 0
        while True:
            await elm.send("ATRV")
            selected = None  # forgotten each cycle: every cycle re-selects its first module
            for entry in core:
                selected = await _poll(elm, entry, selected)
            started = time.monotonic()
            while True:  # at least one rotating DID per cycle
                selected = await _poll(elm, rotate[ptr], selected)
                ptr, rotated = (ptr + 1) % len(rotate), rotated + 1
                if time.monotonic() - started >= ROTATE_S:
                    break
            cycles += 1
            elapsed = time.monotonic() - entered
            missing = [] if rotated >= len(rotate) else [f"{len(rotate) - rotated} rotating DIDs"]
            done = "full rotation done" if not missing else f"rotation {rotated}/{len(rotate)}"
            line = f"  {state}: {_mmss(elapsed)}, {cycles} cycles, {done}"
            if state == CHARGE_STATE:
                if elapsed < CHARGE_MIN_S:
                    missing.append(f"{_mmss(CHARGE_MIN_S - elapsed)} of charging")
                    line += f", charging {_mmss(elapsed)} of {_mmss(CHARGE_MIN_S)}, do not unplug yet"
                else:
                    line += f", {_mmss(CHARGE_MIN_S)} reached"
            print(line)
            if marks.empty():  # marks are taken between cycles only
                continue
            marks.get_nowait()
            if not missing:
                break
            rec.meta(phase="C", note="early mark ignored", state=state, elapsed_s=int(elapsed))
            print(f"  Too early, still missing: {', '.join(missing)}. Press Enter again when done.")
    rec.meta(phase="end")


def main() -> None:
    argparse.ArgumentParser(description=__doc__.splitlines()[0]).parse_args()
    from bleak import BleakClient

    core, rotate = load_watch_list()
    note = f"ready, park, dash SOC {ask('Battery % on the dash')}%, ambient {ask('Outside temperature in C')} C"
    # spec Time budget: 77.2 s of phase-B time for the 839 rotating DIDs; ~1.8 s of each cycle is not rotation.
    rotation_s = math.ceil(len(rotate) * 77.2 / 839 / ROTATE_S) * (ROTATE_S + 1.8)
    print(f"Plan: A standard sweep (~20 s); C watch: {len(core)} core DIDs every cycle, {len(rotate)} rotating "
          f"(one full rotation ~{rotation_s:.0f} s). Each state needs one full rotation; charging also needs "
          f"{_mmss(CHARGE_MIN_S)}. Early Enter presses are ignored. Do not press Enter until asked.")

    async def session() -> None:
        address = await find_dongle()
        day = datetime.datetime.now(datetime.UTC).astimezone().date().isoformat()  # local date
        out = next_out_path(CAR, day, "discovery-targeted")
        print(f"Recording to {out}\n")
        rec = Recorder(out)
        async with BleakClient(address) as client:
            svc = client.services.get_service(SERVICE)
            chars = list(svc.characteristics) if svc else []
            write_char = next((c for c in chars if "write-without-response" in c.properties), None)
            write_char = write_char or next((c for c in chars if "write" in c.properties), None)
            notify_char = next((c for c in chars if "notify" in c.properties), None)
            if write_char is None or notify_char is None:
                dump = [f"{s.uuid}: {[(c.uuid, c.properties) for c in s.characteristics]}"
                        for s in client.services]
                print(*dump, sep="\n")
                rec.meta(note="service FFF0 or its write/notify characteristic not found", gatt=dump)
                sys.exit(1)
            rec.meta(car=CAR, dongle="veepeak-obdcheck-ble", note=note,
                     script="tools/spike/targeted.py", bleak=importlib.metadata.version("bleak"),
                     platform=platform.platform(), write_char=write_char.uuid,
                     notify_char=notify_char.uuid, mtu=client.mtu_size)
            elm = Elm(client, write_char, notify_char, "write-without-response" in write_char.properties, rec)
            await elm.start()
            await sweep(elm, rec)
            marks: asyncio.Queue[str] = asyncio.Queue()

            async def feed() -> None:  # until EOF: ignored early marks mean more than len(STATES) lines
                while line := await asyncio.to_thread(sys.stdin.readline):
                    await marks.put(line)

            reader = asyncio.create_task(feed())
            try:
                await watch_targeted(elm, rec, core, rotate, marks)
            finally:
                if not reader.done():
                    print("Press Enter to exit.")
            await client.stop_notify(notify_char)
        print(f"Done. Unplug the dongle. Recording: {out}")

    asyncio.run(session())


if __name__ == "__main__":
    main()
