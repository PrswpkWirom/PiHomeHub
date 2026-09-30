from __future__ import annotations

import os
import shutil
import sqlite3
import sys
import tempfile

from app.main import settings


def main() -> None:
    source = sqlite3.connect(f"file:{settings.operations_db}?mode=ro", uri=True)
    fd, path = tempfile.mkstemp(prefix="pihomehub-operations-")
    os.close(fd)
    try:
        destination = sqlite3.connect(path)
        source.backup(destination)
        destination.close()
        with open(path, "rb") as backup:
            shutil.copyfileobj(backup, sys.stdout.buffer)
    finally:
        source.close()
        os.unlink(path)


if __name__ == "__main__":
    main()
