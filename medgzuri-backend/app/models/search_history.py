"""SearchHistory model — logs every search request for analytics."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SearchHistory(Base):
    """Persistent log of all search requests and responses."""

    __tablename__ = "search_history"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    pipeline_type: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True,
    )
    input_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    response_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    source: Mapped[str] = mapped_column(
        String(30), nullable=False, insert_default="direct",
    )
    execution_time_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    client_ip_hash: Mapped[str] = mapped_column(String(64), nullable=False, insert_default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
