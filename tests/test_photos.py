"""Upload decoding, private image access, account details, and atomic photo writes."""
import os
import unittest
from io import BytesIO
from unittest.mock import MagicMock, patch

from PIL import Image, PngImagePlugin
from mysql.connector import Error
from werkzeug.datastructures import FileStorage, MultiDict

os.environ.setdefault("FLASK_SECRET_KEY", "test-only-secret")
from backend.smart_patient import create_app
from backend.smart_patient.validators.photo import MAX_PHOTO_BYTES, validate_photo


def image_bytes(format="PNG", size=(30, 20), color="red", **kwargs):
    result = BytesIO()
    Image.new("RGB", size, color).save(result, format=format, **kwargs)
    return result.getvalue()


class PhotoTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app.config.update(TESTING=True, SECRET_KEY="test-only-secret")
        self.app.logger.disabled = True
        self.client = self.app.test_client()
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value
        self.cursor.fetchone.return_value = {"id": 7}
        self.patch = patch("backend.smart_patient.routes.photos.get_db_connection", return_value=self.connection)
        self.connect = self.patch.start()
        self.addCleanup(self.patch.stop)

    def login(self, patient_id=7):
        with self.client.session_transaction() as session:
            session.update(patient_id=patient_id, full_name="Photo Patient", profile_csrf_token="photo-token")

    def upload(self, content=None, filename="avatar.png", headers=None):
        response = self.client.post("/api/profile/photo", data={"photo": (BytesIO(image_bytes() if content is None else content), filename)},
                                    headers={"X-CSRF-Token": "photo-token"} if headers is None else headers)
        response.request.environ["wsgi.input"].close()
        return response

    def test_all_photo_methods_require_login(self):
        self.assertEqual(self.client.get("/api/profile/photo").status_code, 401)
        self.assertEqual(self.upload().status_code, 401)
        self.assertEqual(self.client.delete("/api/profile/photo").status_code, 401)
        self.connect.assert_not_called()

    def test_upload_and_remove_require_csrf_and_same_origin(self):
        self.login()
        for headers in ({}, {"X-CSRF-Token": "wrong"}, {"X-CSRF-Token": "photo-token", "Origin": "https://other.example"},
                        {"X-CSRF-Token": "photo-token", "Sec-Fetch-Site": "cross-site"}):
            with self.subTest(headers=headers):
                self.assertEqual(self.upload(headers=headers).status_code, 403)
                self.assertEqual(self.client.delete("/api/profile/photo", headers=headers).status_code, 403)
        self.connect.assert_not_called()

    def test_all_allowed_formats_decode_and_become_webp(self):
        for extension, format in (("jpg", "JPEG"), ("jpeg", "JPEG"), ("PNG", "PNG"), ("webp", "WEBP")):
            with self.subTest(extension=extension):
                upload = FileStorage(stream=BytesIO(image_bytes(format, (1000, 600))), filename="avatar." + extension)
                normalized = validate_photo(upload)
                with Image.open(BytesIO(normalized)) as image:
                    image.load()
                    self.assertEqual(image.format, "WEBP")
                    self.assertEqual(image.size, (512, 307))

    def test_metadata_and_appended_content_are_removed(self):
        metadata = PngImagePlugin.PngInfo()
        metadata.add_text("Comment", "private GPS location and author")
        content = image_bytes(pnginfo=metadata) + b"<script>untrusted-content</script>"
        clean = validate_photo(FileStorage(stream=BytesIO(content), filename="photo.png"))
        self.assertNotIn(b"private GPS", clean)
        self.assertNotIn(b"untrusted-content", clean)
        with Image.open(BytesIO(clean)) as image:
            self.assertFalse(image.getexif())
            self.assertNotIn("Comment", image.info)

    def test_upload_stores_pixels_and_version_only_for_session_patient(self):
        self.login()
        response = self.upload()
        self.assertEqual(response.status_code, 200)
        sql, parameters = self.cursor.execute.call_args.args
        self.assertEqual(sql, "UPDATE patients SET profile_photo = %s, profile_photo_version = %s WHERE id = %s")
        content, version, patient_id = parameters
        self.assertEqual(patient_id, 7)
        self.assertEqual(len(version), 32)
        self.assertEqual(response.json["photo_url"], "/api/profile/photo?v=" + version)
        with Image.open(BytesIO(content)) as image:
            self.assertEqual(image.format, "WEBP")
        self.connection.commit.assert_called_once()
        self.cursor.close.assert_called_once()
        self.connection.close.assert_called_once()

    def test_filename_is_never_used_as_a_storage_path(self):
        self.login()
        response = self.upload(filename="../../../../../avatar.png")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("avatar", self.cursor.execute.call_args.args[0])
        self.assertNotIn("..", response.json["photo_url"])

    def test_rejects_fake_disallowed_mismatched_empty_and_damaged_images(self):
        self.login()
        cases = [(b"<svg></svg>", "photo.svg"), (b"<script>evil</script>", "photo.jpg"),
                 (image_bytes(), "photo.jpg"), (b"", "photo.png"), (image_bytes()[:40], "photo.png"),
                 (image_bytes("GIF"), "photo.png"), (image_bytes(), "photo.php")]
        for content, filename in cases:
            with self.subTest(filename=filename, size=len(content)):
                self.assertEqual(self.upload(content, filename).status_code, 400)
        self.connect.assert_not_called()

    def test_file_limit_and_multipart_request_limit(self):
        self.login()
        self.assertEqual(self.upload(b"x" * (MAX_PHOTO_BYTES + 1)).status_code, 400)
        self.assertEqual(self.upload(b"x" * (MAX_PHOTO_BYTES + 100_000)).status_code, 413)
        self.assertEqual(self.client.delete("/api/profile/photo", data=b"x" * 2000,
                                           headers={"X-CSRF-Token": "photo-token"}).status_code, 413)
        self.connect.assert_not_called()

    def test_exact_two_mb_image_is_accepted_and_normalized(self):
        content = image_bytes()
        normalized = validate_photo(FileStorage(stream=BytesIO(content + b"\x00" * (MAX_PHOTO_BYTES - len(content))), filename="limit.png"))
        self.assertLess(len(normalized), MAX_PHOTO_BYTES)

    def test_dimension_limit_and_animation_are_rejected(self):
        self.login()
        self.assertEqual(self.upload(image_bytes(size=(8193, 1))).status_code, 400)
        with patch("backend.smart_patient.validators.photo.MAX_PHOTO_PIXELS", 100):
            self.assertEqual(self.upload().status_code, 400)
        output = BytesIO()
        Image.new("RGB", (10, 10), "red").save(output, format="WEBP", save_all=True,
                    append_images=[Image.new("RGB", (10, 10), "blue")], duration=100, loop=0)
        self.assertEqual(self.upload(output.getvalue(), "animated.webp").status_code, 400)
        self.connect.assert_not_called()

    def test_extra_fields_identifiers_duplicate_files_and_wrong_content_type_rejected(self):
        self.login()
        headers = {"X-CSRF-Token": "photo-token"}
        self.assertEqual(self.client.post("/api/profile/photo", json={}, headers=headers).status_code, 400)
        for extra in ("patient_id", "email", "id"):
            self.assertEqual(self.client.post("/api/profile/photo", data={"photo": (BytesIO(image_bytes()), "photo.png"), extra: "8"}, headers=headers).status_code, 400)
        data = MultiDict([("photo", (BytesIO(image_bytes()), "one.png")), ("photo", (BytesIO(image_bytes()), "two.png"))])
        self.assertEqual(self.client.post("/api/profile/photo", data=data, headers=headers).status_code, 400)
        self.assertEqual(self.client.delete("/api/profile/photo", json={"patient_id": 8}, headers=headers).status_code, 400)
        self.assertEqual(self.client.get("/api/profile/photo?patient_id=8").status_code, 400)
        self.connect.assert_not_called()

    def test_private_serving_filters_by_session_even_with_other_version(self):
        self.login(8)
        content = image_bytes("WEBP")
        self.cursor.fetchone.return_value = {"profile_photo": content}
        response = self.client.get("/api/profile/photo?v=another-patients-version")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, content)
        self.cursor.execute.assert_called_once_with("SELECT profile_photo FROM patients WHERE id = %s", (8,))
        self.assertEqual(response.mimetype, "image/webp")
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response.headers["Cross-Origin-Resource-Policy"], "same-origin")

    def test_absent_photo_is_404_and_missing_account_invalidates_session(self):
        self.login()
        self.cursor.fetchone.return_value = {"profile_photo": None}
        self.assertEqual(self.client.get("/api/profile/photo").status_code, 404)
        self.cursor.fetchone.return_value = None
        self.assertEqual(self.upload().status_code, 401)
        self.connection.commit.assert_not_called()
        with self.client.session_transaction() as session:
            self.assertNotIn("patient_id", session)

    def test_remove_clears_only_own_photo_and_is_repeatable(self):
        self.login()
        for _ in range(2):
            response = self.client.delete("/api/profile/photo", headers={"X-CSRF-Token": "photo-token"})
            self.assertEqual(response.status_code, 200)
            self.assertIsNone(response.json["photo_url"])
            self.assertEqual(self.cursor.execute.call_args.args[1], (None, None, 7))
        self.assertEqual(self.connection.commit.call_count, 2)

    def test_database_failures_roll_back_and_leave_existing_photo_intact(self):
        self.login()
        for operation in ("execute", "commit"):
            with self.subTest(operation=operation):
                self.connection.reset_mock()
                self.cursor.execute.side_effect = Error("sensitive details") if operation == "execute" else None
                self.connection.commit.side_effect = Error("sensitive details") if operation == "commit" else None
                response = self.upload()
                self.assertEqual(response.status_code, 500)
                self.assertNotIn(b"sensitive", response.data)
                self.connection.rollback.assert_called_once()
                self.connection.close.assert_called_once()

    def test_account_returns_current_database_name_and_photo_after_fresh_session(self):
        self.login()
        self.cursor.fetchone.return_value = {"id": 7, "full_name": "Current Name", "profile_photo_version": "a" * 32}
        with patch("backend.smart_patient.routes.auth.get_db_connection", return_value=self.connection):
            response = self.client.get("/api/me")
        self.assertEqual(response.json["patient"], {"id": 7, "full_name": "Current Name", "photo_url": "/api/profile/photo?v=" + "a" * 32})
        self.cursor.execute.assert_called_once_with("SELECT id, full_name, profile_photo_version FROM patients WHERE id = %s", (7,))
        self.assertEqual(response.headers["Cache-Control"], "no-store")


if __name__ == "__main__":
    unittest.main()
