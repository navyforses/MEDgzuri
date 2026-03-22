"""Analytics service — usage tracking, popular searches, geographic distribution.

Tracks:
  - Search queries (what, type, results count)
  - Conversion events (free → pro → doctor)
  - Geographic distribution
  - Popular treatments and clinics
"""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import desc, func, select

from app.database import async_session_factory
from app.models.subscription import Subscription, UsageLog

logger = logging.getLogger(__name__)


# ═══════════════ LOGGING ═══════════════


async def log_search(
    user_id: str,
    query: str,
    pipeline_type: str,
    results_count: int,
    ip_hash: str = "",
    country: str = "",
    metadata: dict | None = None,
) -> None:
    """Log a search event for analytics."""
    try:
        async with async_session_factory() as session:
            log = UsageLog(
                user_id=user_id,
                action="search",
                query=query,
                pipeline_type=pipeline_type,
                results_count=results_count,
                ip_hash=ip_hash,
                country=country,
                metadata_json=metadata,
            )
            session.add(log)
            await session.commit()
    except Exception as e:
        logger.debug("Analytics log_search failed (non-fatal): %s", str(e)[:100])


async def log_event(
    user_id: str,
    action: str,
    metadata: dict | None = None,
) -> None:
    """Log a generic event (conversion, feature usage, etc.)."""
    try:
        async with async_session_factory() as session:
            log = UsageLog(
                user_id=user_id,
                action=action,
                metadata_json=metadata,
            )
            session.add(log)
            await session.commit()
    except Exception as e:
        logger.debug("Analytics log_event failed (non-fatal): %s", str(e)[:100])


# ═══════════════ QUERIES ═══════════════


async def get_popular_searches(days: int = 30, limit: int = 20) -> list[dict]:
    """Return most popular search queries in the last N days."""
    try:
        async with async_session_factory() as session:
            cutoff = datetime.now(timezone.utc) - timedelta(days=days)
            result = await session.execute(
                select(
                    UsageLog.query,
                    UsageLog.pipeline_type,
                    func.count(UsageLog.id).label("count"),
                )
                .where(
                    UsageLog.action == "search",
                    UsageLog.created_at >= cutoff,
                    UsageLog.query != "",
                )
                .group_by(UsageLog.query, UsageLog.pipeline_type)
                .order_by(desc("count"))
                .limit(limit)
            )
            return [
                {"query": row.query, "type": row.pipeline_type, "count": row.count}
                for row in result.all()
            ]
    except Exception as e:
        logger.warning("get_popular_searches failed: %s", str(e)[:100])
        return []


async def get_geographic_stats() -> dict:
    """Return search counts grouped by country."""
    try:
        async with async_session_factory() as session:
            cutoff = datetime.now(timezone.utc) - timedelta(days=30)
            result = await session.execute(
                select(
                    UsageLog.country,
                    func.count(UsageLog.id).label("count"),
                )
                .where(
                    UsageLog.action == "search",
                    UsageLog.created_at >= cutoff,
                    UsageLog.country != "",
                )
                .group_by(UsageLog.country)
                .order_by(desc("count"))
                .limit(50)
            )
            countries = {row.country: row.count for row in result.all()}
            return {"period_days": 30, "countries": countries}
    except Exception as e:
        logger.warning("get_geographic_stats failed: %s", str(e)[:100])
        return {"period_days": 30, "countries": {}}


async def get_usage_dashboard() -> dict:
    """Return a full analytics dashboard summary."""
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    week_start = now - timedelta(days=7)

    try:
        async with async_session_factory() as session:
            # Total searches today
            r_today = await session.execute(
                select(func.count(UsageLog.id)).where(
                    UsageLog.action == "search",
                    UsageLog.created_at >= today_start,
                )
            )
            searches_today = r_today.scalar() or 0

            # Total searches this week
            r_week = await session.execute(
                select(func.count(UsageLog.id)).where(
                    UsageLog.action == "search",
                    UsageLog.created_at >= week_start,
                )
            )
            searches_week = r_week.scalar() or 0

            # Total searches this month
            r_month = await session.execute(
                select(func.count(UsageLog.id)).where(
                    UsageLog.action == "search",
                    UsageLog.created_at >= month_start,
                )
            )
            searches_month = r_month.scalar() or 0

            # Unique users this month
            r_users = await session.execute(
                select(func.count(func.distinct(UsageLog.user_id))).where(
                    UsageLog.action == "search",
                    UsageLog.created_at >= month_start,
                )
            )
            unique_users_month = r_users.scalar() or 0

            # Subscription tier distribution
            r_tiers = await session.execute(
                select(
                    Subscription.tier,
                    func.count(Subscription.id).label("count"),
                ).group_by(Subscription.tier)
            )
            tier_distribution = {row.tier: row.count for row in r_tiers.all()}

            # Searches by pipeline type (this month)
            r_types = await session.execute(
                select(
                    UsageLog.pipeline_type,
                    func.count(UsageLog.id).label("count"),
                )
                .where(
                    UsageLog.action == "search",
                    UsageLog.created_at >= month_start,
                    UsageLog.pipeline_type != "",
                )
                .group_by(UsageLog.pipeline_type)
            )
            searches_by_type = {row.pipeline_type: row.count for row in r_types.all()}

            # Conversions this month
            r_upgrades = await session.execute(
                select(func.count(UsageLog.id)).where(
                    UsageLog.action == "subscription_upgrade",
                    UsageLog.created_at >= month_start,
                )
            )
            upgrades_month = r_upgrades.scalar() or 0

            return {
                "period": "month",
                "searches_today": searches_today,
                "searches_week": searches_week,
                "searches_month": searches_month,
                "unique_users_month": unique_users_month,
                "tier_distribution": tier_distribution,
                "searches_by_type": searches_by_type,
                "conversions_month": upgrades_month,
                "generated_at": now.isoformat(),
            }

    except Exception as e:
        logger.error("get_usage_dashboard failed: %s", str(e)[:200])
        return {
            "error": "ანალიტიკის ჩატვირთვა ვერ მოხერხდა.",
            "generated_at": now.isoformat(),
        }
