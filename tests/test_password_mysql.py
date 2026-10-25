"""Opt-in real MySQL password/login checks using disposable test patients only."""
import hashlib
import json
import os
import unittest
from io import BytesIO
from uuid import uuid4

from PIL import Image
from werkzeug.security import check_password_hash, generate_password_hash

from backend.smart_patient import create_app
from backend.smart_patient.database import get_db_connection


@unittest.skipUnless(os.getenv("SMARTHEALTH_TEST_MYSQL") == "1", "Opt-in live MySQL test")
class MySQLPasswordTests(unittest.TestCase):
    def test_change_password_and_fresh_login_preserve_other_patient_data(self):
        app = create_app()
        app.config.update(TESTING=True)
        connection = get_db_connection()
        self.addCleanup(connection.close)
        cursor = connection.cursor()
        self.addCleanup(cursor.close)
        cursor.execute("SELECT id FROM patients ORDER BY id")
        existing_ids = tuple(row[0] for row in cursor.fetchall())

        def snapshot_existing():
            if existing_ids:
                cursor.execute("SELECT * FROM patients WHERE id IN (" + ",".join(["%s"] * len(existing_ids)) + ") ORDER BY id", existing_ids)
            else:
                cursor.execute("SELECT * FROM patients WHERE 1=0")
            patients = cursor.fetchall()
            cursor.execute("SELECT * FROM health_readings ORDER BY id")
            readings = cursor.fetchall()
            return hashlib.sha256(json.dumps([patients, readings], default=str).encode()).hexdigest()

        before = snapshot_existing()
        connection.commit()
        created = []
        reading_id = None

        def cleanup():
            if reading_id is not None:
                cursor.execute("DELETE FROM health_readings WHERE id = %s AND patient_id = %s", (reading_id, created[0][0]))
            for patient_id, email in created:
                cursor.execute("DELETE FROM patients WHERE id = %s AND email = %s", (patient_id, email))
            connection.commit()
            self.assertEqual(snapshot_existing(), before, "Existing patient data or health records changed")
        self.addCleanup(cleanup)

        old = "Old-" + uuid4().hex
        new = "New-" + uuid4().hex
        for label in ("One", "Two"):
            email = "password-test-" + uuid4().hex + "@example.invalid"
            cursor.execute("INSERT INTO patients (full_name, email, password_hash) VALUES (%s, %s, %s)",
                           ("Password Test " + label, email, generate_password_hash(old)))
            created.append((cursor.lastrowid, email))
            connection.commit()

        client = app.test_client()
        self.assertEqual(client.post("/api/login", json={"email": created[0][1], "password": old}).status_code, 200)
        token = client.get("/api/profile").json["csrf_token"]
        headers = {"X-CSRF-Token": token}
        fields = {"current_password": old, "new_password": new, "confirm_password": new}
        self.assertEqual(client.put("/api/profile", headers=headers, json={"full_name": "Password Test One", "phone": "+91 98765 43210", "date_of_birth": "2000-01-02", "gender": "Female", "blood_group": "O+"}).status_code, 200)
        image = BytesIO()
        Image.new("RGB", (16, 16), "teal").save(image, format="PNG")
        image.seek(0)
        self.assertEqual(client.post("/api/profile/photo", data={"photo": (image, "photo.png")}, headers=headers).status_code, 200)
        response = client.post("/api/readings", json={"heart_rate": 72, "spo2": 98, "systolic": 120, "diastolic": 80, "temperature": 36.5, "measured_at": "2020-01-02T10:30"})
        self.assertEqual(response.status_code, 201)
        reading_id = response.json["reading_id"]
        profile_before = client.get("/api/profile").json["patient"]
        photo_before = client.get(profile_before["photo_url"]).data
        readings_before = client.get("/api/readings").json
        cursor.execute("SELECT password_hash FROM patients WHERE id = %s", (created[1][0],))
        other_hash = cursor.fetchone()[0]
        connection.commit()

        self.assertEqual(app.test_client().post("/api/change-password", json=fields).status_code, 401)
        self.assertEqual(client.post("/api/change-password", json={**fields, "current_password": "incorrect"}, headers=headers).status_code, 400)
        self.assertEqual(client.post("/api/change-password", json={**fields, "confirm_password": "mismatch"}, headers=headers).status_code, 400)
        self.assertEqual(client.post("/api/change-password", json={key: old for key in fields}, headers=headers).status_code, 400)
        self.assertEqual(client.post("/api/change-password", json={**fields, "patient_id": created[1][0]}, headers=headers).status_code, 400)
        self.assertEqual(client.post("/api/change-password", json=fields, headers=headers).status_code, 200)
        self.assertEqual(client.post("/api/change-password", json=fields, headers=headers).status_code, 400)
        self.assertEqual(client.get("/api/profile").json["patient"], profile_before)
        self.assertEqual(client.get(profile_before["photo_url"]).data, photo_before)
        self.assertEqual(client.get("/api/readings").json, readings_before)

        client.post("/api/logout")
        self.assertEqual(client.post("/api/login", json={"email": created[0][1], "password": old}).status_code, 401)
        self.assertEqual(client.post("/api/login", json={"email": created[0][1], "password": new}).status_code, 200)
        self.assertEqual(client.get("/api/profile").json["patient"], profile_before)
        self.assertEqual(client.get(profile_before["photo_url"]).data, photo_before)
        self.assertEqual(client.get("/api/readings").json, readings_before)
        connection.commit()
        cursor.execute("SELECT password_hash FROM patients WHERE id = %s", (created[0][0],))
        updated_hash = cursor.fetchone()[0]
        self.assertTrue(check_password_hash(updated_hash, new))
        self.assertFalse(check_password_hash(updated_hash, old))
        self.assertNotEqual(updated_hash, new)
        cursor.execute("SELECT password_hash FROM patients WHERE id = %s", (created[1][0],))
        self.assertEqual(cursor.fetchone()[0], other_hash)


if __name__ == "__main__":
    unittest.main()
