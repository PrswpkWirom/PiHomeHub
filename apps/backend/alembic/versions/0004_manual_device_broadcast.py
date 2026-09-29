"""add broadcast address to manual devices"""

from alembic import op
import sqlalchemy as sa

revision = "0004_manual_device_broadcast"
down_revision = "0003_security_phase1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("broadcast_address", sa.String(length=128), nullable=True))


def downgrade() -> None:
    op.drop_column("devices", "broadcast_address")
