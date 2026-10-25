"""Registration, login, current patient, and logout endpoints."""
from flask import Blueprint, current_app, jsonify, request, session
from mysql.connector import Error, IntegrityError
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.exceptions import RequestEntityTooLarge
from ..database import get_db_connection

blueprint = Blueprint("auth", __name__)


@blueprint.after_request
def prevent_account_cache(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@blueprint.route("/api/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}

    full_name = str(data.get("full_name") or "").strip()
    email = str(data.get("email") or "").strip().lower()
    password = data.get("password")

    if not full_name or not email or not isinstance(password, str):
        return jsonify({
            "status": "error",
            "message": "All fields are required"
        }), 400

    if len(full_name) > 100 or len(email) > 255 or "@" not in email:
        return jsonify({
            "status": "error",
            "message": "Invalid name or email"
        }), 400

    if len(password) < 8:
        return jsonify({
            "status": "error",
            "message": "Password must be at least 8 characters"
        }), 400

    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor()

        cursor.execute(
            """
            INSERT INTO patients (full_name, email, password_hash)
            VALUES (%s, %s, %s)
            """,
            (full_name, email, generate_password_hash(password))
        )

        connection.commit()

        return jsonify({
            "status": "success",
            "message": "Registration successful"
        }), 201

    except IntegrityError:
        return jsonify({
            "status": "error",
            "message": "Email already registered"
        }), 409

    except Error:
        current_app.logger.exception("Registration failed")
        return jsonify({
            "status": "error",
            "message": "Registration failed"
        }), 500

    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None and connection.is_connected():
            connection.close()


@blueprint.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}

    email = str(data.get("email") or "").strip().lower()
    password = data.get("password")

    if not email or not isinstance(password, str):
        return jsonify({
            "status": "error",
            "message": "Email and password required"
        }), 400

    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT id, full_name, email, password_hash
            FROM patients
            WHERE email = %s
            """,
            (email,)
        )

        patient = cursor.fetchone()

        if not patient or not check_password_hash(
            patient["password_hash"], password
        ):
            return jsonify({
                "status": "error",
                "message": "Invalid email or password"
            }), 401

        session.clear()
        session["patient_id"] = patient["id"]
        session["full_name"] = patient["full_name"]

        return jsonify({
            "status": "success",
            "message": "Login successful",
            "patient": {
                "id": patient["id"],
                "full_name": patient["full_name"],
                "email": patient["email"]
            }
        })

    except Error:
        current_app.logger.exception("Login failed")
        return jsonify({
            "status": "error",
            "message": "Login failed"
        }), 500

    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None and connection.is_connected():
            connection.close()


@blueprint.route("/api/me")
def current_patient():
    if "patient_id" not in session:
        return jsonify({
            "status": "error",
            "message": "Not logged in"
        }), 401

    connection = cursor = None
    try:
        from .photos import photo_url
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute("SELECT id, full_name, profile_photo_version FROM patients WHERE id = %s",
                       (session["patient_id"],))
        patient = cursor.fetchone()
        if patient is None:
            session.clear()
            return jsonify(status="error", message="Please sign in again."), 401
        return jsonify(status="success", patient={
            "id": patient["id"], "full_name": patient["full_name"],
            "photo_url": photo_url(patient.get("profile_photo_version"))
        })
    except Error:
        current_app.logger.exception("Account details failed to load")
        return jsonify(status="error", message="Unable to load your account. Please try again."), 500
    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None and connection.is_connected():
            connection.close()


@blueprint.errorhandler(RequestEntityTooLarge)
def account_request_too_large(error):
    return jsonify(status="error", message="Password change request is too large."), 413


@blueprint.route("/api/change-password", methods=["POST"])
def change_password():
    from .profile import verified_profile_request

    patient_id = session.get("patient_id")
    if patient_id is None:
        return jsonify(status="error", message="Please log in first."), 401
    if not verified_profile_request():
        return jsonify(status="error", message="Unable to verify this request. Reload your profile and try again."), 403

    request.max_content_length = 16 * 1024
    if not request.is_json or request.args:
        return jsonify(status="error", message="Send only your password fields as JSON."), 400
    data = request.get_json(silent=True)
    expected = {"current_password", "new_password", "confirm_password"}
    if (not isinstance(data, dict) or set(data) != expected
            or any(not isinstance(data[field], str) or not data[field] for field in expected)):
        return jsonify(status="error", message="Current password, new password, and confirmation are required."), 400
    if any(len(data[field]) > 1024 for field in expected):
        return jsonify(status="error", message="Passwords must be 1024 characters or fewer."), 400
    try:
        for field in expected:
            data[field].encode("utf-8")
    except UnicodeError:
        return jsonify(status="error", message="Passwords contain invalid text."), 400
    if len(data["new_password"]) < 8:
        return jsonify(status="error", message="New password must be at least 8 characters."), 400
    if data["new_password"] != data["confirm_password"]:
        return jsonify(status="error", message="New passwords do not match."), 400

    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        # Serialize changes so concurrent submissions cannot verify an obsolete hash.
        cursor.execute("SELECT password_hash FROM patients WHERE id = %s FOR UPDATE", (patient_id,))
        patient = cursor.fetchone()
        if patient is None:
            connection.rollback()
            session.clear()
            return jsonify(status="error", message="Your patient account is unavailable. Please sign in again."), 401
        if not check_password_hash(patient["password_hash"], data["current_password"]):
            connection.rollback()
            return jsonify(status="error", message="Current password is incorrect."), 400
        if data["new_password"] == data["current_password"]:
            connection.rollback()
            return jsonify(status="error", message="New password must differ from your current password."), 400

        cursor.execute("UPDATE patients SET password_hash = %s WHERE id = %s",
                       (generate_password_hash(data["new_password"]), patient_id))
        connection.commit()
        return jsonify(status="success", message="Password updated successfully. Use your new password the next time you sign in.")
    except Error:
        if connection is not None and connection.is_connected():
            connection.rollback()
        current_app.logger.exception("Password change failed")
        return jsonify(status="error", message="Unable to update your password. Please try again."), 500
    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None and connection.is_connected():
            connection.close()


@blueprint.route("/api/logout", methods=["POST"])
def logout():
    session.clear()

    return jsonify({
        "status": "success",
        "message": "Logout successful"
    })
