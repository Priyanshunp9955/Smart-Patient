"""Regression coverage for routes, sessions, assets, and database interactions."""

import os
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
        for name in ("dashboard.html", "add-reading.html", "consultation.html"):
            with self.subTest(page=name, authenticated=False):
                self.assertEqual(self.page_bytes("/" + name), login_content)
        self.login_session()
        for name in ("dashboard.html", "add-reading.html", "consultation.html"):
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
        self.assertEqual(self.client.get("/api/me").json["patient"], {"id": 7, "full_name": "Test Patient"})
        self.assertIn("HttpOnly", response.headers["Set-Cookie"])
        self.assertIn("SameSite=Lax", response.headers["Set-Cookie"])
        self.assertEqual(self.client.post("/api/logout").json["status"], "success")
        self.assertEqual(self.client.get("/api/me").status_code, 401)
        self.assert_closed()

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
                self.assertEqual(self.client.get("/api/me").json["patient"], {"id": patient_id, "full_name": full_name})
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
        self.assert_closed()

    def test_reading_database_errors_and_rollback(self):
        self.login_session()
        with self.database("readings", Error("offline")):
            self.assertEqual(self.client.get("/api/readings").status_code, 500)
        self.cursor.execute.side_effect = Error("write failed")
        with self.database("readings"):
            self.assertEqual(self.client.post("/api/readings", json=self.reading).status_code, 500)
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
