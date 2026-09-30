import os
import sqlite3
import subprocess
import sys
from pathlib import Path


def test_security_migration_hashes_legacy_session_and_preserves_user(tmp_path):
    root = Path(__file__).parents[4]
    backend = root / "apps" / "backend"
    database = tmp_path / "migration.db"
    env = os.environ.copy()
    env.update(
        {
            "PYTHONPATH": str(backend),
            "PIHOMEHUB_ENV": "testing",
            "PIHOMEHUB_DATABASE_URL": f"sqlite:///{database}",
            "PIHOMEHUB_ADMIN_USERNAME": "",
            "PIHOMEHUB_ADMIN_PASSWORD": "",
        }
    )
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "0001_initial"],
        cwd=backend,
        env=env,
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    connection = sqlite3.connect(database)
    connection.execute(
        "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)",
        ("legacy", "legacy-hash", 1),
    )
    connection.execute(
        "INSERT INTO sessions (user_id, token, created_at) VALUES (?, ?, ?)",
        (1, "legacy-raw-token", "2026-01-01 00:00:00"),
    )
    connection.commit()
    connection.close()

    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=backend,
        env=env,
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    connection = sqlite3.connect(database)
    columns = {row[1] for row in connection.execute("PRAGMA table_info(sessions)")}
    token_hash = connection.execute("SELECT token_hash FROM sessions").fetchone()[0]
    user = connection.execute("SELECT username, is_active FROM users").fetchone()
    connection.close()
    assert "token" not in columns
    assert "token_hash" in columns
    assert token_hash != "legacy-raw-token"
    assert len(token_hash) == 64
    assert user == ("legacy", 1)


def test_production_database_without_admin_fails_closed(tmp_path):
    root = Path(__file__).parents[4]
    database = tmp_path / "locked.db"
    env = os.environ.copy()
    env.update(
        {
            "PYTHONPATH": str(root / "apps" / "backend"),
            "PIHOMEHUB_ENV": "production",
            "PIHOMEHUB_DATABASE_URL": f"sqlite:///{database}",
            "PIHOMEHUB_SECRET_KEY": "s" * 40,
            "PIHOMEHUB_CONTROL_AGENT_SECRET": "c" * 40,
            "PIHOMEHUB_PUBLIC_BASE_URL": "https://pi.example",
            "PIHOMEHUB_ALLOWED_ORIGINS": "https://pi.example",
            "PIHOMEHUB_ADMIN_PASSWORD": "",
            "PIHOMEHUB_PORT_CONFIGURATION_MODE": "operator",
        }
    )
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from app.database.bootstrap import bootstrap_database; bootstrap_database()",
        ],
        cwd=root,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode != 0
    assert "No active administrator exists" in result.stderr
