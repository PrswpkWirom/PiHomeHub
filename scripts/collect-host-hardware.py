#!/usr/bin/env python3
"""Export only RAM's configured transfer rate for the unprivileged backend."""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path


def configured_memory_speed(output: str) -> int | None:
    speeds: set[int] = set()
    for device in re.split(r"(?m)^Memory Device\s*$", output)[1:]:
        size = re.search(r"(?m)^\s*Size:\s*(.+)$", device)
        if size and size.group(1).strip() == "No Module Installed":
            continue
        # Use configured speed, never the DIMM's advertised maximum. Older
        # dmidecode versions label the same SMBIOS field in MHz rather than MT/s.
        speed = re.search(r"(?m)^\s*Configured (?:Memory|Clock) Speed:\s*(\d+)\s*(?:MT/s|MHz)\s*$", device)
        if not speed or int(speed.group(1)) <= 0:
            return None
        speeds.add(int(speed.group(1)))
    return speeds.pop() if len(speeds) == 1 else None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "infra/generated/hardware.json")
    args = parser.parse_args()
    speed = None
    try:
        result = subprocess.run(["dmidecode", "--type", "17"], check=True, capture_output=True,
                                text=True, timeout=10, env={**os.environ, "LC_ALL": "C"})
        speed = configured_memory_speed(result.stdout)
    except (OSError, subprocess.SubprocessError):
        pass
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".hardware-", dir=args.output.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump({"memory_speed_mts": speed}, stream)
            stream.write("\n")
        os.chmod(temporary, 0o644)
        os.replace(temporary, args.output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(f"RAM configured speed: {str(speed) + ' MT/s' if speed else 'unavailable'}. Snapshot: {args.output}")


if __name__ == "__main__":
    main()
