"""shared.memory_chunks.source_ref for idempotent migration of legacy memory rows."""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE shared.memory_chunks ADD COLUMN source_ref text")
    op.execute("CREATE UNIQUE INDEX memory_chunks_source_ref ON shared.memory_chunks (tenant, source_ref) WHERE source_ref IS NOT NULL")
    op.execute("CREATE INDEX memory_chunks_tenant_ns ON shared.memory_chunks (tenant, namespace)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS shared.memory_chunks_tenant_ns")
    op.execute("DROP INDEX IF EXISTS shared.memory_chunks_source_ref")
    op.execute("ALTER TABLE shared.memory_chunks DROP COLUMN source_ref")
