"""Platform services facade — re-exports for Phase 5 endpoints."""

from app.services.user_service import (
    get_profile as _get_profile,
    update_profile as _update_profile,
    get_search_history as _get_history,
    save_search,
    add_bookmark as _add_bookmark,
    get_bookmarks as _get_bookmarks,
    delete_bookmark as _delete_bookmark,
)
from app.services.alert_service import (
    create_alert as _create_alert,
    get_alerts as _get_alerts,
    delete_alert as _delete_alert,
    check_new_research,
    run_daily_check,
)
from app.services.doctor_service import (
    register_doctor as _register_doctor,
    get_doctor_profile,
    verify_doctor,
    share_result_with_patient,
    get_shared_result as _get_shared_result,
    create_referral as _create_referral,
    get_referrals,
)


async def get_user_profile(user_id: str) -> dict:
    profile = await _get_profile(user_id)
    return profile or {"user_id": user_id, "display_name": "", "medical_preferences": {}, "language": "ka"}


async def update_user_profile(user_id: str, data: dict) -> dict:
    return await _update_profile(user_id, data)


async def get_search_history(user_id: str, limit: int = 20) -> list:
    return await _get_history(user_id, limit)


async def add_bookmark(user_id: str, data: dict) -> dict:
    result_id = data.get("result_id", "")
    result_data = data.get("result_data", {})
    ok = await _add_bookmark(user_id, result_id, result_data)
    return {"success": ok, "message": "სანიშნე დამატებულია" if ok else "სანიშნეს დამატება ვერ მოხერხდა"}


async def get_bookmarks(user_id: str) -> list:
    return await _get_bookmarks(user_id)


async def delete_bookmark(user_id: str, bookmark_id: str) -> dict:
    ok = await _delete_bookmark(user_id, bookmark_id)
    return {"success": ok}


async def create_alert(user_id: str, data: dict) -> dict:
    query = data.get("query", "")
    frequency = data.get("frequency", "daily")
    return await _create_alert(user_id, query, frequency)


async def get_alerts(user_id: str) -> list:
    return await _get_alerts(user_id)


async def delete_alert(user_id: str, alert_id: str) -> dict:
    ok = await _delete_alert(user_id, alert_id)
    return {"success": ok}


async def register_doctor(user_id: str, data: dict) -> dict:
    specialty = data.get("specialty", "")
    license_number = data.get("license_number", "")
    return await _register_doctor(user_id, specialty, license_number)


async def share_result(user_id: str, data: dict) -> dict:
    result_data = data.get("result_data", {})
    patient_email = data.get("patient_email", "")
    return await share_result_with_patient(user_id, result_data, patient_email)


async def get_shared_result(share_token: str) -> dict | None:
    return await _get_shared_result(share_token)


async def create_referral(user_id: str, data: dict) -> dict:
    patient_id = data.get("patient_id", "")
    clinic_id = data.get("clinic_id", "")
    notes = data.get("notes", "")
    return await _create_referral(user_id, patient_id, clinic_id, notes)
