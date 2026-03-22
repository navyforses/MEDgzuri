"""Async database engine and session management.

Uses SQLAlchemy 2.0 async with asyncpg driver.
Graceful degradation: if PostgreSQL is unavailable, the app continues without DB.
"""

import logging

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

logger = logging.getLogger(__name__)

engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db():
    """FastAPI dependency — yields an async DB session."""
    async with async_session_factory() as session:
        yield session


async def init_db() -> bool:
    """Create tables if they don't exist. Returns True on success."""
    from app.models import Base  # noqa: F811

    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database initialized successfully")
        return True
    except Exception as e:
        logger.warning("Database unavailable — continuing without persistence: %s", str(e)[:200])
        return False


async def close_db():
    """Dispose engine connections on shutdown."""
    await engine.dispose()
    logger.info("Database connections closed")
