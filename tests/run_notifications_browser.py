"""Run popup integration checks in headless Chrome without a live database."""

import argparse
import json
import re
import subprocess
import tempfile
import threading
from io import BytesIO
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=("notifications", "health-readings", "sidebar", "profile"), default="notifications")
    args = parser.parse_args()
    if not CHROME.is_file():
        raise SystemExit("Google Chrome is required for these browser checks.")

    pages = {}
    for path in (ROOT / "frontend/pages").glob("*.html"):
        # Remote chart/font services are not needed to check action feedback.
        html = re.sub(r'<script src="https://[^>]*></script>', "", path.read_text(encoding="utf-8"))
        pages[path.stem] = html
    scripts = {path.name: path.read_text(encoding="utf-8") for path in (ROOT / "frontend/assets/js").glob("*.js")}
    image_buffer = BytesIO()
    Image.new("RGB", (16, 16), "teal").save(image_buffer, format="WEBP")
    avatar_bytes = image_buffer.getvalue()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/":
                data = (ROOT / f"tests/browser/{args.suite}.html").read_bytes()
                content_type = "text/html; charset=utf-8"
            elif self.path == "/fixtures.json":
                data = json.dumps({"pages": pages, "scripts": scripts}).encode()
                content_type = "application/json"
            elif self.path == "/api/me":
                data = json.dumps({"status": "success", "patient": {"id": 7, "full_name": "Test Patient"}}).encode()
                content_type = "application/json"
            elif self.path.startswith("/api/profile/photo?v=") and not self.path.endswith("missing"):
                data = avatar_bytes
                content_type = "image/webp"
            elif self.path == "/api/readings":
                data = json.dumps({"status": "success", "readings": []}).encode()
                content_type = "application/json"
            elif self.path.endswith(".html") and self.path[1:-5] in pages:
                data = pages[self.path[1:-5]].encode("utf-8")
                content_type = "text/html; charset=utf-8"
            elif self.path.startswith("/assets/js/") and self.path[11:] in scripts:
                data = scripts[self.path[11:]].encode("utf-8")
                content_type = "text/javascript; charset=utf-8"
            elif self.path in {"/assets/css/style.css", "/assets/css/notifications.css", "/assets/css/page-layout.css", "/assets/css/profile.css"}:
                css = (ROOT / "frontend" / self.path.lstrip("/")).read_text(encoding="utf-8")
                data = re.sub(r"@import[^;]+;", "", css).encode("utf-8")
                content_type = "text/css; charset=utf-8"
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                # Navigating or removing an iframe may cancel its pending assets.
                pass

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with tempfile.TemporaryDirectory(prefix="smarthealth-popup-checks-") as profile:
            result = subprocess.run([
                str(CHROME), "--headless=new", "--disable-gpu", "--no-first-run",
                "--no-default-browser-check", "--disable-background-networking",
                "--disable-extensions", "--disable-sync", "--user-data-dir=" + profile,
                "--virtual-time-budget=45000", "--dump-dom",
                f"http://127.0.0.1:{server.server_port}/"
            ], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=50)
            match = re.search(r'<pre id="results">(.*?)</pre>', result.stdout, re.S)
            if not match:
                raise SystemExit("Browser results unavailable: " + result.stderr[-1500:])
            output = match.group(1)
            print(output)
            if "DONE" not in output or "FAIL" in output:
                raise SystemExit("Notification browser checks failed.")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
