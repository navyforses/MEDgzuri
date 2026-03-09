"""initial_schema

Revision ID: 001
Revises:
Create Date: 2026-03-08

Creates search_history and cached_results tables.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '001'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create search_history and cached_results tables."""
    op.create_table(
        'search_history',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('pipeline_type', sa.String(50), nullable=False, index=True),
        sa.Column('input_data', postgresql.JSONB(), nullable=False),
        sa.Column('response_data', postgresql.JSONB(), nullable=False),
        sa.Column('source', sa.String(30), nullable=False, server_default='direct'),
        sa.Column('execution_time_ms', sa.Integer(), nullable=False),
        sa.Column('client_ip_hash', sa.String(64), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )

    op.create_table(
        'cached_results',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('cache_key', sa.String(128), nullable=False, unique=True, index=True),
        sa.Column('pipeline_type', sa.String(50), nullable=False),
        sa.Column('result_data', postgresql.JSONB(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('hit_count', sa.Integer(), nullable=False, server_default='0'),
    )


def downgrade() -> None:
    """Drop search_history and cached_results tables."""
    op.drop_table('cached_results')
    op.drop_table('search_history')
