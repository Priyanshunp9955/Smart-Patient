"""Patient health reading endpoints."""
import math

from flask import Blueprint, current_app, jsonify, request, session
from mysql.connector import Error
from ..database import get_db_connection
from ..validators.readings import validate_health_reading

blueprint = Blueprint("readings", __name__)


@blueprint.after_request
def prevent_reading_cache(response):
    response.headers["Cache-Control"] = "no-store"
    return response


def numeric_measurement(value):
    """Return JSON numbers; unavailable legacy data must stay unavailable."""
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


@blueprint.route("/api/readings", methods=["POST"])
def add_health_reading():
    patient_id = session.get("patient_id")

    if patient_id is None:
        return jsonify({
            "status": "error",
            "message": "Please log in first."
        }), 401

    try:
        reading = validate_health_reading(
            request.get_json(silent=True)
        )
    except ValueError as error:
        return jsonify({
            "status": "error",
            "message": str(error)
        }), 400

    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor()

        cursor.execute(
            """
            INSERT INTO health_readings (
                patient_id,
                heart_rate,
                spo2,
                systolic,
                diastolic,
                temperature,
                measured_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                patient_id,
                reading["heart_rate"],
                reading["spo2"],
                reading["systolic"],
                reading["diastolic"],
                reading["temperature"],
                reading["measured_at"]
            )
        )

        connection.commit()
        reading_id = cursor.lastrowid

        return jsonify({
            "status": "success",
            "message": "Health reading saved successfully.",
            "reading_id": reading_id
        }), 201

    except Error:
        if connection is not None and connection.is_connected():
            connection.rollback()

        current_app.logger.exception("Failed to save health reading")

        return jsonify({
            "status": "error",
            "message": "Unable to save health reading."
        }), 500

    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None and connection.is_connected():
            connection.close()


@blueprint.route("/api/readings/<int:reading_id>", methods=["DELETE"])
def delete_health_reading(reading_id):
    patient_id = session.get("patient_id")
    if patient_id is None:
        return jsonify(status="error", message="Please log in first."), 401

    # The custom header and JSON body require a browser preflight from other
    # origins. This app does not allow cross-origin API access.
    origin = request.headers.get("Origin")
    if (request.headers.get("X-SmartHealth-Action") != "delete-reading" or
            origin not in (None, request.host_url.rstrip("/"))):
        return jsonify(status="error", message="Deletion request was not allowed."), 403

    data = request.get_json(silent=True) if request.is_json else None
    if not isinstance(data, dict) or data.get("confirmed") is not True:
        return jsonify(status="error", message="Please confirm deletion of this health reading."), 400
    if reading_id < 1:
        return jsonify(status="error", message="Health reading not found."), 404

    connection = None
    cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        # Scope the mutation itself to the session patient, never a client ID.
        cursor.execute(
            "DELETE FROM health_readings WHERE id = %s AND patient_id = %s",
            (reading_id, patient_id)
        )
        if cursor.rowcount == 0:
            connection.rollback()
            # Do not disclose whether a record belongs to another patient.
            return jsonify(status="error", message="Health reading not found."), 404
        connection.commit()
        return jsonify(
            status="success", message="Health reading deleted successfully.",
            reading_id=reading_id
        )
    except Error:
        if connection is not None and connection.is_connected():
            connection.rollback()
        current_app.logger.exception("Failed to delete health reading")
        return jsonify(status="error", message="Unable to delete health reading. Please try again."), 500
    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None and connection.is_connected():
            connection.close()


@blueprint.route("/api/readings", methods=["GET"])
def get_health_readings():
    patient_id = session.get("patient_id")

    if patient_id is None:
        return jsonify({
            "status": "error",
            "message": "Please log in first."
        }), 401

    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT
                id,
                heart_rate,
                spo2,
                systolic,
                diastolic,
                temperature,
                measured_at
            FROM health_readings
            WHERE patient_id = %s
            ORDER BY measured_at DESC, id DESC
            """,
            (patient_id,)
        )

        rows = cursor.fetchall()

        readings = []

        for row in rows:
            readings.append({
                "id": row["id"],
                **{
                    field: numeric_measurement(row[field])
                    for field in ("heart_rate", "spo2", "systolic", "diastolic", "temperature")
                },
                "measured_at": row["measured_at"].strftime(
                    "%Y-%m-%dT%H:%M"
                ) if row["measured_at"] is not None else ""
            })

        return jsonify({
            "status": "success",
            "readings": readings
        })

    except Error:
        current_app.logger.exception("Failed to fetch health readings")

        return jsonify({
            "status": "error",
            "message": "Unable to fetch health readings."
        }), 500

    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None and connection.is_connected():
            connection.close()
