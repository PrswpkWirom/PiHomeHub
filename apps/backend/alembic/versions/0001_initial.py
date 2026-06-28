"""initial schema"""

from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("is_admin", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_id"), "users", ["id"], unique=False)
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    op.create_table(
        "sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_sessions_id"), "sessions", ["id"], unique=False)
    op.create_index(op.f("ix_sessions_token"), "sessions", ["token"], unique=True)
    op.create_index(op.f("ix_sessions_user_id"), "sessions", ["user_id"], unique=False)

    op.create_table(
        "devices",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("device_type", sa.String(length=32), nullable=False),
        sa.Column("ip_address", sa.String(length=128), nullable=True),
        sa.Column("tailscale_name", sa.String(length=128), nullable=True),
        sa.Column("mac_address", sa.String(length=32), nullable=True),
        sa.Column("supports_wol", sa.Boolean(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index(op.f("ix_devices_id"), "devices", ["id"], unique=False)

    op.create_table(
        "tasks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("due_label", sa.String(length=64), nullable=True),
        sa.Column("is_complete", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_tasks_id"), "tasks", ["id"], unique=False)

    op.create_table(
        "service_links",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("slug", sa.String(length=128), nullable=False),
        sa.Column("url", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_service_links_id"), "service_links", ["id"], unique=False)
    op.create_index(op.f("ix_service_links_slug"), "service_links", ["slug"], unique=True)

    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_app_settings_id"), "app_settings", ["id"], unique=False)
    op.create_index("ix_app_settings_key", "app_settings", ["key"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_app_settings_key", table_name="app_settings")
    op.drop_index(op.f("ix_app_settings_id"), table_name="app_settings")
    op.drop_table("app_settings")
    op.drop_index(op.f("ix_service_links_slug"), table_name="service_links")
    op.drop_index(op.f("ix_service_links_id"), table_name="service_links")
    op.drop_table("service_links")
    op.drop_index(op.f("ix_tasks_id"), table_name="tasks")
    op.drop_table("tasks")
    op.drop_index(op.f("ix_devices_id"), table_name="devices")
    op.drop_table("devices")
    op.drop_index(op.f("ix_sessions_user_id"), table_name="sessions")
    op.drop_index(op.f("ix_sessions_token"), table_name="sessions")
    op.drop_index(op.f("ix_sessions_id"), table_name="sessions")
    op.drop_table("sessions")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_index(op.f("ix_users_id"), table_name="users")
    op.drop_table("users")
