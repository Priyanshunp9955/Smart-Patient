"""Serve the existing page URLs and frontend assets."""
from flask import Blueprint, jsonify, send_from_directory, session
from ..config import ASSETS_DIR, PAGES_DIR

blueprint = Blueprint("frontend", __name__)


@blueprint.route("/")
def home():
    return send_from_directory(PAGES_DIR, "index.html")


@blueprint.route("/<path:filename>")
def frontend_files(filename):
    allowed_pages = {
        "index.html", "login.html", "register.html",
        "dashboard.html", "add-reading.html",
        "consultation.html"
    }

    if filename in allowed_pages:
        if filename in {
            "dashboard.html",
            "add-reading.html",
            "consultation.html"
        } and "patient_id" not in session:
            return send_from_directory(PAGES_DIR, "login.html")

        return send_from_directory(PAGES_DIR, filename)

    if filename.startswith("assets/"):
        return send_from_directory(ASSETS_DIR, filename[len("assets/"):])

    # Preserve the asset URLs used before the directory reorganization.
    legacy_assets = {
        "CSS": "css", "css": "css",
        "JS": "js", "js": "js",
        "Image": "images", "image": "images"
    }
    directory, separator, relative_path = filename.partition("/")
    if separator and directory in legacy_assets:
        return send_from_directory(ASSETS_DIR / legacy_assets[directory], relative_path)

    return jsonify({"error": "Not found"}), 404
