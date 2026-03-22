"""User service — manages profiles, search history, and bookmarks.

Uses async SQLAlchemy sessions against the local PostgreSQL database.
Graceful degradation: all operations return safe defaults on DB failure.
"""

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from app.database import async_session_factory
from app.models.user import UserBookmark, UserProfile, UserSearchHistory

logger = logging.getLogger(__name__)


async def get_profile(user_id: str) -> dict | None:
    """Fetch a user profile by user_id. Returns None if not found."""
    try:
        async with async_session_factory() as session:
            stmt = select(UserProfile).where(UserProfile.user_id == user_id)
            result = await session.execute(stmt)
            profile = result.scalar_one_or_none()
            if profile is None:
                return None
            return {
                "id": str(profile.id),
                "user_id": profile.user_id,
                "display_name": profile.display_name,
                "medical_preferences": profile.medical_preferences or {},
                "language": profile.language,
                "created_at": profile.created_at.isoformat(),
                "updated_at": profile.updated_at.isoformat(),
            }
    except Exception as e:
        logger.error("Failed to get profile for user_id=%s: %s", user_id, str(e)[:200])
        return None


async def update_profile(user_id: str, data: dict) -> dict | None:
    """Update or create a user profile. Returns the updated profile dict."""
    allowed_fields = {"display_name", "medical_preferences", "language"}
    filtered = {k: v for k, v in data.items() if k in allowed_fields}

    if not filtered:
        logger.warning("update_profile called with no valid fields for user_id=%s", user_id)
        return await get_profile(user_id)

    try:
        async with async_session_factory() as session:
            # Try update first
            stmt = select(UserProfile).where(UserProfile.user_id == user_id)
            result = await session.execute(stmt)
            profile = result.scalar_one_or_none()

            if profile is not None:
                # Update existing profile
                update_stmt = (
                    update(UserProfile)
                    .where(UserProfile.user_id == user_id)
                    .values(**filtered, updated_at=datetime.now(timezone.utc))
                )
                await session.execute(update_stmt)
                await session.commit()
                logger.info("Updated profile for user_id=%s", user_id)
            else:
                # Create new profile
                new_profile = UserProfile(
                    user_id=user_id,
                    **filtered,
                )
                session.add(new_profile)
                await session.commit()
                logger.info("Created profile for user_id=%s", user_id)

        return await get_profile(user_id)
    except IntegrityError:
        logger.warning("Integrity error updating profile for user_id=%s — possible race condition", user_id)
        return await get_profile(user_id)
    except Exception as e:
        logger.error("Failed to update profile for user_id=%s: %s", user_id, str(e)[:200])
        return None


async def get_search_history(user_id: str, limit: int = 20) -> list[dict]:
    """Fetch recent search history for a user, newest first."""
    limit = min(max(limit, 1), 100)  # clamp between 1 and 100
    try:
        async with async_session_factory() as session:
            stmt = (
                select(UserSearchHistory)
                .where(UserSearchHistory.user_id == user_id)
                .order_by(UserSearchHistory.created_at.desc())
                .limit(limit)
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [
                {
                    "id": str(row.id),
                    "query": row.query,
                    "pipeline_type": row.pipeline_type,
                    "results_summary": row.results_summary,
                    "created_at": row.created_at.isoformat(),
                }
                for row in rows
            ]
    except Exception as e:
        logger.error("Failed to get search history for user_id=%s: %s", user_id, str(e)[:200])
        return []


async def save_search(user_id: str, query: str, results: dict) -> bool:
    """Save a search to the user's history. Returns True on success."""
    try:
        async with async_session_factory() as session:
            entry = UserSearchHistory(
                user_id=user_id,
                query=query,
                pipeline_type=results.get("pipeline_type", "unknown"),
                results_summary={
                    "meta": results.get("meta", ""),
                    "item_count": len(results.get("items", [])),
                    "items_preview": [
                        {"title": item.get("title", ""), "source": item.get("source", "")}
                        for item in results.get("items", [])[:5]
                    ],
                },
            )
            session.add(entry)
            await session.commit()
            logger.info("Saved search for user_id=%s | query=%s", user_id, query[:80])
            return True
    except Exception as e:
        logger.error("Failed to save search for user_id=%s: %s", user_id, str(e)[:200])
        return False


async def add_bookmark(user_id: str, result_id: str, result_data: dict) -> bool:
    """Bookmark a search result. Returns True on success."""
    try:
        async with async_session_factory() as session:
            # Check for duplicate bookmark
            stmt = select(UserBookmark).where(
                UserBookmark.user_id == user_id,
                UserBookmark.result_id == result_id,
            )
            result = await session.execute(stmt)
            if result.scalar_one_or_none() is not None:
                logger.info("Bookmark already exists for user_id=%s, result_id=%s", user_id, result_id)
                return True

            bookmark = UserBookmark(
                user_id=user_id,
                result_id=result_id,
                result_data=result_data,
            )
            session.add(bookmark)
            await session.commit()
            logger.info("Added bookmark for user_id=%s | result_id=%s", user_id, result_id)
            return True
    except Exception as e:
        logger.error("Failed to add bookmark for user_id=%s: %s", user_id, str(e)[:200])
        return False


async def get_bookmarks(user_id: str) -> list[dict]:
    """Fetch all bookmarks for a user, newest first."""
    try:
        async with async_session_factory() as session:
            stmt = (
                select(UserBookmark)
                .where(UserBookmark.user_id == user_id)
                .order_by(UserBookmark.created_at.desc())
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [
                {
                    "id": str(row.id),
                    "result_id": row.result_id,
                    "result_data": row.result_data,
                    "created_at": row.created_at.isoformat(),
                }
                for row in rows
            ]
    except Exception as e:
        logger.error("Failed to get bookmarks for user_id=%s: %s", user_id, str(e)[:200])
        return []


async def delete_bookmark(user_id: str, bookmark_id: str) -> bool:
    """Delete a bookmark by ID. Only deletes if it belongs to the given user."""
    try:
        bookmark_uuid = uuid.UUID(bookmark_id)
    except ValueError:
        logger.warning("Invalid bookmark_id format: %s", bookmark_id[:50])
        return False

    try:
        async with async_session_factory() as session:
            stmt = delete(UserBookmark).where(
                UserBookmark.id == bookmark_uuid,
                UserBookmark.user_id == user_id,
            )
            result = await session.execute(stmt)
            await session.commit()
            deleted = result.rowcount > 0
            if deleted:
                logger.info("Deleted bookmark %s for user_id=%s", bookmark_id, user_id)
            else:
                logger.info("Bookmark %s not found for user_id=%s", bookmark_id, user_id)
            return deleted
    except Exception as e:
        logger.error("Failed to delete bookmark %s for user_id=%s: %s", bookmark_id, user_id, str(e)[:200])
        return False
