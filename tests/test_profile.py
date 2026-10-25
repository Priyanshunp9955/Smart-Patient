"""Profile authorization, validation, SQL isolation, failures, and migration checks."""
import os
import sqlite3
import unittest
from datetime import date
from unittest.mock import MagicMock, patch

import click
from mysql.connector import Error

os.environ.setdefault("FLASK_SECRET_KEY", "test-only-secret")

from backend.smart_patient import create_app
from backend.smart_patient.migrations import PROFILE_COLUMNS, migrate_patient_profile
from backend.smart_patient.validators.profile import validate_profile


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app.config.update(TESTING=True, SECRET_KEY="test-only-secret")
        self.app.logger.disabled = True
        self.client = self.app.test_client()
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value
        self.row = {"id": 7, "full_name": "Patient One", "email": "one@example.com",
                    "phone": None, "date_of_birth": date(2000, 2, 29), "gender": None,
                    "blood_group": None, "password_hash": "never-expose"}
        self.cursor.fetchone.return_value = self.row.copy()
        self.data = {"full_name": " Updated Patient ", "phone": "+91 98765 43210",
                     "date_of_birth": "2000-02-29", "gender": "Female", "blood_group": "AB+"}
        self.patch = patch("backend.smart_patient.routes.profile.get_db_connection", return_value=self.connection)
        self.connect = self.patch.start()
        self.addCleanup(self.patch.stop)

    def login(self, patient_id=7):
        with self.client.session_transaction() as session:
            session["patient_id"] = patient_id
            session["full_name"] = "Patient One"
            session["profile_csrf_token"] = "test-profile-csrf-token"

    def put(self, data=None, **kwargs):
        return self.client.put("/api/profile", json=self.data if data is None else data,
                               headers={"X-CSRF-Token": "test-profile-csrf-token", **kwargs})

    def test_requires_session_for_read_and_write_and_page(self):
        self.assertEqual(self.client.get("/api/profile").status_code, 401)
        self.assertEqual(self.put().status_code, 401)
        self.connect.assert_not_called()
        response = self.client.get("/profile.html")
        self.assertIn(b"Login | SmartHealth", response.data)
        response.close()
        self.login()
        response = self.client.get("/profile.html")
        self.assertIn(b"My Profile | SmartHealth", response.data)
        response.close()

    def test_get_returns_only_safe_fields_and_iso_date_and_csrf(self):
        self.login()
        with self.client.session_transaction() as session:
            session.pop("profile_csrf_token")
        response = self.client.get("/api/profile")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json["patient"]), {"id", "email", "photo_url", *self.data})
        self.assertEqual(response.json["patient"]["date_of_birth"], "2000-02-29")
        self.assertIsNone(response.json["patient"]["phone"])
        self.assertNotIn(b"password", response.data)
        self.assertNotIn(b"never-expose", response.data)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(len(response.json["csrf_token"]), 64)
        sql, parameters = self.cursor.execute.call_args.args
        self.assertIn("WHERE id = %s", sql)
        self.assertNotIn("password", sql)
        self.assertEqual(parameters, (7,))
        self.cursor.close.assert_called_once()
        self.connection.close.assert_called_once()

    def test_update_commits_and_updates_dashboard_session(self):
        self.login()
        response = self.put(Origin="http://localhost")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["patient"]["full_name"], "Updated Patient")
        self.assertEqual(response.json["patient"]["email"], "one@example.com")
        sql, parameters = self.cursor.execute.call_args.args
        self.assertIn("UPDATE patients", sql)
        self.assertIn("WHERE id = %s", sql)
        self.assertNotIn("email", sql)
        self.assertNotIn("password", sql)
        self.assertEqual(parameters, ("Updated Patient", "+91 98765 43210", date(2000, 2, 29), "Female", "AB+", 7))
        self.connection.commit.assert_called_once()
        with self.client.session_transaction() as session:
            self.assertEqual(session["full_name"], "Updated Patient")

    def test_session_patient_scopes_both_operations(self):
        for patient_id in (7, 8):
            with self.subTest(patient_id=patient_id):
                self.login(patient_id)
                self.cursor.reset_mock()
                self.cursor.fetchone.return_value = {**self.row, "id": patient_id}
                self.assertEqual(self.put().status_code, 200)
                calls = self.cursor.execute.call_args_list
                self.assertEqual(calls[0].args[1], (patient_id,))
                self.assertEqual(calls[1].args[1][-1], patient_id)

    def test_readonly_and_unknown_fields_are_rejected(self):
        self.login()
        for field, value in (("email", "attacker@example.com"), ("patient_id", 8), ("id", 8),
                             ("password", "unsafe"), ("password_hash", "unsafe")):
            with self.subTest(field=field):
                self.assertEqual(self.put({**self.data, field: value}).status_code, 400)
        self.connect.assert_not_called()

    def test_csrf_origin_and_content_type_protection(self):
        self.login()
        for headers in ({}, {"X-CSRF-Token": "wrong"}, {"X-CSRF-Token": "test-profile-csrf-token", "Origin": "null"},
                        {"X-CSRF-Token": "test-profile-csrf-token", "Origin": "https://other.example"},
                        {"X-CSRF-Token": "test-profile-csrf-token", "Sec-Fetch-Site": "cross-site"}):
            with self.subTest(headers=headers):
                self.assertEqual(self.client.put("/api/profile", json=self.data, headers=headers).status_code, 403)
        response = self.client.put("/api/profile", data='{}', content_type="text/plain",
                                   headers={"X-CSRF-Token": "test-profile-csrf-token"})
        self.assertEqual(response.status_code, 400)
        self.connect.assert_not_called()

    def test_invalid_payloads_and_fields_do_not_touch_database(self):
        self.login()
        for payload in ([], {}, "text", 4, False):
            self.assertEqual(self.put(payload).status_code, 400)
        for field, value in (("full_name", "  "), ("full_name", "x" * 101), ("full_name", "Hello\x00world"),
                             ("full_name", []), ("phone", 12345678), ("phone", "123"), ("phone", "+1234567890123456"),
                             ("phone", "abc1234567"), ("phone", "1234567<script>"), ("date_of_birth", "2001-02-29"),
                             ("date_of_birth", "2999-01-01"), ("date_of_birth", "1899-01-01"), ("date_of_birth", "20000101"),
                             ("gender", "invalid"), ("blood_group", "C+"), ("blood_group", {})):
            with self.subTest(field=field, value=value):
                self.assertEqual(self.put({**self.data, field: value}).status_code, 400)
        self.connect.assert_not_called()

    def test_optional_fields_clear_and_unicode_name(self):
        for empty in (None, "", "   "):
            with self.subTest(empty=empty):
                data = {key: empty for key in self.data}
                data["full_name"] = "Zoë कुमार O'Neil"
                validated = validate_profile(data)
                self.assertEqual(validated["full_name"], data["full_name"])
                for field in ("phone", "date_of_birth", "gender", "blood_group"):
                    self.assertIsNone(validated[field])

    def test_missing_patient_clears_session_and_does_not_write(self):
        self.login()
        self.cursor.fetchone.return_value = None
        self.assertEqual(self.put().status_code, 401)
        self.connection.commit.assert_not_called()
        self.assertEqual(self.client.get("/api/me").status_code, 401)
        self.assertEqual(self.cursor.execute.call_count, 1)

    def test_errors_roll_back_without_changing_session_or_exposing_sql(self):
        self.login()
        for operation in ("execute", "commit"):
            with self.subTest(operation=operation):
                self.connection.reset_mock()
                self.cursor.execute.side_effect = Error("secret SQL details") if operation == "execute" else None
                self.connection.commit.side_effect = Error("secret SQL details") if operation == "commit" else None
                response = self.put()
                self.assertEqual(response.status_code, 500)
                self.assertNotIn(b"secret", response.data)
                self.connection.rollback.assert_called_once()
                with self.client.session_transaction() as session:
                    self.assertEqual(session["full_name"], "Patient One")
                self.cursor.close.assert_called_once()
                self.connection.close.assert_called_once()

    def test_connection_failure_is_clear_and_retryable(self):
        self.login()
        self.connect.side_effect = Error("offline")
        self.assertEqual(self.client.get("/api/profile").status_code, 500)
        self.assertEqual(self.put().status_code, 500)

    def test_real_sql_updates_only_owner_and_preserves_email_and_hash(self):
        database = sqlite3.connect(":memory:")
        self.addCleanup(database.close)
        database.row_factory = sqlite3.Row
        database.execute("""CREATE TABLE patients (id INTEGER PRIMARY KEY, full_name TEXT, email TEXT,
                            password_hash TEXT, phone TEXT, date_of_birth DATE, gender TEXT, blood_group TEXT,
                            profile_photo_version TEXT)""")
        database.executemany("INSERT INTO patients VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)", [
            (7, "Patient One", "one@example.com", "hash-one"), (8, "Patient Two", "two@example.com", "hash-two")])
        database.commit()

        def execute(sql, parameters):
            result = database.execute(sql.replace("%s", "?").replace(" FOR UPDATE", ""), parameters)
            if sql.startswith("SELECT"):
                self.cursor.fetchone.return_value = dict(result.fetchone())

        self.cursor.execute.side_effect = execute
        self.connection.commit.side_effect = database.commit
        self.connection.rollback.side_effect = database.rollback
        self.login()
        injection = "Robert'); UPDATE patients SET full_name='changed'; --"
        self.assertEqual(self.put({**self.data, "full_name": injection, "date_of_birth": ""}).status_code, 200)
        rows = database.execute("SELECT id, full_name, email, password_hash FROM patients ORDER BY id").fetchall()
        self.assertEqual(tuple(rows[0]), (7, injection, "one@example.com", "hash-one"))
        self.assertEqual(tuple(rows[1]), (8, "Patient Two", "two@example.com", "hash-two"))


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value
        self.cursor.fetchone.return_value = (1,)
        self.base = {"id", "full_name", "email", "password_hash", "created_at"}

    def test_adds_only_missing_nullable_columns_without_touching_data(self):
        self.cursor.fetchall.return_value = [(column,) for column in self.base | {"phone"}]
        self.assertEqual(migrate_patient_profile(self.connection), ["date_of_birth", "gender", "blood_group", "profile_photo", "profile_photo_version"])
        sql = self.cursor.execute.call_args_list[2].args[0]
        self.assertIn("ALTER TABLE patients ADD COLUMN", sql)
        self.assertNotIn("`phone`", sql)
        self.assertEqual(sql.count("NULL DEFAULT NULL"), 5)
        for unsafe in ("DROP", "DELETE", "TRUNCATE", "UPDATE", "MODIFY"):
            self.assertNotIn(unsafe, sql)
        self.cursor.close.assert_called_once()

    def test_rerun_is_noop_and_releases_lock(self):
        self.cursor.fetchall.return_value = [(column,) for column in self.base | set(PROFILE_COLUMNS)]
        self.assertEqual(migrate_patient_profile(self.connection), [])
        self.assertEqual(self.cursor.execute.call_count, 3)
        self.assertIn("RELEASE_LOCK", self.cursor.execute.call_args.args[0])

    def test_missing_base_table_and_lock_failure_make_no_schema_changes(self):
        self.cursor.fetchall.return_value = []
        with self.assertRaises(click.ClickException):
            migrate_patient_profile(self.connection)
        self.cursor.reset_mock()
        self.cursor.fetchone.return_value = (0,)
        with self.assertRaises(click.ClickException):
            migrate_patient_profile(self.connection)
        self.assertEqual(self.cursor.execute.call_count, 1)


if __name__ == "__main__":
    unittest.main()
