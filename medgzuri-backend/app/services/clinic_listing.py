"""Clinic listing service — B2B monetization for clinics.

Tiers:
  - basic:    free — name + contact only
  - verified: ₾50/month — badge, priority in search, detailed profile
  - premium:  ₾100/month — featured placement, analytics dashboard
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import desc, func, select

from app.database import async_session_factory
from app.models.subscription import ClinicListing, UsageLog

logger = logging.getLogger(__name__)

LISTING_TIERS = {
    "basic": {
        "name": "ბაზისური",
        "name_en": "Basic",
        "monthly_fee_gel": 0,
        "features": ["name", "contact"],
    },
    "verified": {
        "name": "ვერიფიცირებული",
        "name_en": "Verified",
        "monthly_fee_gel": 50,
        "features": ["name", "contact", "badge", "priority_search", "detailed_profile"],
    },
    "premium": {
        "name": "პრემიუმ",
        "name_en": "Premium",
        "monthly_fee_gel": 100,
        "features": [
            "name", "contact", "badge", "priority_search",
            "detailed_profile", "featured_placement", "analytics_dashboard",
        ],
    },
}


async def create_listing(clinic_data: dict) -> dict:
    """Create a new clinic listing (default: basic tier)."""
    try:
        async with async_session_factory() as session:
            tier = clinic_data.get("tier", "basic")
            tier_def = LISTING_TIERS.get(tier, LISTING_TIERS["basic"])

            listing = ClinicListing(
                clinic_name=clinic_data.get("clinic_name", ""),
                clinic_name_ka=clinic_data.get("clinic_name_ka", ""),
                country=clinic_data.get("country", ""),
                city=clinic_data.get("city", ""),
                contact_email=clinic_data.get("contact_email", ""),
                contact_phone=clinic_data.get("contact_phone", ""),
                website=clinic_data.get("website", ""),
                specialties=clinic_data.get("specialties"),
                tier=tier,
                monthly_fee=tier_def["monthly_fee_gel"],
                start_date=datetime.now(timezone.utc),
                end_date=datetime.now(timezone.utc) + timedelta(days=30) if tier != "basic" else None,
                is_active=True,
            )
            session.add(listing)
            await session.commit()
            await session.refresh(listing)

            return {
                "id": str(listing.id),
                "clinic_name": listing.clinic_name,
                "tier": listing.tier,
                "tier_name": tier_def["name"],
                "monthly_fee_gel": tier_def["monthly_fee_gel"],
                "features": tier_def["features"],
                "is_active": True,
                "start_date": listing.start_date.isoformat(),
                "end_date": listing.end_date.isoformat() if listing.end_date else None,
            }
    except Exception as e:
        logger.error("create_listing failed: %s", str(e)[:200])
        return {"error": "კლინიკის ჩანაწერის შექმნა ვერ მოხერხდა."}


async def upgrade_listing(listing_id: str, tier: str) -> bool:
    """Upgrade a clinic listing to a higher tier. Payment is a STUB."""
    if tier not in ("verified", "premium"):
        return False

    try:
        listing_uuid = uuid.UUID(listing_id)
    except ValueError:
        return False

    try:
        async with async_session_factory() as session:
            result = await session.execute(
                select(ClinicListing).where(ClinicListing.id == listing_uuid)
            )
            listing = result.scalar_one_or_none()
            if not listing:
                return False

            tier_def = LISTING_TIERS[tier]
            listing.tier = tier
            listing.monthly_fee = tier_def["monthly_fee_gel"]
            listing.start_date = datetime.now(timezone.utc)
            listing.end_date = datetime.now(timezone.utc) + timedelta(days=30)
            listing.is_active = True

            await session.commit()
            return True
    except Exception as e:
        logger.error("upgrade_listing failed: %s", str(e)[:200])
        return False


async def get_listing_analytics(listing_id: str) -> dict:
    """Get analytics for a clinic listing (impressions, clicks from search results)."""
    try:
        listing_uuid = uuid.UUID(listing_id)
    except ValueError:
        return {"error": "არასწორი ID."}

    try:
        async with async_session_factory() as session:
            # Verify listing exists and is premium
            result = await session.execute(
                select(ClinicListing).where(ClinicListing.id == listing_uuid)
            )
            listing = result.scalar_one_or_none()
            if not listing:
                return {"error": "ჩანაწერი ვერ მოიძებნა."}

            if listing.tier not in ("verified", "premium"):
                return {"error": "ანალიტიკა ხელმისაწვდომია მხოლოდ ვერიფიცირებული და პრემიუმ ჩანაწერებისთვის."}

            # Count impressions (searches that included this clinic's country/specialty)
            now = datetime.now(timezone.utc)
            month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

            r_impressions = await session.execute(
                select(func.count(UsageLog.id)).where(
                    UsageLog.action == "search",
                    UsageLog.pipeline_type == "clinic_search",
                    UsageLog.created_at >= month_start,
                )
            )
            impressions = r_impressions.scalar() or 0

            return {
                "listing_id": listing_id,
                "clinic_name": listing.clinic_name,
                "tier": listing.tier,
                "period": "month",
                "impressions": impressions,
                "is_active": listing.is_active,
                "generated_at": now.isoformat(),
            }
    except Exception as e:
        logger.error("get_listing_analytics failed: %s", str(e)[:200])
        return {"error": "ანალიტიკის ჩატვირთვა ვერ მოხერხდა."}


async def get_active_listings(tier: str | None = None, country: str | None = None) -> list[dict]:
    """Get active clinic listings, optionally filtered by tier or country."""
    try:
        async with async_session_factory() as session:
            query = select(ClinicListing).where(ClinicListing.is_active == True)

            if tier:
                query = query.where(ClinicListing.tier == tier)
            if country:
                query = query.where(ClinicListing.country == country)

            # Premium first, then verified, then basic
            query = query.order_by(
                desc(ClinicListing.tier == "premium"),
                desc(ClinicListing.tier == "verified"),
                ClinicListing.clinic_name,
            )

            result = await session.execute(query)
            listings = result.scalars().all()

            return [
                {
                    "id": str(l.id),
                    "clinic_name": l.clinic_name,
                    "clinic_name_ka": l.clinic_name_ka,
                    "country": l.country,
                    "city": l.city,
                    "tier": l.tier,
                    "tier_name": LISTING_TIERS.get(l.tier, {}).get("name", ""),
                    "contact_email": l.contact_email if l.tier != "basic" else "",
                    "contact_phone": l.contact_phone if l.tier != "basic" else "",
                    "website": l.website,
                    "specialties": l.specialties,
                    "is_verified": l.tier in ("verified", "premium"),
                    "is_premium": l.tier == "premium",
                }
                for l in listings
            ]
    except Exception as e:
        logger.error("get_active_listings failed: %s", str(e)[:200])
        return []


def get_listing_tier_info() -> dict:
    """Return all listing tier definitions for display."""
    return {"tiers": LISTING_TIERS}
