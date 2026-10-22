"""Registration, login, current patient, and logout endpoints."""
from flask import Blueprint, current_app, jsonify, request, session
from mysql.connector import Error, IntegrityError
from werkzeug.security import generate_password_hash, check_password_hash
from ..database import get_db_connection

blueprint = Blueprint("auth", __name__)


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

    return jsonify({
        "status": "success",
        "patient": {
            "id": session["patient_id"],
            "full_name": session.get("full_name")
        }
    })


@blueprint.route("/api/logout", methods=["POST"])
def logout():
    session.clear()

    return jsonify({
        "status": "success",
        "message": "Logout successful"
    })
