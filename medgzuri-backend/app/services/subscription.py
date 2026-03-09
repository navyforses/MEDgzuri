"""Subscription service — freemium tier management and quota enforcement.

Tiers:
  - free:   5 searches/day, basic results
  - pro:    ₾15/month — unlimited searches, evidence grading, price comparison, alerts
  - doctor: ₾30/month — everything + API access, patient management, referrals
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.database import async_session_factory
from app.models.subscription import Subscription, UsageLog

logger = logging.getLogger(__name__)

# ═══════════════ TIER DEFINITIONS ═══════════════

TIERS = {
    "free": {
        "name": "უფასო",
        "name_en": "Free",
        "price_gel": 0,
        "daily_search_limit": 5,
        "features": ["basic_search"],
    },
    "pro": {
        "name": "პრო",
        "name_en": "Pro",
        "price_gel": 15,
        "daily_search_limit": -1,  # unlimited
        "features": [
            "basic_search",
            "evidence_grading",
            "price_comparison",
            "alerts",
            "search_history",
            "bookmarks",
        ],
    },
    "doctor": {
        "name": "ექიმი",
        "name_en": "Doctor",
        "price_gel": 30,
        "daily_search_limit": -1,  # unlimited
        "features": [
            "basic_search",
            "evidence_grading",
            "price_comparison",
            "alerts",
            "search_history",
            "bookmarks",
            "api_access",
            "patient_management",
            "referrals",
            "report_generation",
        ],
    },
}


@dataclass
class SubscriptionInfo:
    user_id: str
    tier: str
    tier_name: str
    price_gel: int
    start_date: str | None
    end_date: str | None
    features: list[str]
    is_active: bool


@dataclass
class QuotaCheck:
    allowed: bool
    remaining: int
    tier: str
    message: str


@dataclass
class UsageStats:
    searches_today: int
    searches_month: int
    tier: str
    features: list[str]
    daily_limit: int


# ═══════════════ PUBLIC API ═══════════════


async def get_subscription(user_id: str) -> SubscriptionInfo:
    """Get subscription info for a user. Returns free tier if none exists."""
    try:
        async with async_session_factory() as session:
            result = await session.execute(
                select(Subscription).where(Subscription.user_id == user_id)
            )
            sub = result.scalar_one_or_none()

            if sub:
                tier_def = TIERS.get(sub.tier, TIERS["free"])
                now = datetime.now(timezone.utc)
                is_active = sub.tier == "free" or (sub.end_date is not None and sub.end_date > now)
                effective_tier = sub.tier if is_active else "free"
                effective_def = TIERS.get(effective_tier, TIERS["free"])

                return SubscriptionInfo(
                    user_id=user_id,
                    tier=effective_tier,
                    tier_name=effective_def["name"],
                    price_gel=effective_def["price_gel"],
                    start_date=sub.start_date.isoformat() if sub.start_date else None,
                    end_date=sub.end_date.isoformat() if sub.end_date else None,
                    features=effective_def["features"],
                    is_active=is_active,
                )
    except Exception as e:
        logger.warning("Failed to get subscription (defaulting to free): %s", str(e)[:100])

    # Default: free tier
    return _free_subscription(user_id)


async def check_search_quota(user_id: str) -> QuotaCheck:
    """Check if user can perform a search based on their tier quota."""
    sub = await get_subscription(user_id)
    tier_def = TIERS.get(sub.tier, TIERS["free"])
    daily_limit = tier_def["daily_search_limit"]

    # Unlimited
    if daily_limit == -1:
        return QuotaCheck(
            allowed=True,
            remaining=-1,
            tier=sub.tier,
            message="",
        )

    # Count today's searches
    searches_today = await _count_today_searches(user_id)
    remaining = max(0, daily_limit - searches_today)

    if remaining <= 0:
        return QuotaCheck(
            allowed=False,
            remaining=0,
            tier=sub.tier,
            message=(
                "დღიური ლიმიტი ამოიწურა (5 ძიება/დღე). "
                "განაახლეთ პრო პაკეტზე (₾15/თვე) ულიმიტო ძიებისთვის. "
                "პრო პაკეტი ასევე მოიცავს evidence grading-ს, ფასების შედარებას და alerts-ს."
            ),
        )

    return QuotaCheck(
        allowed=True,
        remaining=remaining,
        tier=sub.tier,
        message="",
    )


async def upgrade_subscription(user_id: str, tier: str, payment_ref: str = "") -> bool:
    """Upgrade user to a paid tier. Payment is a STUB — ready for Stripe/BOG integration."""
    if tier not in ("pro", "doctor"):
        return False

    try:
        async with async_session_factory() as session:
            result = await session.execute(
                select(Subscription).where(Subscription.user_id == user_id)
            )
            sub = result.scalar_one_or_none()

            now = datetime.now(timezone.utc)
            end = now + timedelta(days=30)

            if sub:
                sub.tier = tier
                sub.start_date = now
                sub.end_date = end
                sub.payment_method = "stub"
                sub.payment_ref = payment_ref
            else:
                sub = Subscription(
                    user_id=user_id,
                    tier=tier,
                    start_date=now,
                    end_date=end,
                    payment_method="stub",
                    payment_ref=payment_ref,
                )
                session.add(sub)

            # Log the conversion
            log = UsageLog(
                user_id=user_id,
                action="subscription_upgrade",
                query=f"upgrade_to_{tier}",
                metadata_json={"tier": tier, "payment_ref": payment_ref},
            )
            session.add(log)
            await session.commit()
            return True
    except Exception as e:
        logger.error("Subscription upgrade failed: %s", str(e)[:200])
        return False


async def downgrade_subscription(user_id: str) -> bool:
    """Downgrade user back to free tier."""
    try:
        async with async_session_factory() as session:
            result = await session.execute(
                select(Subscription).where(Subscription.user_id == user_id)
            )
            sub = result.scalar_one_or_none()

            if sub:
                old_tier = sub.tier
                sub.tier = "free"
                sub.end_date = datetime.now(timezone.utc)
                sub.payment_method = "none"
                sub.payment_ref = ""

                log = UsageLog(
                    user_id=user_id,
                    action="subscription_downgrade",
                    query=f"downgrade_from_{old_tier}",
                    metadata_json={"old_tier": old_tier},
                )
                session.add(log)
                await session.commit()
            return True
    except Exception as e:
        logger.error("Subscription downgrade failed: %s", str(e)[:200])
        return False


async def get_usage_stats(user_id: str) -> UsageStats:
    """Get usage statistics for a user."""
    sub = await get_subscription(user_id)
    tier_def = TIERS.get(sub.tier, TIERS["free"])

    searches_today = await _count_today_searches(user_id)
    searches_month = await _count_month_searches(user_id)

    return UsageStats(
        searches_today=searches_today,
        searches_month=searches_month,
        tier=sub.tier,
        features=tier_def["features"],
        daily_limit=tier_def["daily_search_limit"],
    )


def get_tier_info() -> dict:
    """Return all tier definitions for display."""
    return {
        "tiers": {
            k: {
                "name": v["name"],
                "name_en": v["name_en"],
                "price_gel": v["price_gel"],
                "daily_search_limit": v["daily_search_limit"],
                "features": v["features"],
            }
            for k, v in TIERS.items()
        }
    }


# ═══════════════ HELPERS ═══════════════


def _free_subscription(user_id: str) -> SubscriptionInfo:
    free_def = TIERS["free"]
    return SubscriptionInfo(
        user_id=user_id,
        tier="free",
        tier_name=free_def["name"],
        price_gel=0,
        start_date=None,
        end_date=None,
        features=free_def["features"],
        is_active=True,
    )


async def _count_today_searches(user_id: str) -> int:
    """Count how many searches user did today (UTC)."""
    try:
        async with async_session_factory() as session:
            today_start = datetime.now(timezone.utc).replace(
                hour=0, minute=0, second=0, microsecond=0,
            )
            result = await session.execute(
                select(func.count(UsageLog.id)).where(
                    UsageLog.user_id == user_id,
                    UsageLog.action == "search",
                    UsageLog.created_at >= today_start,
                )
            )
            return result.scalar() or 0
    except Exception:
        return 0


async def _count_month_searches(user_id: str) -> int:
    """Count how many searches user did this month (UTC)."""
    try:
        async with async_session_factory() as session:
            now = datetime.now(timezone.utc)
            month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            result = await session.execute(
                select(func.count(UsageLog.id)).where(
                    UsageLog.user_id == user_id,
                    UsageLog.action == "search",
                    UsageLog.created_at >= month_start,
                )
            )
            return result.scalar() or 0
    except Exception:
        return 0
