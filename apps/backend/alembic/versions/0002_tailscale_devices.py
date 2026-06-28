"""tailscale devices"""

from alembic import op
import sqlalchemy as sa

revision = "0002_tailscale_devices"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tailscale_devices",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tailscale_id", sa.String(length=128), nullable=False),
        sa.Column("node_id", sa.String(length=128), nullable=True),
        sa.Column("machine_name", sa.String(length=255), nullable=False),
        sa.Column("hostname", sa.String(length=255), nullable=True),
        sa.Column("tailscale_ips", sa.Text(), nullable=False),
        sa.Column("os", sa.String(length=64), nullable=True),
        sa.Column("online", sa.Boolean(), nullable=False),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tags", sa.Text(), nullable=False),
        sa.Column("sync_status", sa.String(length=32), nullable=False),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("supports_wol", sa.Boolean(), nullable=False),
        sa.Column("mac_address", sa.String(length=32), nullable=True),
        sa.Column("lan_ip_address", sa.String(length=128), nullable=True),
        sa.Column("broadcast_address", sa.String(length=128), nullable=True),
        sa.Column("alias", sa.String(length=128), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_tailscale_devices_id"), "tailscale_devices", ["id"], unique=False)
    op.create_index(op.f("ix_tailscale_devices_tailscale_id"), "tailscale_devices", ["tailscale_id"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_tailscale_devices_tailscale_id"), table_name="tailscale_devices")
    op.drop_index(op.f("ix_tailscale_devices_id"), table_name="tailscale_devices")
    op.drop_table("tailscale_devices")
