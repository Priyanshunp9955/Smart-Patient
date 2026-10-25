"""Private account avatars stored atomically in MySQL, never in public files."""
from uuid import uuid4

from flask import Blueprint, Response, current_app, jsonify, request, session
from mysql.connector import Error
from werkzeug.exceptions import RequestEntityTooLarge

from ..database import get_db_connection
from ..validators.photo import MAX_PHOTO_BYTES, validate_photo
from .profile import verified_profile_request

blueprint = Blueprint("photos", __name__)


def photo_url(version):
    return f"/api/profile/photo?v={version}" if version else None


@blueprint.after_request
def private_photo_response(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    return response


@blueprint.errorhandler(RequestEntityTooLarge)
def photo_too_large(error):
    return jsonify(status="error", message="Profile photos must be 2 MB or smaller."), 413


@blueprint.route("/api/profile/photo", methods=["GET", "POST", "DELETE"])
def patient_photo():
    patient_id = session.get("patient_id")
    if patient_id is None:
        return jsonify(status="error", message="Please log in first."), 401
    uploading = request.method == "POST"
    changing = request.method != "GET"
    if changing and not verified_profile_request():
        return jsonify(status="error", message="Unable to verify this request. Reload your profile and try again."), 403
    if request.args.keys() - {"v"}:
        return jsonify(status="error", message="Manage photos through your own patient profile."), 400
    content = version = None
    if request.method == "DELETE":
        request.max_content_length = 1024
    if uploading:
        # Bound the complete multipart request before Flask parses/spools any files.
        request.max_content_length = MAX_PHOTO_BYTES + 64 * 1024
        request.max_form_memory_size = 128 * 1024
        request.max_form_parts = 4
        if request.mimetype != "multipart/form-data":
            return jsonify(status="error", message="Choose an image file to upload."), 400
        if set(request.files) != {"photo"} or len(request.files.getlist("photo")) != 1 or request.form:
            return jsonify(status="error", message="Submit one photo without any patient identifiers or extra fields."), 400
        try:
            content = validate_photo(request.files["photo"])
        except ValueError as error:
            return jsonify(status="error", message=str(error)), 400
        version = uuid4().hex
    elif request.method == "DELETE" and request.get_data(cache=False):
        return jsonify(status="error", message="Remove the photo through your own patient profile without extra fields."), 400

    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        if not changing:
            cursor.execute("SELECT profile_photo FROM patients WHERE id = %s", (patient_id,))
            row = cursor.fetchone()
            if row is None:
                session.clear()
                return jsonify(status="error", message="Please sign in again."), 401
            if not row["profile_photo"]:
                return jsonify(status="error", message="No profile photo uploaded."), 404
            return Response(bytes(row["profile_photo"]), mimetype="image/webp",
                            headers={"Content-Disposition": 'inline; filename="profile.webp"',
                                     "Content-Security-Policy": "default-src 'none'"})

        cursor.execute("SELECT id FROM patients WHERE id = %s FOR UPDATE", (patient_id,))
        if cursor.fetchone() is None:
            session.clear()
            return jsonify(status="error", message="Please sign in again."), 401
        cursor.execute("UPDATE patients SET profile_photo = %s, profile_photo_version = %s WHERE id = %s",
                       (content, version, patient_id))
        connection.commit()
        return jsonify(status="success", photo_url=photo_url(version),
                       message="Profile photo updated successfully." if uploading else "Profile photo removed successfully.")
    except Error:
        if connection is not None and connection.is_connected():
            connection.rollback()
        current_app.logger.exception("Patient photo request failed")
        return jsonify(status="error", message="Unable to update your profile photo. Please try again." if changing
                       else "Unable to load your profile photo."), 500
    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None and connection.is_connected():
            connection.close()
