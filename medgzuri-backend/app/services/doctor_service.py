"""Doctor service — manages doctor profiles, result sharing, and referrals.

Uses async SQLAlchemy sessions against the local PostgreSQL database.
Graceful degradation: all operations return safe defaults on DB failure.
"""

import logging
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.database import async_session_factory
from app.models.doctor import DoctorProfile, Referral, SharedResult

logger = logging.getLogger(__name__)

SHARE_LINK_EXPIRY_DAYS = 7
SHARE_BASE_URL = "/shared"


async def register_doctor(user_id: str, specialty: str, license_number: str) -> dict:
    """Register a new doctor profile. Returns the created profile dict."""
    try:
        async with async_session_factory() as session:
            profile = DoctorProfile(
                user_id=user_id,
                specialty=specialty,
                license_number=license_number,
            )
            session.add(profile)
            await session.commit()
            await session.refresh(profile)

            logger.info("Doctor registered: user_id=%s, specialty=%s", user_id, specialty)
            return {
                "id": str(profile.id),
                "user_id": profile.user_id,
                "specialty": profile.specialty,
                "license_number": profile.license_number,
                "is_verified": profile.is_verified,
                "verified_at": None,
                "created_at": profile.created_at.isoformat(),
            }
    except IntegrityError:
        logger.warning("Doctor profile already exists for user_id=%s", user_id)
        return {"error": "Doctor profile already exists for this user"}
    except Exception as e:
        logger.error("Failed to register doctor user_id=%s: %s", user_id, str(e)[:200])
        return {"error": "Failed to register doctor profile"}


async def verify_doctor(doctor_id: str) -> bool:
    """Admin action — mark a doctor profile as verified. Returns True on success."""
    try:
        async with async_session_factory() as session:
            stmt = (
                update(DoctorProfile)
                .where(DoctorProfile.id == doctor_id)
                .values(
                    is_verified=True,
                    verified_at=datetime.now(timezone.utc),
                )
            )
            result = await session.execute(stmt)
            await session.commit()

            if result.rowcount == 0:
                logger.warning("verify_doctor: no profile found for doctor_id=%s", doctor_id)
                return False

            logger.info("Doctor verified: doctor_id=%s", doctor_id)
            return True
    except Exception as e:
        logger.error("Failed to verify doctor_id=%s: %s", doctor_id, str(e)[:200])
        return False


async def get_doctor_profile(user_id: str) -> dict | None:
    """Fetch a doctor profile by user_id. Returns None if not found."""
    try:
        async with async_session_factory() as session:
            stmt = select(DoctorProfile).where(DoctorProfile.user_id == user_id)
            result = await session.execute(stmt)
            profile = result.scalar_one_or_none()

            if profile is None:
                return None

            return {
                "id": str(profile.id),
                "user_id": profile.user_id,
                "specialty": profile.specialty,
                "license_number": profile.license_number,
                "is_verified": profile.is_verified,
                "verified_at": profile.verified_at.isoformat() if profile.verified_at else None,
                "created_at": profile.created_at.isoformat(),
            }
    except Exception as e:
        logger.error("Failed to get doctor profile for user_id=%s: %s", user_id, str(e)[:200])
        return None


async def share_result_with_patient(
    doctor_id: str, result_data: dict, patient_email: str
) -> dict:
    """Share a search result with a patient via a secure link.

    Returns dict with share_token and share_url, or an error dict.
    """
    try:
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(days=SHARE_LINK_EXPIRY_DAYS)

        async with async_session_factory() as session:
            shared = SharedResult(
                doctor_id=doctor_id,
                result_data=result_data,
                patient_email=patient_email,
                share_token=token,
                expires_at=expires_at,
            )
            session.add(shared)
            await session.commit()
            await session.refresh(shared)

            logger.info(
                "Result shared: doctor_id=%s, patient_email=%s, token=%s...",
                doctor_id,
                patient_email,
                token[:8],
            )
            return {
                "id": str(shared.id),
                "share_token": token,
                "share_url": f"{SHARE_BASE_URL}/{token}",
                "patient_email": patient_email,
                "expires_at": expires_at.isoformat(),
                "created_at": shared.created_at.isoformat(),
            }
    except Exception as e:
        logger.error(
            "Failed to share result for doctor_id=%s: %s", doctor_id, str(e)[:200]
        )
        return {"error": "Failed to share result"}


async def get_shared_result(share_token: str) -> dict | None:
    """Retrieve a shared result by token. Returns None if not found or expired."""
    try:
        async with async_session_factory() as session:
            stmt = select(SharedResult).where(SharedResult.share_token == share_token)
            result = await session.execute(stmt)
            shared = result.scalar_one_or_none()

            if shared is None:
                return None

            # Check expiration
            if shared.expires_at < datetime.now(timezone.utc):
                logger.info("Shared result expired: token=%s...", share_token[:8])
                return None

            return {
                "id": str(shared.id),
                "doctor_id": shared.doctor_id,
                "result_data": shared.result_data,
                "patient_email": shared.patient_email,
                "expires_at": shared.expires_at.isoformat(),
                "created_at": shared.created_at.isoformat(),
            }
    except Exception as e:
        logger.error("Failed to get shared result token=%s...: %s", share_token[:8], str(e)[:200])
        return None


async def create_referral(
    doctor_id: str, patient_id: str, clinic_id: str, notes: str | None = None
) -> dict:
    """Create a new referral from a doctor to a clinic for a patient."""
    try:
        async with async_session_factory() as session:
            referral = Referral(
                doctor_id=doctor_id,
                patient_id=patient_id,
                clinic_id=clinic_id,
                notes=notes,
            )
            session.add(referral)
            await session.commit()
            await session.refresh(referral)

            logger.info(
                "Referral created: doctor_id=%s, patient_id=%s, clinic_id=%s",
                doctor_id,
                patient_id,
                clinic_id,
            )
            return {
                "id": str(referral.id),
                "doctor_id": referral.doctor_id,
                "patient_id": referral.patient_id,
                "clinic_id": referral.clinic_id,
                "notes": referral.notes,
                "status": referral.status,
                "created_at": referral.created_at.isoformat(),
            }
    except Exception as e:
        logger.error(
            "Failed to create referral for doctor_id=%s: %s", doctor_id, str(e)[:200]
        )
        return {"error": "Failed to create referral"}


async def get_referrals(doctor_id: str) -> list:
    """List all referrals for a given doctor, ordered by creation date (newest first)."""
    try:
        async with async_session_factory() as session:
            stmt = (
                select(Referral)
                .where(Referral.doctor_id == doctor_id)
                .order_by(Referral.created_at.desc())
            )
            result = await session.execute(stmt)
            referrals = result.scalars().all()

            return [
                {
                    "id": str(r.id),
                    "doctor_id": r.doctor_id,
                    "patient_id": r.patient_id,
                    "clinic_id": r.clinic_id,
                    "notes": r.notes,
                    "status": r.status,
                    "created_at": r.created_at.isoformat(),
                }
                for r in referrals
            ]
    except Exception as e:
        logger.error("Failed to get referrals for doctor_id=%s: %s", doctor_id, str(e)[:200])
        return []
