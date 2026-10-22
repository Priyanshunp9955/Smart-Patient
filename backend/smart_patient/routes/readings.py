"""Patient health reading endpoints."""
from flask import Blueprint, current_app, jsonify, request, session
from mysql.connector import Error
from ..database import get_db_connection
from ..validators.readings import validate_health_reading

blueprint = Blueprint("readings", __name__)


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
                "heart_rate": row["heart_rate"],
                "spo2": float(row["spo2"]),
                "systolic": row["systolic"],
                "diastolic": row["diastolic"],
                "temperature": float(row["temperature"]),
                "measured_at": row["measured_at"].strftime(
                    "%Y-%m-%dT%H:%M"
                )
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
