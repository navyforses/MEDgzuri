"""Alert service — manage research alert subscriptions and check for new results.

Lets users subscribe to PubMed research alerts for diseases/conditions
and receive notifications when new articles are published.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, update

from app.database import async_session_factory
from app.integrations.pubmed import PubMedClient
from app.models.alert import ResearchAlert

logger = logging.getLogger(__name__)


async def create_alert(
    user_id: str,
    query: str,
    frequency: str = "daily",
) -> dict[str, Any]:
    """Create a new research alert subscription.

    Args:
        user_id: Identifier of the subscribing user.
        query: Medical search query (disease, condition, etc.).
        frequency: Check frequency — "daily", "weekly", etc.

    Returns:
        Dict representation of the created alert.
    """
    try:
        async with async_session_factory() as session:
            alert = ResearchAlert(
                id=uuid.uuid4(),
                user_id=user_id,
                query=query,
                frequency=frequency,
                is_active=True,
                last_checked_at=None,
                created_at=datetime.now(timezone.utc),
            )
            session.add(alert)
            await session.commit()
            await session.refresh(alert)
            logger.info("Created research alert %s for user %s", alert.id, user_id)
            return _alert_to_dict(alert)
    except Exception:
        logger.exception("Failed to create alert for user %s", user_id)
        raise


async def get_alerts(user_id: str) -> list[dict[str, Any]]:
    """Retrieve all research alerts for a given user.

    Args:
        user_id: Identifier of the user.

    Returns:
        List of alert dicts, ordered by creation date descending.
    """
    try:
        async with async_session_factory() as session:
            stmt = (
                select(ResearchAlert)
                .where(ResearchAlert.user_id == user_id)
                .order_by(ResearchAlert.created_at.desc())
            )
            result = await session.execute(stmt)
            alerts = result.scalars().all()
            return [_alert_to_dict(a) for a in alerts]
    except Exception:
        logger.exception("Failed to fetch alerts for user %s", user_id)
        raise


async def delete_alert(user_id: str, alert_id: str) -> bool:
    """Delete (deactivate) a research alert.

    Args:
        user_id: Owner of the alert (for authorization).
        alert_id: UUID of the alert to delete.

    Returns:
        True if the alert was found and deleted, False otherwise.
    """
    try:
        async with async_session_factory() as session:
            stmt = select(ResearchAlert).where(
                ResearchAlert.id == uuid.UUID(alert_id),
                ResearchAlert.user_id == user_id,
            )
            result = await session.execute(stmt)
            alert = result.scalar_one_or_none()
            if alert is None:
                logger.warning(
                    "Alert %s not found for user %s", alert_id, user_id,
                )
                return False
            await session.delete(alert)
            await session.commit()
            logger.info("Deleted alert %s for user %s", alert_id, user_id)
            return True
    except Exception:
        logger.exception("Failed to delete alert %s", alert_id)
        raise


async def check_new_research(alert_dict: dict[str, Any]) -> list[dict[str, Any]]:
    """Check PubMed for new research matching an alert query.

    Args:
        alert_dict: Alert dict containing at least 'query' and optionally
                    'last_checked_at'.

    Returns:
        List of new article dicts from PubMed.
    """
    query = alert_dict.get("query", "")
    if not query:
        return []

    try:
        client = PubMedClient()
        results = await client.search(query=query, max_results=5)
        logger.info(
            "Found %d results for alert query '%s'", len(results), query,
        )
        return results
    except Exception:
        logger.exception("PubMed search failed for alert query '%s'", query)
        return []


async def run_daily_check() -> list[dict[str, Any]]:
    """Run scheduled check on all active alerts.

    Queries PubMed for each active alert, updates last_checked_at,
    and returns notification payloads for alerts with new results.

    Returns:
        List of notification dicts with keys:
        user_id, alert_id, query, new_results, channel.
    """
    notifications: list[dict[str, Any]] = []

    try:
        async with async_session_factory() as session:
            stmt = select(ResearchAlert).where(ResearchAlert.is_active.is_(True))
            result = await session.execute(stmt)
            active_alerts = result.scalars().all()

        logger.info("Running daily check for %d active alerts", len(active_alerts))

        for alert in active_alerts:
            alert_dict = _alert_to_dict(alert)
            new_results = await check_new_research(alert_dict)

            # Update last_checked_at regardless of results
            try:
                async with async_session_factory() as session:
                    stmt = (
                        update(ResearchAlert)
                        .where(ResearchAlert.id == alert.id)
                        .values(last_checked_at=datetime.now(timezone.utc))
                    )
                    await session.execute(stmt)
                    await session.commit()
            except Exception:
                logger.exception(
                    "Failed to update last_checked_at for alert %s", alert.id,
                )

            if new_results:
                notifications.append({
                    "user_id": alert.user_id,
                    "alert_id": str(alert.id),
                    "query": alert.query,
                    "new_results": new_results,
                    "channel": "in_app",
                })

        logger.info(
            "Daily check complete: %d notifications generated", len(notifications),
        )
    except Exception:
        logger.exception("Failed to run daily alert check")

    return notifications


def _alert_to_dict(alert: ResearchAlert) -> dict[str, Any]:
    """Convert a ResearchAlert ORM instance to a plain dict."""
    return {
        "id": str(alert.id),
        "user_id": alert.user_id,
        "query": alert.query,
        "frequency": alert.frequency,
        "is_active": alert.is_active,
        "last_checked_at": (
            alert.last_checked_at.isoformat() if alert.last_checked_at else None
        ),
        "created_at": alert.created_at.isoformat(),
    }
