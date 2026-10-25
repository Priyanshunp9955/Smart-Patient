"""Session-scoped patient profile reads and updates."""
import secrets

from flask import Blueprint, current_app, jsonify, request, session
from mysql.connector import Error

from ..database import get_db_connection
from ..validators.profile import validate_profile

blueprint = Blueprint("profile", __name__)
PROFILE_SELECT = """SELECT id, full_name, email, phone, date_of_birth, gender, blood_group, profile_photo_version
                    FROM patients WHERE id = %s"""


@blueprint.after_request
def prevent_profile_cache(response):
    response.headers["Cache-Control"] = "no-store"
    return response


def serialize_profile(row):
    from .photos import photo_url
    # Explicit allowlist: never serialize password hashes or other private columns.
    return {
        "id": row["id"], "full_name": row["full_name"], "email": row["email"],
        "phone": row["phone"], "gender": row["gender"], "blood_group": row["blood_group"],
        "date_of_birth": row["date_of_birth"].isoformat() if row["date_of_birth"] else None,
        "photo_url": photo_url(row.get("profile_photo_version"))
    }


def verified_profile_request():
    token = session.get("profile_csrf_token")
    supplied = request.headers.get("X-CSRF-Token", "")
    origin = request.headers.get("Origin")
    return bool(token and secrets.compare_digest(supplied.encode(), token.encode())
                and (origin is None or origin == request.host_url.rstrip("/"))
                and request.headers.get("Sec-Fetch-Site") != "cross-site")


@blueprint.route("/api/profile", methods=["GET", "PUT"])
def patient_profile():
    patient_id = session.get("patient_id")
    if patient_id is None:
        return jsonify(status="error", message="Please log in first."), 401

    updating = request.method == "PUT"
    if updating:
        if not verified_profile_request():
            return jsonify(status="error", message="Unable to verify this request. Reload your profile and try again."), 403
        if not request.is_json:
            return jsonify(status="error", message="Send profile details as JSON."), 400
        try:
            profile = validate_profile(request.get_json(silent=True))
        except ValueError as error:
            return jsonify(status="error", message=str(error)), 400

    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(PROFILE_SELECT + (" FOR UPDATE" if updating else ""), (patient_id,))
        row = cursor.fetchone()
        if row is None:
            session.clear()
            return jsonify(status="error", message="Your patient account is unavailable. Please sign in again."), 401

        if updating:
            cursor.execute(
                """UPDATE patients SET full_name = %s, phone = %s, date_of_birth = %s,
                   gender = %s, blood_group = %s WHERE id = %s""",
                (profile["full_name"], profile["phone"], profile["date_of_birth"],
                 profile["gender"], profile["blood_group"], patient_id)
            )
            row.update(profile)
            connection.commit()
            session["full_name"] = profile["full_name"]
        elif "profile_csrf_token" not in session:
            session["profile_csrf_token"] = secrets.token_hex(32)

        return jsonify(
            status="success", patient=serialize_profile(row),
            csrf_token=session["profile_csrf_token"],
            message="Profile updated successfully." if updating else "Profile loaded."
        )
    except Error:
        if connection is not None and connection.is_connected():
            connection.rollback()
        current_app.logger.exception("Patient profile request failed")
        return jsonify(status="error", message="Unable to save your profile. Please try again." if updating
                       else "Unable to load your profile. Please try again."), 500
    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None and connection.is_connected():
            connection.close()
