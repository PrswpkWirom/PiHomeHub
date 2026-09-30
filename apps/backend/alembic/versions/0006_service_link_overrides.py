"""Explicit dashboard URL overrides."""
from alembic import op
import sqlalchemy as sa

revision = "0006_service_link_overrides"
down_revision = "0005_notification_center"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("service_links", sa.Column("url_override", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("service_links", "url_override")
