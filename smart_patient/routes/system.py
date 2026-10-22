"""Application and database health endpoints."""
from flask import Blueprint, current_app, jsonify
from mysql.connector import Error
from ..database import get_db_connection

blueprint = Blueprint("system", __name__)


@blueprint.route("/api/health")
def health_check():
    return jsonify({
        "status": "ok",
        "service": "SmartHealth Backend"
    })


@blueprint.route("/api/db-check")
def database_check():
    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()

        return jsonify({
            "status": "success",
            "message": "MySQL database connected successfully"
        })

    except Error:
        current_app.logger.exception("Database connection failed")
        return jsonify({
            "status": "error",
            "message": "Database connection failed"
        }), 503

    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None and connection.is_connected():
            connection.close()
