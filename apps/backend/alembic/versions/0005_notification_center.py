"""persistent notification center"""

from alembic import op
import sqlalchemy as sa

revision = "0005_notification_center"
down_revision = "0004_manual_device_broadcast"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_key", sa.String(255), nullable=False, unique=True),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("category", sa.String(32), nullable=False),
        sa.Column("severity", sa.String(16), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("message", sa.String(512), nullable=False),
        sa.Column("source_type", sa.String(32)),
        sa.Column("source_id", sa.String(128)),
        sa.Column("target_path", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("metadata_json", sa.Text(), nullable=False),
    )
    op.create_index("ix_notifications_created_at", "notifications", ["created_at", "id"])
    op.create_table(
        "notification_recipients",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("notification_id", sa.Integer(), sa.ForeignKey("notifications.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("notification_id", "user_id", name="uq_notification_recipient"),
    )
    op.create_index("ix_notification_recipients_user_read", "notification_recipients", ["user_id", "read_at", "notification_id"])
    op.create_table(
        "notification_preferences",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        *[sa.Column(key, sa.Boolean(), nullable=False, server_default=sa.true()) for key in (
            "device_offline", "device_recovered", "service_failure", "service_recovered", "temperature", "disk", "memory", "monitoring", "tailscale_sync"
        )],
    )
    op.create_table(
        "notification_monitor_state",
        sa.Column("key", sa.String(255), primary_key=True),
        sa.Column("value_json", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("notification_monitor_state")
    op.drop_table("notification_preferences")
    op.drop_index("ix_notification_recipients_user_read", table_name="notification_recipients")
    op.drop_table("notification_recipients")
    op.drop_index("ix_notifications_created_at", table_name="notifications")
    op.drop_table("notifications")
