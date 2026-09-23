# /// script
# requires-python = ">=3.11"
# dependencies = ["bleak>=0.22"]
# ///
"""T0.2 hardware spike: send the fixed ELM327 command list over BLE, record raw bytes.

Throwaway; nothing imports this. Sources for every command: docs/specs/T0.2-hardware-spike.md
(Sources table) pointing at docs/ELM327.md and docs/PLAN.md T0.2. No decoding happens here.
"""

import argparse
import asyncio
import importlib.metadata
import json
import os
import platform
import sys
import time

CARS = ("chrysler-200-2013", "hyundai-elantra-2019", "chevrolet-equinox-ev-2024")
SERVICE = "0000fff0-0000-1000-8000-00805f9b34fb"  # docs/ELM327.md §BLE specifics
CODEC = "iso-8859-1"  # every byte 0-255 round-trips (spec: Recording format contract)
CHUNK = 20  # docs/ELM327.md §BLE specifics: default MTU 23 -> 20 data bytes

# docs/PLAN.md T0.2 list, in order. ATI: PLAN only (spec Decisions 1). The rest:
# docs/ELM327.md §Init sequence, §Standard modes used (Mode 01/09/03/07/0A), §Mode 01 PIDs (01).
COMMANDS = [
    "ATZ", "ATI", "ATE0", "ATL0", "ATS0", "ATH1", "ATSP0", "ATDPN", "ATRV",
    "0100", "0120", "0140", "0101", "0902", "090A", "03", "07", "0A",
]

# docs/ELM327.md §Per-car notes, Equinox EV, verbatim spacing (spec Decisions 3). The DACB
# headers follow the notation rule in that section with module 1D replaced by CB (spec Sources).
EV_COMMANDS = [
    "ATSP7", "ATCP 18", "ATSH DA1DF1", "ATCRA 18DAF11D", "ATFCSH 18DA1DF1",
    "ATFCSD 300000", "ATFCSM 1", "22 33E5",
    "ATSH DACBF1", "ATCRA 18DAF1CB", "ATFCSH 18DACBF1", "22 27C6", "22 2AF5", "22 2B43",
]


class Recorder:
    """Appends one JSON object per line; flushes after each line."""

    def __init__(self, path: str) -> None:
        # A fresh clone has no fixtures/recordings/<car>/ dirs; laptop OS unknown, so no shell mkdir.
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        # "x": never overwrite (hard rule 2). Held open for the run; flushed per line so a crash keeps data.
        self._f = open(path, "x", encoding="utf-8", newline="\n")  # noqa: SIM115
        self.t0 = time.monotonic()
        self.lines = 0

    def _write(self, fields: dict[str, object]) -> None:
        self._f.write(json.dumps({"t": round(time.monotonic() - self.t0, 3), **fields}) + "\n")
        self._f.flush()
        self.lines += 1

    def event(self, dir: str, data: str) -> None:
        self._write({"dir": dir, "data": data})

    def meta(self, **fields: object) -> None:
        self._write({"dir": "meta", **fields})


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--scan", action="store_true", help="list advertising BLE devices and exit")
    p.add_argument("--car", choices=CARS)
    p.add_argument("--address", help="BLE address from --scan")
    p.add_argument("--out", help="recording path; must not exist")
    p.add_argument("--note", help="vehicle state etc.; stored verbatim in the meta line")
    p.add_argument("--timeout", type=float, default=20, help="seconds to wait for '>' per command")
    p.add_argument("--interactive", action="store_true", help="read extra commands from stdin")
    args = p.parse_args()
    if not args.scan and None in (args.car, args.address, args.out, args.note):
        p.error("--car, --address, --out and --note are required unless --scan")
    return args


async def main() -> None:
    args = parse_args()
    from bleak import BleakClient, BleakScanner

    if args.scan:
        for dev, adv in (await BleakScanner.discover(return_adv=True)).values():
            print(dev.address, dev.name, adv.service_uuids)
        return

    rec = Recorder(args.out)
    async with BleakClient(args.address) as client:
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
        rec.meta(car=args.car, dongle="veepeak-obdcheck-ble", note=args.note,
                 script="tools/spike/spike.py", bleak=importlib.metadata.version("bleak"),
                 platform=platform.platform(), write_char=write_char.uuid,
                 notify_char=notify_char.uuid, mtu=client.mtu_size)
        without_response = "write-without-response" in write_char.properties
        buf: list[str] = []
        prompt = asyncio.Event()

        def on_rx(_: object, data: bytearray) -> None:
            text = bytes(data).decode(CODEC)
            rec.event("rx", text)
            buf.append(text)
            if ">" in text:
                prompt.set()

        async def send(cmd: str) -> None:
            buf.clear()
            prompt.clear()
            payload = (cmd + "\r").encode(CODEC)
            rec.event("tx", cmd + "\r")  # first: a reply can arrive while write_gatt_char awaits (T2.3b)
            line, sent = rec.lines, time.monotonic()
            try:
                for i in range(0, len(payload), CHUNK):
                    await client.write_gatt_char(write_char, payload[i:i + CHUNK],
                                                 response=not without_response)
                await asyncio.wait_for(prompt.wait(), args.timeout)
                ms: object = round((time.monotonic() - sent) * 1000)
            except TimeoutError:
                rec.meta(note=f"timeout waiting for '>' after {cmd}")
                ms = "timeout"
            except BaseException as e:
                rec.meta(note=f"timeout waiting for '>' after {cmd} (interrupted: {type(e).__name__})")
                raise
            print(f"| {line} | {cmd} | {ms} | {''.join(buf)!r} |")

        await client.start_notify(notify_char, on_rx)
        print("| line | command | ms | raw (repr) |")
        for cmd in COMMANDS + (EV_COMMANDS if args.car == CARS[2] else []):
            await send(cmd)
        if args.interactive:
            print("interactive: one command per line; empty line or EOF ends", file=sys.stderr)
            while cmd := (await asyncio.to_thread(sys.stdin.readline)).strip():
                await send(cmd)
        await client.stop_notify(notify_char)


if __name__ == "__main__":
    asyncio.run(main())
