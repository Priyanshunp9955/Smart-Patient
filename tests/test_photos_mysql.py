"""Opt-in live MySQL checks using only disposable test patients, never existing rows."""
import hashlib
import json
import os
import unittest
from io import BytesIO
from uuid import uuid4

from PIL import Image
from werkzeug.security import generate_password_hash

from backend.smart_patient import create_app
from backend.smart_patient.database import get_db_connection


@unittest.skipUnless(os.getenv("SMARTHEALTH_TEST_MYSQL") == "1", "Opt-in live MySQL test")
class MySQLPhotoTests(unittest.TestCase):
    def test_photo_lifecycle_and_patient_isolation_preserve_existing_data(self):
        app = create_app()
        app.config.update(TESTING=True)
        admin = get_db_connection()
        self.addCleanup(admin.close)
        cursor = admin.cursor()
        self.addCleanup(cursor.close)
        cursor.execute("SELECT id FROM patients ORDER BY id")
        existing_ids = tuple(row[0] for row in cursor.fetchall())

        def snapshot():
            if not existing_ids:
                return "empty"
            cursor.execute("SELECT * FROM patients WHERE id IN (" + ",".join(["%s"] * len(existing_ids)) + ") ORDER BY id", existing_ids)
            return hashlib.sha256(json.dumps(cursor.fetchall(), default=str).encode()).hexdigest()

        before = snapshot()
        admin.commit()
        created = []

        def cleanup():
            for patient_id, email in created:
                cursor.execute("DELETE FROM patients WHERE id = %s AND email = %s", (patient_id, email))
            admin.commit()
            self.assertEqual(snapshot(), before, "Existing patient records changed")
        self.addCleanup(cleanup)

        clients = []
        password = "test-" + uuid4().hex
        for label in ("One", "Two"):
            email = "photo-integration-" + uuid4().hex + "@example.invalid"
            cursor.execute("INSERT INTO patients (full_name, email, password_hash) VALUES (%s, %s, %s)",
                           ("Photo Test " + label, email, generate_password_hash(password)))
            created.append((cursor.lastrowid, email))
            admin.commit()
            client = app.test_client()
            self.assertEqual(client.post("/api/login", json={"email": email, "password": password}).status_code, 200)
            token = client.get("/api/profile").json["csrf_token"]
            clients.append((client, token))
        first, token = clients[0]
        second, second_token = clients[1]
        self.assertEqual(first.get("/api/profile/photo").status_code, 404)

        def upload(client, csrf, color):
            image = BytesIO()
            Image.new("RGB", (80, 60), color).save(image, "PNG")
            image.seek(0)
            response = client.post("/api/profile/photo", data={"photo": (image, "avatar.png")},
                                   headers={"X-CSRF-Token": csrf})
            self.assertEqual(response.status_code, 200)
            return response.json["photo_url"]

        first_url = upload(first, token, "red")
        first_photo = first.get(first_url).data
        self.assertEqual(first.get("/api/me").json["patient"]["photo_url"], first_url)
        self.assertEqual(second.get(first_url).status_code, 404)
        self.assertEqual(second.get(first_url + "&patient_id=" + str(created[0][0])).status_code, 400)

        first.post("/api/logout")
        self.assertEqual(first.get(first_url).status_code, 401)
        self.assertEqual(first.post("/api/login", json={"email": created[0][1], "password": password}).status_code, 200)
        self.assertEqual(first.get("/api/me").json["patient"]["photo_url"], first_url)
        self.assertEqual(first.get(first_url).data, first_photo)
        token = first.get("/api/profile").json["csrf_token"]

        replaced_url = upload(first, token, "green")
        self.assertNotEqual(replaced_url, first_url)
        self.assertNotEqual(first.get(replaced_url).data, first_photo)
        second_url = upload(second, second_token, "blue")
        second_photo = second.get(second_url).data
        self.assertNotEqual(first.get(replaced_url).data, second_photo)
        self.assertEqual(first.delete("/api/profile/photo", headers={"X-CSRF-Token": token}).status_code, 200)
        self.assertEqual(first.get(replaced_url).status_code, 404)
        self.assertIsNone(first.get("/api/me").json["patient"]["photo_url"])
        self.assertEqual(second.get(second_url).data, second_photo)
        second.post("/api/logout")
        second.post("/api/login", json={"email": created[1][1], "password": password})
        self.assertEqual(second.get(second_url).data, second_photo)
        admin.commit()
        self.assertEqual(snapshot(), before)


if __name__ == "__main__":
    unittest.main()
