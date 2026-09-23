# /// script
# requires-python = ">=3.11"
# dependencies = ["bleak>=0.22"]
# ///
"""Prompted launcher for spike.py: asks for the car state, finds the dongle, picks a new file name.

Saves typing at the car. Extra arguments (for example --timeout 8) are passed through to spike.py.
"""

import asyncio
import datetime
import os
import subprocess
import sys

from spike import CARS, SERVICE

# spec T0.2 Decisions 4: ICE ignition on / engine off; EV powered on / ready
STATES = {CARS[0]: "ignition on, engine off", CARS[1]: "ignition on, engine off", CARS[2]: "ready, park"}
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))


def next_out_path(car: str, day: str, slug: str = "spike") -> str:
    """First free <day>-<slug>.jsonl, then -<slug>-2, -<slug>-3...: an existing recording is never reused."""
    base = os.path.join(REPO, "fixtures", "recordings", car, f"{day}-{slug}")
    path, n = base + ".jsonl", 2
    while os.path.exists(path):
        path, n = f"{base}-{n}.jsonl", n + 1
    return path


def ask(prompt: str, default: str = "") -> str:
    answer = input(f"{prompt}{f' [{default}]' if default else ''}: ").strip()
    return answer or default


async def find_dongle() -> str:
    from bleak import BleakScanner

    print("Scanning for 10 s...")
    found = list((await BleakScanner.discover(timeout=10, return_adv=True)).values())
    matches = [dev for dev, adv in found if SERVICE in adv.service_uuids]
    if len(matches) == 1:
        print(f"Found the dongle: {matches[0].address} {matches[0].name}")
        return matches[0].address
    # Some dongles do not advertise FFF0; fall back to letting the user pick.
    candidates = matches or [dev for dev, _ in found]
    if not candidates:
        sys.exit("No Bluetooth devices found. Check the dongle's light, move closer, and try again.")
    for i, dev in enumerate(candidates, 1):
        print(f"{i}. {dev.address} {dev.name}")
    return candidates[int(ask("Which number is the dongle", "1")) - 1].address


def main() -> None:
    for i, car in enumerate(CARS, 1):
        print(f"{i}. {car}")
    car = CARS[int(ask("Which car", "3")) - 1]
    note = STATES[car]
    if car == CARS[2]:
        note += f", dash SOC {ask('Battery % on the dash')}%"
    note += f", ambient {ask('Outside temperature in C')} C"
    address = asyncio.run(find_dongle())
    out = next_out_path(car, datetime.datetime.now(datetime.UTC).astimezone().date().isoformat())  # local date
    print(f"Recording to {out}\n")
    spike = os.path.join(HERE, "spike.py")
    args = ["--car", car, "--address", address, "--out", out, "--note", note, *sys.argv[1:]]
    sys.exit(subprocess.call([sys.executable, spike, *args]))


if __name__ == "__main__":
    main()
