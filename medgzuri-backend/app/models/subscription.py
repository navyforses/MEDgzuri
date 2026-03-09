"""Subscription and monetization models — tiers, usage logs, clinic listings."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Subscription(Base):
    """User subscription — free / pro / doctor tiers."""

    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    user_id: Mapped[str] = mapped_column(
        String(255), nullable=False, unique=True, index=True,
    )
    tier: Mapped[str] = mapped_column(
        String(20), nullable=False, insert_default="free",
    )
    start_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    end_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    payment_method: Mapped[str] = mapped_column(
        String(50), nullable=False, insert_default="none",
    )
    payment_ref: Mapped[str] = mapped_column(
        String(255), nullable=False, insert_default="",
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


class UsageLog(Base):
    """Usage tracking — searches, conversions, feature usage."""

    __tablename__ = "usage_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    user_id: Mapped[str] = mapped_column(
        String(255), nullable=False, index=True,
    )
    action: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True,
    )
    query: Mapped[str] = mapped_column(
        Text, nullable=False, insert_default="",
    )
    pipeline_type: Mapped[str] = mapped_column(
        String(50), nullable=False, insert_default="",
    )
    results_count: Mapped[int] = mapped_column(
        Integer, nullable=False, insert_default=0,
    )
    metadata_json: Mapped[dict | None] = mapped_column(
        JSONB, nullable=True,
    )
    ip_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, insert_default="",
    )
    country: Mapped[str] = mapped_column(
        String(10), nullable=False, insert_default="",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


class ClinicListing(Base):
    """Clinic listing — B2B monetization (basic / verified / premium)."""

    __tablename__ = "clinic_listings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    clinic_name: Mapped[str] = mapped_column(
        String(255), nullable=False,
    )
    clinic_name_ka: Mapped[str] = mapped_column(
        String(255), nullable=False, insert_default="",
    )
    country: Mapped[str] = mapped_column(
        String(100), nullable=False,
    )
    city: Mapped[str] = mapped_column(
        String(100), nullable=False, insert_default="",
    )
    contact_email: Mapped[str] = mapped_column(
        String(255), nullable=False, insert_default="",
    )
    contact_phone: Mapped[str] = mapped_column(
        String(50), nullable=False, insert_default="",
    )
    website: Mapped[str] = mapped_column(
        String(500), nullable=False, insert_default="",
    )
    specialties: Mapped[dict | None] = mapped_column(
        JSONB, nullable=True,
    )
    tier: Mapped[str] = mapped_column(
        String(20), nullable=False, insert_default="basic",
    )
    monthly_fee: Mapped[float] = mapped_column(
        Float, nullable=False, insert_default=0.0,
    )
    start_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    end_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(
        nullable=False, insert_default=True,
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
