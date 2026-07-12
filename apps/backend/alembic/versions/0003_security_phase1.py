"""add secure sessions, account state, and audit events

Revision ID: 0003_security_phase1
Revises: 0002_tailscale_devices
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

from alembic import op
import sqlalchemy as sa

revision = "0003_security_phase1"
down_revision = "0002_tailscale_devices"
branch_labels = None
depends_on = None


def _parse_created_at(value: object) -> datetime:
    if isinstance(value, datetime):
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
    return datetime.now(UTC)


def upgrade() -> None:
    now = datetime.now(UTC)
    op.add_column("users", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("users", sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(sa.text("UPDATE users SET password_changed_at = :now").bindparams(now=now))

    op.add_column("sessions", sa.Column("token_hash", sa.String(length=64), nullable=True))
    op.add_column("sessions", sa.Column("csrf_token_hash", sa.String(length=64), nullable=True))
    op.add_column("sessions", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sessions", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sessions", sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sessions", sa.Column("authentication_time", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sessions", sa.Column("user_agent", sa.String(length=255), nullable=True))
    op.add_column("sessions", sa.Column("source_ip", sa.String(length=64), nullable=True))

    connection = op.get_bind()
    rows = connection.execute(sa.text("SELECT id, token, created_at FROM sessions")).mappings().all()
    for row in rows:
        created_at = _parse_created_at(row["created_at"])
        connection.execute(
            sa.text(
                "UPDATE sessions SET token_hash=:token_hash, csrf_token_hash=:csrf_token_hash, "
                "last_seen_at=:last_seen_at, expires_at=:expires_at, authentication_time=:authentication_time "
                "WHERE id=:id"
            ),
            {
                "id": row["id"],
                "token_hash": hashlib.sha256(str(row["token"]).encode()).hexdigest(),
                "csrf_token_hash": hashlib.sha256(b"migration-invalidates-csrf").hexdigest(),
                "last_seen_at": created_at,
                "expires_at": created_at + timedelta(days=7),
                "authentication_time": created_at,
            },
        )

    with op.batch_alter_table("users") as batch:
        batch.alter_column("password_changed_at", nullable=False)
    with op.batch_alter_table("sessions") as batch:
        batch.drop_index("ix_sessions_token")
        batch.drop_column("token")
        batch.alter_column("token_hash", nullable=False)
        batch.alter_column("csrf_token_hash", nullable=False)
        batch.alter_column("last_seen_at", nullable=False)
        batch.alter_column("expires_at", nullable=False)
        batch.alter_column("authentication_time", nullable=False)
        batch.create_index("ix_sessions_token_hash", ["token_hash"], unique=True)
        batch.create_index("ix_sessions_expires_at", ["expires_at"], unique=False)
        batch.create_index("ix_sessions_revoked_at", ["revoked_at"], unique=False)

    op.create_table(
        "audit_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("event", sa.String(length=96), nullable=False),
        sa.Column("target_type", sa.String(length=64), nullable=True),
        sa.Column("target_identifier", sa.String(length=128), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("source_ip", sa.String(length=64), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_events_id", "audit_events", ["id"])
    op.create_index("ix_audit_events_created_at", "audit_events", ["created_at"])
    op.create_index("ix_audit_events_actor_user_id", "audit_events", ["actor_user_id"])
    op.create_index("ix_audit_events_event", "audit_events", ["event"])


def downgrade() -> None:
    op.drop_table("audit_events")
    op.add_column("sessions", sa.Column("token", sa.String(length=255), nullable=True))
    connection = op.get_bind()
    rows = connection.execute(sa.text("SELECT id, token_hash FROM sessions")).mappings().all()
    for row in rows:
        connection.execute(
            sa.text("UPDATE sessions SET token=:token WHERE id=:id"),
            {"id": row["id"], "token": f"revoked-{row['token_hash']}"},
        )
    with op.batch_alter_table("sessions") as batch:
        batch.drop_index("ix_sessions_revoked_at")
        batch.drop_index("ix_sessions_expires_at")
        batch.drop_index("ix_sessions_token_hash")
        batch.drop_column("source_ip")
        batch.drop_column("user_agent")
        batch.drop_column("authentication_time")
        batch.drop_column("revoked_at")
        batch.drop_column("expires_at")
        batch.drop_column("last_seen_at")
        batch.drop_column("csrf_token_hash")
        batch.drop_column("token_hash")
        batch.alter_column("token", nullable=False)
        batch.create_index("ix_sessions_token", ["token"], unique=True)
    with op.batch_alter_table("users") as batch:
        batch.drop_column("password_changed_at")
        batch.drop_column("is_active")
