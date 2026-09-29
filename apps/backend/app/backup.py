"""SQLite snapshots and explicit offline restoration for operators."""

from __future__ import annotations

import argparse
import fcntl
import os
import shutil
import sqlite3
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from sqlalchemy.engine import make_url

from app.core.config import get_settings


def database_path(database_url: str) -> Path:
    url = make_url(database_url)
    if not url.drivername.startswith("sqlite") or not url.database or url.database == ":memory:":
        raise ValueError("Backups require a file-backed SQLite database.")
    return Path(url.database).resolve()


def _readonly(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=10)


def verify_database(path: Path) -> None:
    connection = _readonly(path)
    try:
        if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("SQLite integrity check failed.")
    finally:
        connection.close()


def backup_database(source: Path, destination: Path) -> None:
    """Export a consistent snapshot, including committed WAL transactions."""
    source_connection = _readonly(source)
    try:
        # Exclusive creation also rejects an existing file or symlink.
        with destination.open("xb"):
            destination.chmod(0o600)
        destination_connection = sqlite3.connect(destination)
        try:
            source_connection.backup(destination_connection, pages=128, sleep=0.1)
        finally:
            destination_connection.close()
        verify_database(destination)
    finally:
        source_connection.close()


def restore_database(source: Path, destination: Path, *, confirm_replace: bool = False) -> None:
    if not confirm_replace:
        raise ValueError("Restoration requires --confirm-replace and a stopped backend.")
    if source.resolve() == destination.resolve():
        raise ValueError("The backup and live database must be different files.")
    verify_database(source)
    owner = destination.stat() if destination.exists() else destination.parent.stat()
    lock_path = destination.with_name(destination.name + ".notification-monitor.lock")
    with lock_path.open("a+") as lock:
        if os.geteuid() == 0:
            os.chown(lock_path, owner.st_uid, owner.st_gid)
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ValueError("Stop the backend before restoring; its monitor still owns the database lock.") from exc
        source_connection = _readonly(source)
        try:
            destination_connection = sqlite3.connect(destination, timeout=10)
            try:
                # Replace transactionally instead of copying over WAL files.
                source_connection.backup(destination_connection, pages=128, sleep=0.1)
            finally:
                destination_connection.close()
        finally:
            source_connection.close()
        destination.chmod(0o600)
        if os.geteuid() == 0:
            os.chown(destination, owner.st_uid, owner.st_gid)
        verify_database(destination)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export", help="Create and verify a consistent SQLite snapshot")
    output = export.add_mutually_exclusive_group(required=True)
    output.add_argument("--output", type=Path)
    output.add_argument("--stdout", action="store_true", help="Write only snapshot bytes to stdout")
    verify = commands.add_parser("verify", help="Check an existing SQLite snapshot")
    verify.add_argument("snapshot", type=Path)
    restore = commands.add_parser("restore", help="Replace the database while the backend is stopped")
    restore.add_argument("snapshot", type=Path)
    restore.add_argument("--confirm-replace", action="store_true")
    arguments = parser.parse_args(argv)
    try:
        if arguments.command == "verify":
            verify_database(arguments.snapshot)
        elif arguments.command == "restore":
            restore_database(arguments.snapshot, database_path(get_settings().database_url),
                             confirm_replace=arguments.confirm_replace)
        elif arguments.stdout:
            with TemporaryDirectory(prefix="pihomehub-backup-") as temporary:
                snapshot = Path(temporary) / "pihomehub.db"
                backup_database(database_path(get_settings().database_url), snapshot)
                with snapshot.open("rb") as handle:
                    shutil.copyfileobj(handle, sys.stdout.buffer)
        else:
            backup_database(database_path(get_settings().database_url), arguments.output)
    except (OSError, ValueError, sqlite3.Error) as exc:
        reason = str(exc) if isinstance(exc, ValueError) else "Check the database path, storage and permissions."
        print(f"SQLite {arguments.command} failed. {reason}", file=sys.stderr)
        return 1
    print(f"SQLite {arguments.command} completed and integrity verified.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
