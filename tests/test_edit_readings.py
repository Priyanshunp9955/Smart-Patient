"""Editing health readings uses isolated fixtures, never the live database."""
import os
import sqlite3
import unittest
from datetime import datetime
from decimal import Decimal
from unittest.mock import MagicMock, patch

from mysql.connector import Error

os.environ.setdefault("FLASK_SECRET_KEY", "test-only-secret")
from backend.smart_patient import create_app


class EditReadingTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app.config.update(TESTING=True, SECRET_KEY="test-only-secret")
        self.app.logger.disabled = True
        self.client = self.app.test_client()
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value
        self.cursor.fetchone.return_value = (42,)
        self.reading = dict(heart_rate=85, spo2=97.5, systolic=125,
                            diastolic=82, temperature=36.7, measured_at="2020-01-03T11:00")
        self.headers = {"X-SmartHealth-Action": "edit-reading", "Origin": "http://localhost"}
        self.connect = patch("backend.smart_patient.routes.readings.get_db_connection",
                             return_value=self.connection).start()
        self.addCleanup(patch.stopall)

    def login(self, patient_id=7):
        with self.client.session_transaction() as session:
            session["patient_id"] = patient_id

    def put(self, **options):
        return self.client.put("/api/readings/42", json=self.reading,
                               headers=self.headers, **options)

    def test_requires_session_and_same_origin_json_action(self):
        self.assertEqual(self.put().status_code, 401)
        self.login()
        self.assertEqual(self.client.put("/api/readings/42", json=self.reading).status_code, 403)
        for origin in ("https://other.example", "null"):
            response = self.client.put("/api/readings/42", json=self.reading,
                                       headers={**self.headers, "Origin": origin})
            self.assertEqual(response.status_code, 403)
        response = self.client.put("/api/readings/42", data="not json", headers=self.headers)
        self.assertEqual(response.status_code, 400)
        self.connect.assert_not_called()

    def test_rejects_invalid_values_and_identity_fields_before_database_access(self):
        self.login()
        invalid = [None, [], {}, {**self.reading, "patient_id": 8},
                   {**self.reading, "id": 99}]
        invalid += [{**self.reading, key: value} for key, value in (
            ("heart_rate", 19), ("heart_rate", 85.5), ("heart_rate", True),
            ("systolic", 100.5), ("diastolic", 201), ("systolic", 80),
            ("spo2", "NaN"), ("spo2", 101), ("temperature", "Infinity"),
            ("temperature", 46), ("measured_at", "2999-01-01T00:00"),
            ("measured_at", "invalid"))]
        for data in invalid:
            with self.subTest(data=data):
                response = self.client.put("/api/readings/42", json=data, headers=self.headers)
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.put(query_string={"patient_id": 8}).status_code, 400)
        self.assertEqual(self.client.put("/api/readings/0", json=self.reading,
                                         headers=self.headers).status_code, 404)
        self.connect.assert_not_called()

    def test_update_preserves_id_and_accepts_unchanged_measurements(self):
        self.login()
        # MySQL reports zero affected rows when all values are unchanged.
        self.cursor.rowcount = 0
        response = self.put()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["reading_id"], 42)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        sql, values = self.cursor.execute.call_args.args
        self.assertIn("WHERE id = %s AND patient_id = %s", sql)
        self.assertEqual(values[:5], (85, Decimal("97.5"), 125, 82, Decimal("36.7")))
        self.assertEqual(values[-2:], (42, 7))
        self.connection.commit.assert_called_once()
        self.cursor.close.assert_called_once()
        self.connection.close.assert_called_once()

    def test_missing_or_other_patient_record_returns_same_404(self):
        self.login()
        self.cursor.fetchone.return_value = None
        response = self.put()
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json["message"], "Health reading not found.")
        self.assertEqual(self.cursor.execute.call_count, 1)
        self.connection.commit.assert_not_called()
        self.connection.rollback.assert_called_once()

    def test_actual_sql_preserves_other_patients_records_and_row_identity(self):
        self.login()
        database = sqlite3.connect(":memory:")
        self.addCleanup(database.close)
        database.execute("""CREATE TABLE health_readings (
            id INTEGER PRIMARY KEY, patient_id INTEGER, heart_rate INTEGER,
            spo2 REAL, systolic INTEGER, diastolic INTEGER,
            temperature REAL, measured_at TEXT)""")
        database.executemany("INSERT INTO health_readings VALUES (?, ?, 72, 98, 120, 80, 36.5, '2020-01-02T10:30')",
                             [(42, 8), (43, 7)])
        database.commit()

        def execute(sql, values):
            # SQLite lacks FOR UPDATE; exercise the same ownership predicates.
            values = tuple(value.isoformat() if isinstance(value, datetime) else
                           str(value) if isinstance(value, Decimal) else value for value in values)
            result = database.execute(sql.replace("%s", "?").replace(" FOR UPDATE", ""), values)
            self.cursor.fetchone.return_value = result.fetchone()

        self.cursor.execute.side_effect = execute
        self.connection.commit.side_effect = database.commit
        self.connection.rollback.side_effect = database.rollback
        self.assertEqual(self.put().status_code, 404)
        allowed = self.client.put("/api/readings/43", json=self.reading, headers=self.headers)
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(database.execute("SELECT id, patient_id, heart_rate FROM health_readings ORDER BY id").fetchall(),
                         [(42, 8, 72), (43, 7, 85)])
        self.assertEqual(database.execute("SELECT spo2, systolic, diastolic, temperature FROM health_readings WHERE id = 43").fetchone(),
                         (97.5, 125, 82, 36.7))
        # A fresh session reads back the same saved row without inserting one.
        self.login()
        self.assertEqual(self.client.put("/api/readings/43", json=self.reading,
                                         headers=self.headers).status_code, 200)
        self.assertEqual(database.execute("SELECT COUNT(*) FROM health_readings").fetchone()[0], 2)

    def test_database_errors_roll_back_and_release_resources(self):
        self.login()
        for operation in ("execute", "commit"):
            with self.subTest(operation=operation):
                self.connection.reset_mock()
                self.cursor.execute.side_effect = Error("failed") if operation == "execute" else None
                self.connection.commit.side_effect = Error("failed") if operation == "commit" else None
                self.assertEqual(self.put().status_code, 500)
                self.connection.rollback.assert_called_once()
                self.cursor.close.assert_called_once()
                self.connection.close.assert_called_once()

    def test_database_connection_error_returns_retryable_message(self):
        self.login()
        self.connect.side_effect = Error("offline")
        response = self.put()
        self.assertEqual(response.status_code, 500)
        self.assertIn("Please try again", response.json["message"])


if __name__ == "__main__":
    unittest.main()
