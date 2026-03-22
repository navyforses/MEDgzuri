"""User-related models — profiles, bookmarks, and per-user search history."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class UserProfile(Base):
    """User profile with display name and medical preferences."""

    __tablename__ = "user_profiles"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    user_id: Mapped[str] = mapped_column(
        String(255), nullable=False, unique=True, index=True,
    )
    display_name: Mapped[str | None] = mapped_column(
        String(255), nullable=True,
    )
    medical_preferences: Mapped[dict | None] = mapped_column(
        JSONB, nullable=True, default=dict,
    )
    language: Mapped[str] = mapped_column(
        String(10), nullable=False, insert_default="ka",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class UserBookmark(Base):
    """Bookmarked search result for later reference."""

    __tablename__ = "user_bookmarks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    user_id: Mapped[str] = mapped_column(
        String(255), nullable=False, index=True,
    )
    result_id: Mapped[str] = mapped_column(
        String(255), nullable=False,
    )
    result_data: Mapped[dict] = mapped_column(
        JSONB, nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


class UserSearchHistory(Base):
    """Per-user search history for personalization and history browsing."""

    __tablename__ = "user_search_history"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    user_id: Mapped[str] = mapped_column(
        String(255), nullable=False, index=True,
    )
    query: Mapped[str] = mapped_column(
        Text, nullable=False,
    )
    pipeline_type: Mapped[str] = mapped_column(
        String(50), nullable=False,
    )
    results_summary: Mapped[dict | None] = mapped_column(
        JSONB, nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
