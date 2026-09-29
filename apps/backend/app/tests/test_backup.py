import fcntl
import sqlite3
from pathlib import Path

import pytest

from app.backup import backup_database, database_path, restore_database, verify_database


def _database(path: Path, value: str) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("CREATE TABLE records (value TEXT NOT NULL)")
    connection.execute("INSERT INTO records VALUES (?)", (value,))
    connection.commit()
    return connection


def test_online_backup_includes_committed_wal_and_excludes_pending_writes(tmp_path):
    source, snapshot = tmp_path / "live.db", tmp_path / "snapshot.db"
    writer = _database(source, "committed")
    try:
        writer.execute("INSERT INTO records VALUES ('not committed')")
        backup_database(source, snapshot)
        verify_database(snapshot)
        with sqlite3.connect(snapshot) as reader:
            assert reader.execute("SELECT value FROM records").fetchall() == [("committed",)]
        assert snapshot.stat().st_mode & 0o777 == 0o600
        with pytest.raises(FileExistsError):
            backup_database(source, snapshot)
    finally:
        writer.rollback()
        writer.close()


def test_restore_requires_confirmation_and_refuses_running_monitor(tmp_path):
    live, snapshot = tmp_path / "live.db", tmp_path / "snapshot.db"
    _database(live, "current").close()
    _database(snapshot, "restored").close()
    with pytest.raises(ValueError, match="confirm-replace"):
        restore_database(snapshot, live)
    with live.with_name(live.name + ".notification-monitor.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(ValueError, match="Stop the backend"):
            restore_database(snapshot, live, confirm_replace=True)
    restore_database(snapshot, live, confirm_replace=True)
    with sqlite3.connect(live) as reader:
        assert reader.execute("SELECT value FROM records").fetchall() == [("restored",)]
    assert live.stat().st_mode & 0o777 == 0o600


def test_invalid_snapshot_does_not_replace_live_data(tmp_path):
    live, snapshot = tmp_path / "live.db", tmp_path / "invalid.db"
    _database(live, "safe").close()
    snapshot.write_bytes(b"not a SQLite database")
    with pytest.raises(sqlite3.DatabaseError):
        restore_database(snapshot, live, confirm_replace=True)
    with sqlite3.connect(live) as reader:
        assert reader.execute("SELECT value FROM records").fetchone() == ("safe",)


def test_database_path_rejects_nonpersistent_or_remote_databases(tmp_path):
    assert database_path(f"sqlite:///{tmp_path / 'hub.db'}") == tmp_path / "hub.db"
    for url in ("sqlite:///:memory:", "postgresql://user:password@localhost/hub"):
        with pytest.raises(ValueError, match="file-backed SQLite"):
            database_path(url)
