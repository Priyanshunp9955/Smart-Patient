"""Regression coverage for routes, sessions, assets, and database interactions."""

import os
import sqlite3
import unittest
from datetime import datetime
from decimal import Decimal
from html.parser import HTMLParser
from unittest.mock import MagicMock, patch
from urllib.parse import urlsplit

from mysql.connector import Error, IntegrityError
from werkzeug.security import generate_password_hash

# Tests never require real credentials or an active MySQL server.
os.environ.setdefault("FLASK_SECRET_KEY", "test-only-secret")

from backend.smart_patient import create_app
from backend.smart_patient.config import ASSETS_DIR, PAGES_DIR
from backend.smart_patient.validators.readings import validate_health_reading


class PageLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in {"href", "src"} and value:
                self.links.append(value)


class ApplicationTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app.config.update(TESTING=True, SECRET_KEY="test-only-secret")
        self.app.logger.disabled = True
        self.client = self.app.test_client()
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value
        self.cursor.lastrowid = 42
        self.reading = {
            "heart_rate": 72, "spo2": 98, "systolic": 120,
            "diastolic": 80, "temperature": 36.5,
            "measured_at": "2020-01-02T10:30"
        }

    def page_bytes(self, path):
        with self.client.get(path) as response:
            self.assertEqual(response.status_code, 200)
            return response.data

    def login_session(self):
        with self.client.session_transaction() as session:
            session["patient_id"] = 7
            session["full_name"] = "Test Patient"

    def database(self, module, error=None):
        return patch(
            f"backend.smart_patient.routes.{module}.get_db_connection",
            return_value=self.connection,
            side_effect=error
        )

    def assert_closed(self):
        self.cursor.close.assert_called_once()
        self.connection.close.assert_called_once()

    def test_public_and_protected_pages(self):
        login_content = (PAGES_DIR / "login.html").read_bytes()
        for name in ("index.html", "login.html", "register.html"):
            with self.subTest(page=name):
                self.assertEqual(self.page_bytes("/" + name), (PAGES_DIR / name).read_bytes())
        self.assertEqual(self.page_bytes("/"), (PAGES_DIR / "index.html").read_bytes())
        for name in ("dashboard.html", "add-reading.html", "health-records.html", "health-trends.html", "health-alerts.html", "consultation.html", "profile.html"):
            with self.subTest(page=name, authenticated=False):
                self.assertEqual(self.page_bytes("/" + name), login_content)
        self.login_session()
        for name in ("dashboard.html", "add-reading.html", "health-records.html", "health-trends.html", "health-alerts.html", "consultation.html", "profile.html"):
            with self.subTest(page=name, authenticated=True):
                response = self.client.get("/" + name)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data, (PAGES_DIR / name).read_bytes())
                response.close()

    def test_every_local_page_reference_resolves(self):
        self.login_session()
        for page in PAGES_DIR.glob("*.html"):
            parser = PageLinks()
            parser.feed(page.read_text(encoding="utf-8"))
            for link in parser.links:
                url = urlsplit(link)
                if url.scheme or url.netloc or not url.path:
                    continue
                with self.subTest(page=page.name, link=link):
                    response = self.client.get("/" + url.path.lstrip("/"))
                    self.assertEqual(response.status_code, 200)
                    response.close()

    def test_root_entry_point_uses_the_same_protected_pages(self):
        from app import app as root_app

        root_app.config.update(TESTING=True, SECRET_KEY="test-only-secret")
        client = root_app.test_client()
        for filename in ("health-records.html", "health-trends.html", "health-alerts.html"):
            response = client.get("/" + filename)
            self.assertEqual(response.data, (PAGES_DIR / "login.html").read_bytes())
            response.close()
        with client.session_transaction() as session:
            session["patient_id"] = 7
        for filename in ("health-records.html", "health-trends.html", "health-alerts.html"):
            response = client.get("/" + filename)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data, (PAGES_DIR / filename).read_bytes())
            response.close()

    def test_asset_bytes_and_legacy_urls(self):
        for directory, aliases in (("css", ("CSS", "css")), ("js", ("JS", "js"))):
            for asset in (ASSETS_DIR / directory).iterdir():
                paths = [f"/assets/{directory}/{asset.name}"]
                paths += [f"/{alias}/{asset.name}" for alias in aliases]
                for path in paths:
                    with self.subTest(path=path):
                        response = self.client.get(path)
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(response.data, asset.read_bytes())
                        self.assertIn("css" if directory == "css" else "javascript", response.content_type)
                        response.close()
        response = self.client.get("/assets/css/style.css")
        with self.client.get("/assets/css/style.css", headers={"If-None-Match": response.headers["ETag"]}) as cached:
            self.assertEqual(cached.status_code, 304)
        response.close()

    def test_unknown_files_and_private_paths_are_not_served(self):
        for path in ("/missing.html", "/backend/.env", "/backend/app.py", "/assets/../../backend/.env", "/CSS/../../backend/.env", "/frontend/pages/dashboard.html"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)

    def test_health_and_database_health(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.json, {"status": "ok", "service": "SmartHealth Backend"})
        with self.database("system"):
            self.assertEqual(self.client.get("/api/db-check").status_code, 200)
        self.cursor.execute.assert_called_once_with("SELECT 1")
        self.assert_closed()
        with self.database("system", Error("offline")):
            self.assertEqual(self.client.get("/api/db-check").status_code, 503)

    def test_registration_validation_and_success(self):
        with self.database("auth") as connect:
            for data in ({}, {"full_name": "Test", "email": "invalid", "password": "password1"}, {"full_name": "Test", "email": "test@example.com", "password": "short"}):
                self.assertEqual(self.client.post("/api/register", json=data).status_code, 400)
            connect.assert_not_called()
            response = self.client.post("/api/register", json={"full_name": " Test Patient ", "email": " TEST@EXAMPLE.COM ", "password": "password1"})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.cursor.execute.call_args.args[1][:2], ("Test Patient", "test@example.com"))
        self.connection.commit.assert_called_once()
        self.assert_closed()

    def test_registration_errors(self):
        for error, status in ((IntegrityError("duplicate"), 409), (Error("offline"), 500)):
            with self.subTest(status=status), self.database("auth", error):
                response = self.client.post("/api/register", json={"full_name": "Test", "email": "test@example.com", "password": "password1"})
                self.assertEqual(response.status_code, status)

    def test_login_session_current_patient_and_logout(self):
        self.assertEqual(self.client.get("/api/me").status_code, 401)
        self.assertEqual(self.client.post("/api/login", json={}).status_code, 400)
        self.cursor.fetchone.return_value = {
            "id": 7, "full_name": "Test Patient", "email": "test@example.com",
            "password_hash": generate_password_hash("password1")
        }
        with self.database("auth"):
            response = self.client.post("/api/login", json={"email": " TEST@EXAMPLE.COM ", "password": "password1"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.cursor.execute.call_args.args[1], ("test@example.com",))
        with self.database("auth"):
            self.assertEqual(self.client.get("/api/me").json["patient"], {"id": 7, "full_name": "Test Patient", "photo_url": None})
        self.assertIn("HttpOnly", response.headers["Set-Cookie"])
        self.assertIn("SameSite=Lax", response.headers["Set-Cookie"])
        self.assertEqual(self.client.post("/api/logout").json["status"], "success")
        self.assertEqual(self.client.get("/api/me").status_code, 401)
        self.assertEqual(self.cursor.close.call_count, 2)
        self.assertEqual(self.connection.close.call_count, 2)

    def test_account_name_tracks_the_current_login(self):
        with self.database("auth"):
            for patient_id, full_name in ((7, "Priya Sharma"), (8, "Aarav Kumar"), (9, "Zo\u00eb <Patient>")):
                self.cursor.fetchone.return_value = {
                    "id": patient_id, "full_name": full_name,
                    "email": "test@example.com",
                    "password_hash": generate_password_hash("password1")
                }
                response = self.client.post("/api/login", json={"email": "test@example.com", "password": "password1"})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(self.client.get("/api/me").json["patient"], {"id": patient_id, "full_name": full_name, "photo_url": None})
                self.assertEqual(self.client.post("/api/logout").status_code, 200)
                self.assertEqual(self.client.get("/api/me").status_code, 401)
                self.assertEqual(self.page_bytes("/dashboard.html"), (PAGES_DIR / "login.html").read_bytes())

    def test_login_invalid_credentials_and_database_error(self):
        self.cursor.fetchone.return_value = None
        with self.database("auth"):
            self.assertEqual(self.client.post("/api/login", json={"email": "test@example.com", "password": "bad"}).status_code, 401)
        with self.database("auth", Error("offline")):
            self.assertEqual(self.client.post("/api/login", json={"email": "test@example.com", "password": "password1"}).status_code, 500)

    def test_readings_require_login(self):
        with self.database("readings") as connect:
            self.assertEqual(self.client.get("/api/readings").status_code, 401)
            self.assertEqual(self.client.post("/api/readings", json=self.reading).status_code, 401)
            connect.assert_not_called()

    def test_save_reading_and_validation(self):
        self.login_session()
        with self.database("readings") as connect:
            self.assertEqual(self.client.post("/api/readings", json={}).status_code, 400)
            connect.assert_not_called()
            response = self.client.post("/api/readings", json=self.reading)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json["reading_id"], 42)
        values = self.cursor.execute.call_args.args[1]
        self.assertEqual(values, (7, 72, Decimal("98"), 120, 80, Decimal("36.5"), datetime(2020, 1, 2, 10, 30)))
        self.connection.commit.assert_called_once()
        self.assert_closed()

    def test_reading_serialization_and_patient_filter(self):
        self.login_session()
        self.cursor.fetchall.return_value = [{"id": 42, **self.reading, "spo2": Decimal("98"), "temperature": Decimal("36.5"), "measured_at": datetime(2020, 1, 2, 10, 30)}]
        with self.database("readings"):
            response = self.client.get("/api/readings")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["readings"], [{"id": 42, **self.reading}])
        self.assertEqual(self.cursor.execute.call_args.args[1], (7,))
        self.assertIn("ORDER BY measured_at DESC, id DESC", self.cursor.execute.call_args.args[0])
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assert_closed()

    def test_reading_numeric_serialization_and_unavailable_legacy_values(self):
        self.login_session()
        self.cursor.fetchall.return_value = [
            {"id": 42, **self.reading, "heart_rate": Decimal("120"), "spo2": Decimal("94.50"),
             "measured_at": datetime(2020, 1, 2, 10, 30)},
            {"id": 43, **self.reading, "heart_rate": None, "spo2": None,
             "systolic": None, "diastolic": None, "temperature": None, "measured_at": None},
            {"id": 44, **self.reading, "heart_rate": "120", "spo2": "NaN",
             "temperature": "Infinity", "measured_at": datetime(2020, 1, 1, 10, 30)}
        ]
        with self.database("readings"):
            response = self.client.get("/api/readings")
        self.assertEqual(response.status_code, 200)
        first, missing, invalid = response.json["readings"]
        self.assertEqual(first["heart_rate"], 120)
        self.assertEqual(first["spo2"], 94.5)
        for field in ("heart_rate", "spo2", "systolic", "diastolic", "temperature"):
            self.assertIsNone(missing[field])
        self.assertEqual(missing["measured_at"], "")
        self.assertEqual(invalid["heart_rate"], 120)
        self.assertIsNone(invalid["spo2"])
        self.assertIsNone(invalid["temperature"])
        self.assert_closed()

    def test_readings_are_scoped_to_each_logged_in_patient(self):
        for patient_id in (7, 8):
            with self.subTest(patient_id=patient_id):
                with self.client.session_transaction() as session:
                    session["patient_id"] = patient_id
                self.cursor.fetchall.return_value = []
                with self.database("readings"):
                    response = self.client.get("/api/readings")
                sql, parameters = self.cursor.execute.call_args.args
                self.assertIn("WHERE patient_id = %s", sql)
                self.assertEqual(parameters, (patient_id,))
                self.assertEqual(response.json["readings"], [])

    def test_reading_database_errors_and_rollback(self):
        self.login_session()
        with self.database("readings", Error("offline")):
            self.assertEqual(self.client.get("/api/readings").status_code, 500)
        self.cursor.execute.side_effect = Error("write failed")
        with self.database("readings"):
            self.assertEqual(self.client.post("/api/readings", json=self.reading).status_code, 500)
        self.connection.rollback.assert_called_once()
        self.assert_closed()

    def test_delete_requires_login(self):
        with self.database("readings") as connect:
            response = self.client.delete("/api/readings/42", json={"confirmed": True},
                                          headers={"X-SmartHealth-Action": "delete-reading"})
        self.assertEqual(response.status_code, 401)
        connect.assert_not_called()

    def test_delete_requires_explicit_confirmation_and_same_origin_request(self):
        self.login_session()
        headers = {"X-SmartHealth-Action": "delete-reading"}
        with self.database("readings") as connect:
            for data in ({}, {"confirmed": False}, {"confirmed": "true"}, [], None):
                with self.subTest(data=data):
                    response = self.client.delete("/api/readings/42", json=data, headers=headers)
                    self.assertEqual(response.status_code, 400)
            self.assertEqual(self.client.delete("/api/readings/42", json={"confirmed": True}).status_code, 403)
            for origin in ("https://untrusted.example", "null"):
                response = self.client.delete("/api/readings/42", json={"confirmed": True},
                                              headers={**headers, "Origin": origin})
                self.assertEqual(response.status_code, 403)
            response = self.client.delete("/api/readings/42", data='{"confirmed": true}',
                                          content_type="text/plain", headers=headers)
            self.assertEqual(response.status_code, 400)
            connect.assert_not_called()

    def test_delete_scopes_sql_to_session_patient_and_commits(self):
        self.login_session()
        self.cursor.rowcount = 1
        with self.database("readings"):
            response = self.client.delete("/api/readings/42", json={"confirmed": True, "patient_id": 8},
                                          headers={"X-SmartHealth-Action": "delete-reading", "Origin": "http://localhost"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {"status": "success", "message": "Health reading deleted successfully.", "reading_id": 42})
        self.cursor.execute.assert_called_once_with(
            "DELETE FROM health_readings WHERE id = %s AND patient_id = %s", (42, 7))
        self.connection.commit.assert_called_once()
        self.connection.rollback.assert_not_called()
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assert_closed()

    def test_delete_missing_or_other_patient_reading_returns_not_found(self):
        self.login_session()
        self.cursor.rowcount = 0
        with self.database("readings"):
            response = self.client.delete("/api/readings/42", json={"confirmed": True},
                                          headers={"X-SmartHealth-Action": "delete-reading"})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json["message"], "Health reading not found.")
        self.cursor.execute.assert_called_once_with(
            "DELETE FROM health_readings WHERE id = %s AND patient_id = %s", (42, 7))
        self.connection.commit.assert_not_called()
        self.connection.rollback.assert_called_once()
        self.assert_closed()

    def test_delete_invalid_record_ids_and_wrong_methods_do_not_touch_database(self):
        self.login_session()
        with self.database("readings") as connect:
            for reading_id in ("0", "-1", "invalid", "42 OR 1=1"):
                with self.subTest(reading_id=reading_id):
                    response = self.client.delete(f"/api/readings/{reading_id}", json={"confirmed": True},
                                                  headers={"X-SmartHealth-Action": "delete-reading"})
                    self.assertIn(response.status_code, (404, 405))
            # The existing frontend catch-all handles unknown GET paths.
            self.assertEqual(self.client.get("/api/readings/42").status_code, 404)
            self.assertEqual(self.client.post("/api/readings/42").status_code, 405)
            connect.assert_not_called()

    def test_delete_query_cannot_remove_another_patients_record(self):
        self.login_session()
        # Execute the real parameterized DELETE against an isolated SQL table.
        # No real patient database is used or modified.
        database = sqlite3.connect(":memory:")
        self.addCleanup(database.close)
        database.execute("CREATE TABLE health_readings (id INTEGER PRIMARY KEY, patient_id INTEGER)")
        database.executemany("INSERT INTO health_readings VALUES (?, ?)", [(42, 8), (43, 7)])
        database.commit()

        def execute(sql, parameters):
            cursor = database.execute(sql.replace("%s", "?"), parameters)
            self.cursor.rowcount = cursor.rowcount

        self.cursor.execute.side_effect = execute
        self.connection.commit.side_effect = database.commit
        self.connection.rollback.side_effect = database.rollback
        with self.database("readings"):
            headers = {"X-SmartHealth-Action": "delete-reading"}
            forbidden = self.client.delete("/api/readings/42", json={"confirmed": True, "patient_id": 8}, headers=headers)
            self.assertEqual(forbidden.status_code, 404)
            self.assertEqual(database.execute("SELECT COUNT(*) FROM health_readings").fetchone()[0], 2)
            allowed = self.client.delete("/api/readings/43", json={"confirmed": True}, headers=headers)
            self.assertEqual(allowed.status_code, 200)
            self.assertEqual(database.execute("SELECT id FROM health_readings").fetchall(), [(42,)])
            repeated = self.client.delete("/api/readings/43", json={"confirmed": True}, headers=headers)
            self.assertEqual(repeated.status_code, 404)
            self.assertEqual(database.execute("SELECT id FROM health_readings").fetchall(), [(42,)])

    def test_delete_database_connection_failure(self):
        self.login_session()
        with self.database("readings", Error("offline")):
            response = self.client.delete("/api/readings/42", json={"confirmed": True},
                                          headers={"X-SmartHealth-Action": "delete-reading"})
        self.assertEqual(response.status_code, 500)
        self.assertIn("Unable to delete", response.json["message"])

    def test_delete_database_failure_rolls_back_and_closes(self):
        self.login_session()
        for operation in ("execute", "commit"):
            with self.subTest(operation=operation):
                self.connection.reset_mock()
                self.cursor.rowcount = 1
                self.cursor.execute.side_effect = Error("failed") if operation == "execute" else None
                self.connection.commit.side_effect = Error("failed") if operation == "commit" else None
                with self.database("readings"):
                    response = self.client.delete("/api/readings/42", json={"confirmed": True},
                                                  headers={"X-SmartHealth-Action": "delete-reading"})
                self.assertEqual(response.status_code, 500)
                self.connection.rollback.assert_called_once()
                self.assert_closed()

    def test_validation_rules(self):
        validated = validate_health_reading(self.reading)
        self.assertEqual(validated["spo2"], Decimal("98"))
        for field, value in (("heart_rate", 19), ("heart_rate", 251), ("spo2", "NaN"), ("spo2", 101), ("systolic", 39), ("diastolic", 201), ("temperature", "Infinity"), ("temperature", 46), ("measured_at", "2999-01-01T00:00"), ("measured_at", "invalid")):
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                validate_health_reading({**self.reading, field: value})
        for value in (None, [], {}, "invalid"):
            with self.subTest(data=value), self.assertRaises(ValueError):
                validate_health_reading(value)


if __name__ == "__main__":
    unittest.main()
