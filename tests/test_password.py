"""Password verification, hashing, authorization, validation, and transactional errors."""
import os
import sqlite3
import unittest
from unittest.mock import MagicMock, patch

from mysql.connector import Error
from werkzeug.security import check_password_hash, generate_password_hash

os.environ.setdefault("FLASK_SECRET_KEY", "test-only-secret")
from backend.smart_patient import create_app


class PasswordTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.old_password = "Original Test Password 1"
        cls.old_hash = generate_password_hash(cls.old_password)

    def setUp(self):
        self.app = create_app()
        self.app.config.update(TESTING=True, SECRET_KEY="test-only-secret")
        self.app.logger.disabled = True
        self.client = self.app.test_client()
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value
        self.cursor.fetchone.return_value = {"password_hash": self.old_hash}
        self.data = {"current_password": self.old_password, "new_password": "Updated Test Password 2",
                     "confirm_password": "Updated Test Password 2"}
        self.patch = patch("backend.smart_patient.routes.auth.get_db_connection", return_value=self.connection)
        self.connect = self.patch.start()
        self.addCleanup(self.patch.stop)

    def login(self, patient_id=7):
        with self.client.session_transaction() as session:
            session.update(patient_id=patient_id, full_name="Test Patient", profile_csrf_token="password-token")

    def change(self, data=None, headers=None):
        return self.client.post("/api/change-password", json=self.data if data is None else data,
                                headers={"X-CSRF-Token": "password-token"} if headers is None else headers)

    def test_unauthorized_and_expired_session_do_not_touch_database(self):
        self.assertEqual(self.change().status_code, 401)
        self.login()
        self.client.post("/api/logout")
        self.assertEqual(self.change().status_code, 401)
        self.connect.assert_not_called()

    def test_requires_csrf_and_same_origin(self):
        self.login()
        for headers in ({}, {"X-CSRF-Token": "wrong"}, {"X-CSRF-Token": "password-token", "Origin": "null"},
                        {"X-CSRF-Token": "password-token", "Origin": "https://other.example"},
                        {"X-CSRF-Token": "password-token", "Sec-Fetch-Site": "cross-site"}):
            with self.subTest(headers=headers):
                self.assertEqual(self.change(headers=headers).status_code, 403)
        self.connect.assert_not_called()

    def test_rejects_invalid_payloads_and_identity_fields(self):
        self.login()
        for data in ([], "text", 4, {}, {**self.data, "patient_id": 8}, {**self.data, "email": "other@example.com"},
                     {**self.data, "password_hash": "attacker"}, {**self.data, "new_password": 12345678},
                     {**self.data, "current_password": ""}, {**self.data, "confirm_password": None},
                     {**self.data, "current_password": "\ud800"},
                     {**self.data, "new_password": "1234567"}, {**self.data, "confirm_password": "different"},
                     {**self.data, "new_password": "x" * 1025, "confirm_password": "x" * 1025}):
            with self.subTest(data_type=type(data).__name__):
                self.assertEqual(self.change(data).status_code, 400)
        self.assertEqual(self.client.post("/api/change-password?patient_id=8", json=self.data,
                                         headers={"X-CSRF-Token": "password-token"}).status_code, 400)
        self.assertEqual(self.client.post("/api/change-password", data='{"broken"', content_type="application/json",
                                         headers={"X-CSRF-Token": "password-token"}).status_code, 400)
        self.assertEqual(self.client.post("/api/change-password", data="text", content_type="text/plain",
                                         headers={"X-CSRF-Token": "password-token"}).status_code, 400)
        self.connect.assert_not_called()

    def test_request_size_is_bounded(self):
        self.login()
        self.assertEqual(self.change({**self.data, "new_password": "x" * 20_000}).status_code, 413)
        self.connect.assert_not_called()

    def test_wrong_current_password_returns_error_and_keeps_session(self):
        self.login()
        response = self.change({**self.data, "current_password": "Wrong Password"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json["message"], "Current password is incorrect.")
        self.connection.commit.assert_not_called()
        self.connection.rollback.assert_called_once()
        self.assertEqual(self.cursor.execute.call_count, 1)
        with self.client.session_transaction() as session:
            self.assertEqual(session["patient_id"], 7)

    def test_same_password_rejected_after_verifying_current(self):
        self.login()
        response = self.change({key: self.old_password for key in self.data})
        self.assertEqual(response.status_code, 400)
        self.assertIn("differ", response.json["message"])
        self.connection.commit.assert_not_called()
        self.connection.rollback.assert_called_once()

    def test_hash_update_is_scoped_and_response_contains_no_secrets(self):
        self.login()
        response = self.change(headers={"X-CSRF-Token": "password-token", "Origin": "http://localhost"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json), {"status", "message"})
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        select, update = self.cursor.execute.call_args_list
        self.assertEqual(select.args, ("SELECT password_hash FROM patients WHERE id = %s FOR UPDATE", (7,)))
        self.assertEqual(update.args[0], "UPDATE patients SET password_hash = %s WHERE id = %s")
        password_hash, patient_id = update.args[1]
        self.assertEqual(patient_id, 7)
        self.assertTrue(check_password_hash(password_hash, self.data["new_password"]))
        self.assertFalse(check_password_hash(password_hash, self.old_password))
        for secret in (*self.data.values(), password_hash, self.old_hash):
            self.assertNotIn(secret.encode(), response.data)
        self.connection.commit.assert_called_once()
        self.cursor.close.assert_called_once()
        self.connection.close.assert_called_once()

    def test_minimum_length_and_whitespace_are_preserved(self):
        self.login()
        new_password = " abc123 "
        self.assertEqual(len(new_password), 8)
        response = self.change({**self.data, "new_password": new_password, "confirm_password": new_password})
        self.assertEqual(response.status_code, 200)
        password_hash = self.cursor.execute.call_args.args[1][0]
        self.assertTrue(check_password_hash(password_hash, new_password))
        self.assertFalse(check_password_hash(password_hash, new_password.strip()))

    def test_missing_patient_clears_session(self):
        self.login()
        self.cursor.fetchone.return_value = None
        self.assertEqual(self.change().status_code, 401)
        with self.client.session_transaction() as session:
            self.assertNotIn("patient_id", session)
        self.connection.commit.assert_not_called()
        self.connection.rollback.assert_called_once()

    def test_database_errors_roll_back_and_hide_details(self):
        self.login()
        for operation in ("execute", "commit"):
            with self.subTest(operation=operation):
                self.connection.reset_mock()
                self.cursor.execute.side_effect = Error("sensitive SQL details") if operation == "execute" else None
                self.connection.commit.side_effect = Error("sensitive SQL details") if operation == "commit" else None
                response = self.change()
                self.assertEqual(response.status_code, 500)
                self.assertNotIn(b"sensitive", response.data)
                self.connection.rollback.assert_called_once()
                self.cursor.close.assert_called_once()
                self.connection.close.assert_called_once()
        self.connect.side_effect = Error("connection failed")
        self.assertEqual(self.change().status_code, 500)

    def test_real_sql_changes_only_own_hash_and_repeated_old_password_fails(self):
        self.login()
        database = sqlite3.connect(":memory:")
        self.addCleanup(database.close)
        database.execute("CREATE TABLE patients (id INTEGER PRIMARY KEY, password_hash TEXT, full_name TEXT, profile_photo BLOB)")
        database.executemany("INSERT INTO patients VALUES (?, ?, ?, ?)", [(7, self.old_hash, "One", b"one-photo"), (8, self.old_hash, "Two", b"two-photo")])
        database.commit()

        def execute(sql, parameters):
            result = database.execute(sql.replace("%s", "?").replace(" FOR UPDATE", ""), parameters)
            if sql.startswith("SELECT"):
                row = result.fetchone()
                self.cursor.fetchone.return_value = {"password_hash": row[0]} if row else None

        self.cursor.execute.side_effect = execute
        self.connection.commit.side_effect = database.commit
        self.connection.rollback.side_effect = database.rollback
        self.assertEqual(self.change().status_code, 200)
        self.assertEqual(self.change().status_code, 400)
        own, other = database.execute("SELECT * FROM patients ORDER BY id").fetchall()
        self.assertTrue(check_password_hash(own[1], self.data["new_password"]))
        self.assertEqual(own[2:], ("One", b"one-photo"))
        self.assertEqual(other, (8, self.old_hash, "Two", b"two-photo"))


if __name__ == "__main__":
    unittest.main()
