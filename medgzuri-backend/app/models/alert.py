"""ResearchAlert model — user subscriptions for research monitoring."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ResearchAlert(Base):
    """Tracks user subscriptions for new research on specific queries."""

    __tablename__ = "research_alerts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    user_id: Mapped[str] = mapped_column(
        String(255), nullable=False, index=True,
    )
    query: Mapped[str] = mapped_column(
        String(500), nullable=False,
    )
    frequency: Mapped[str] = mapped_column(
        String(50), nullable=False, insert_default="daily",
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, insert_default=True,
    )
    last_checked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
