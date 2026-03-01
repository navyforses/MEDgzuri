"""CachedResult model — persistent cache layer backed by PostgreSQL."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class CachedResult(Base):
    """Database-backed cache for search results with TTL."""

    __tablename__ = "cached_results"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    cache_key: Mapped[str] = mapped_column(
        String(128), unique=True, nullable=False, index=True,
    )
    pipeline_type: Mapped[str] = mapped_column(String(50), nullable=False)
    result_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    hit_count: Mapped[int] = mapped_column(Integer, nullable=False, insert_default=0)
