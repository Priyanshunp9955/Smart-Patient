# SmartHealth / Smart Patient

A Flask and MySQL application with a plain HTML, CSS, and JavaScript frontend.

## Directory structure

```text
Smart Patient/
|-- backend/
|   |-- app.py                    # Existing development server entry point
|   |-- requirements.txt          # Python dependencies
|   |-- .env.example              # Configuration template
|   |-- .env                      # Existing local configuration (private)
|   |-- venv/                     # Existing local virtual environment
|   `-- smart_patient/
|       |-- __init__.py           # Application creation and route registration
|       |-- config.py             # Paths and Flask session settings
|       |-- database.py           # MySQL connection helper
|       |-- migrations.py         # Additive patient profile migration command
|       |-- routes/
|       |   |-- frontend.py       # Pages, assets, and page access checks
|       |   |-- auth.py           # Registration, login, session, logout
|       |   |-- readings.py       # Read and save health measurements
|       |   |-- profile.py        # Session-scoped profile read/update APIs
|       |   |-- photos.py         # Private profile photo upload/serve/remove
|       |   `-- system.py         # Application and database health checks
|       `-- validators/
|           |-- readings.py       # Existing measurement validation
|           |-- profile.py        # Profile input validation
|           `-- photo.py          # Image decoding, validation, and normalization
|-- frontend/
|   |-- pages/                    # Public pages and protected patient pages
|   `-- assets/
|       |-- css/                  # Shared stylesheet
|       |-- js/                   # Existing browser scripts
|       `-- images/               # Image assets
`-- tests/                        # Regression checks without a live database
```

## Run locally (PowerShell)

From the project root, use the existing virtual environment:

```powershell
.\backend\venv\Scripts\python.exe .\backend\app.py
```

Open <http://127.0.0.1:5000/>. All pages and API requests are served by Flask.
The existing `python app.py` command also works from the `backend` directory.
`python -m backend.app` and `flask --app backend.app run` work from the root.

For a fresh environment:

```powershell
python -m venv backend/venv
.\backend\venv\Scripts\python.exe -m pip install -r backend/requirements.txt
Copy-Item backend/.env.example backend/.env
```

Only copy the example when setting up a new checkout; keep an existing `.env`.
Set the database credentials and `FLASK_SECRET_KEY` in `backend/.env`.
The application uses the existing MySQL `patients` and `health_readings`
tables. Run the additive profile migration below before using My Profile.

## Development

Edit markup in `frontend/pages`, styling in `frontend/assets/css`, and browser
behavior in `frontend/assets/js`. The page URLs remain `/index.html`,
`/login.html`, `/register.html`, `/dashboard.html`, `/add-reading.html`,
`/consultation.html`, and `/profile.html`. Assets are served under `/assets/`; the previous
`/CSS/`, `/css/`, `/JS/`, `/js/`, `/Image/`, and `/image/` URLs also work.

Existing API URLs remain available. `/api/me` now also returns `photo_url` and reads
the current name and photo version from MySQL. Configuration
always loads from `backend/.env`, independently of the working directory.
The pre-existing local `Microsoft/` tool cache is left in place and ignored.

Popup feedback is shared through `frontend/assets/js/notifications.js` and
`frontend/assets/css/notifications.css`. Use
`SmartHealth.notify(message, "success")` for feedback on the current page, or
`SmartHealth.flash(message, "success")` before a redirect. Supported types are
`success`, `error`, `warning`, and `info`. Errors remain until dismissed;
other cards close automatically and pause while hovered or focused.

Health records on the dashboard and Add Reading page share
`frontend/assets/js/health-readings.js`. Both fetch the current patient's
`/api/readings` data without caching. Records refresh after saving, when a
page regains focus, when browser Back restores a page, and when another open
page saves a reading. Cross-tab messages carry only a refresh signal; health
records are not stored in browser storage.

Health Alerts evaluates the current patient's most recently saved record
(the highest auto-increment reading ID), including backdated measurements.
Overview cards, history, and trends retain their measurement-date ordering.
The five academic demonstration rules remain heart rate > 100 BPM, SpO2 < 95%,
systolic > 140 mmHg, diastolic > 90 mmHg, and temperature > 38 C.
Complete readings with no matches show information; unavailable measurements
show an incomplete-analysis message, and failed API requests clear stale alerts
and show an error. Alerts are for academic demonstration only.

Both saved-reading tables have an Actions column. Delete opens a browser
confirmation identifying the reading ID and measurement date; cancelling sends
no request. Confirmed deletion calls `DELETE /api/readings/<reading_id>` with
JSON `{ "confirmed": true }` and `X-SmartHealth-Action: delete-reading`.
The route requires a signed-in session, rejects cross-origin requests, and
deletes only when both the record ID and session patient ID match. Missing or
other-patient IDs return the same 404 response. Successful deletion refreshes
the current page and other open reading pages through the existing refresh
signals, including cards, history, trends, and demonstration alerts.

## Patient profile

My Profile is available in every patient sidebar at `/profile.html`. It shares
the Dashboard layout, mobile navigation, account controls, and notifications.
Patients can view all six profile fields, choose Edit Profile, save changes,
or cancel without writing. Email is read-only. Optional fields can be cleared.

Before first use, run this command from the project root with the configured
MySQL database available:

```powershell
.\backend\venv\Scripts\python.exe -m flask --app backend.app migrate-profile
```

The database account running the migration needs SELECT and ALTER permission
on `patients`. If the application account has restricted privileges, have a
database administrator run the command with an account that has ALTER permission
(using `DB_USER` and `DB_PASSWORD` environment variables for that process).
Keep the application's regular credentials unchanged. MySQL error 1142 means
the migration account lacks permission; the command reports this explicitly.

The command checks the selected database's existing schema and adds only missing
nullable columns: `phone VARCHAR(32)`, `date_of_birth DATE`, `gender VARCHAR(32)`,
`blood_group VARCHAR(3)`, `profile_photo MEDIUMBLOB`, and
`profile_photo_version CHAR(32)`. It never recreates the table, changes existing
columns, or updates existing patient rows. Repeated runs are safe; a MySQL advisory
lock prevents simultaneous migration runs. MySQL DDL commits implicitly; apply
this command during normal database maintenance for large patient tables.

`GET /api/profile` returns only the session patient's safe profile fields and
a session CSRF token. `PUT /api/profile` requires JSON with exactly `full_name`,
`phone`, `date_of_birth`, `gender`, and `blood_group`, plus the returned token in
`X-CSRF-Token`. The server rejects cross-site requests and never accepts a patient
ID, email, or password field for updates. Reads and writes select the patient ID
from the signed login session and use parameterized SQL. Profile and account API
responses use `Cache-Control: no-store`.

Names must contain 1–100 characters without control characters. Optional phone
numbers allow 7–15 digits and common formatting, up to 32 total characters.
Birth dates must use `YYYY-MM-DD`, from January 1, 1900 through today. Gender and
blood group must match the form's options; blank optional fields become SQL NULL.
Passwords and password hashes are never included in profile responses.

A successful save updates the session name, page details, and account initials.
Other open patient pages refresh their account names through BroadcastChannel,
with focus, visibility, and browser Back refreshes as fallbacks. Messages contain
only a refresh signal; profile details are not stored in browser storage.

Profile implementation files are `frontend/pages/profile.html`,
`frontend/assets/css/profile.css`, `frontend/assets/js/profile.js`, and the backend
profile route, validator, and migration modules. The three existing patient pages
add the sidebar link; `session.js` handles name refreshes. Backend initialization,
page routing, and auth cache headers are updated in both existing package copies.

## Profile photos and account navigation

The top-right avatar, name, and Patient Account caption link to My Profile on
Dashboard, Add Reading, Consultation, and Profile. Logout remains a separate
button. The avatar shows the patient's saved photo or initials when no photo is
available, including when an image fails to load.

In My Profile, choose Upload Profile Photo (or Change Profile Photo), select an
image, review the circular preview, and choose Save Photo. Cancel discards the
preview without an upload. Remove Photo clears only the current patient's photo.
Failed uploads preserve the preview for retry; failed removals preserve the photo.

The file limit is 2 MB (2,097,152 bytes), with JPG/JPEG, PNG, and WebP accepted.
The backend checks the file extension against the decoded image format, verifies
and decodes the image, rejects damaged or animated images, and limits dimensions
to 16 million pixels and 8192 pixels per side. Pillow corrects EXIF orientation,
resizes to at most 512 by 512 pixels while preserving aspect ratio, and creates a
fresh WebP image containing only pixels. Original EXIF/GPS, comments, filenames,
and appended content are discarded. See the official
[Pillow image verification documentation](https://pillow.readthedocs.io/en/stable/reference/Image.html#PIL.Image.Image.verify).
Pillow is included in both requirements files and installed in the existing venv.

Photo bytes and a random version are stored atomically in the patient's MySQL
row. Back up the database to preserve photos; no public upload directory or extra
filesystem permissions are needed. Serving uses the session patient ID, never
a patient ID or filename supplied by the client. Photos survive refresh, logout,
and a later login. Other open patient pages refresh their avatars after changes.

`GET /api/profile/photo` serves only the logged-in patient's WebP image (404 if
absent). `POST /api/profile/photo` accepts multipart field `photo` with the profile
CSRF token in `X-CSRF-Token`; omit a manually set Content-Type so the browser can
add the multipart boundary. `DELETE /api/profile/photo` requires the same token
and an empty body. Mutations reject cross-site requests, extra form fields,
duplicate files, and patient identifiers. A version query parameter only refreshes
the avatar URL; it cannot select another patient's image. Image responses use
`no-store`, `nosniff`, and `Cross-Origin-Resource-Policy: same-origin`.

The photo feature adds `routes/photos.py`, `validators/photo.py`, and
`frontend/assets/js/profile-photo.js`. It updates `routes/profile.py`,
`routes/auth.py`, `migrations.py`, and route registration in both backend copies;
all four patient HTML pages; `session.js`, `profile.js`, `style.css`, `profile.css`;
both requirements files; the browser runner and profile browser suite;
`tests/test_app.py`, `tests/test_profile.py`, `tests/test_photos.py`, and
`tests/test_photos_mysql.py`.

For a local manual check after starting Flask:

1. Sign in at <http://127.0.0.1:5000/> and click the top-right account area on
   each patient page. Verify it opens My Profile and Logout still works separately.
2. Upload a JPG, PNG, or WebP image, review the preview, and save it. Check the
   circular photo on the Dashboard and in another open patient tab.
3. Refresh, then log out and sign in again. The saved photo should remain.
4. Change the photo, cancel a preview, and remove the saved photo. Removal should
   restore initials across patient pages.
5. Try an unsupported file, a damaged image, and an image above 2 MB. Each should
   show an error while retaining the saved photo.
6. Sign in as another patient in a separate browser profile. That account must
   have its own photo and cannot view or alter the first patient's photo URL.

## Change Password

My Profile includes a Change Password card with Current Password, New Password,
Confirm New Password, and Update Password. Each field has an accessible Show/Hide
control and starts masked. A new password must contain at least eight characters,
match its confirmation, and differ from the verified current password. Passwords
are not trimmed, so intentional spaces remain significant. Fields are limited to
1024 characters, and the API limits the request body to 16 KB.

`POST /api/change-password` accepts JSON containing exactly `current_password`,
`new_password`, and `confirm_password`, with the existing profile CSRF token in
`X-CSRF-Token`. The route requires a login session and rejects cross-site requests,
extra identity fields, malformed input, and query parameters. A wrong current
password returns 400 without logging the patient out; an expired session returns
401 and the browser redirects to login. The frontend disables the form while a
request is pending and blocks duplicate submissions.

The backend selects only the session patient's hash with `SELECT ... FOR UPDATE`,
verifies it with Werkzeug `check_password_hash`, and saves a fresh Werkzeug
`generate_password_hash` result using a parameterized UPDATE scoped to that ID.
Concurrent changes cannot verify an obsolete hash. Failures roll back, and only
`patients.password_hash` is updated. The existing schema is unchanged; no migration
is required. Profile details, photos, health records, and other accounts remain
untouched. The current login remains active after a successful change.

Passwords are never included in API responses, logs, cookies, or browser storage.
The form clears and remasks its fields after every completed request and when
leaving the page or restoring it from browser Back. Plain text is visible in an
input only when the patient explicitly chooses Show.

Changed files for this feature are `frontend/pages/profile.html`,
`frontend/assets/js/profile.js`, `frontend/assets/css/profile.css`,
`backend/smart_patient/routes/auth.py` and its existing root-package copy,
`tests/test_password.py`, `tests/test_password_mysql.py`,
`tests/browser/profile.html`, and this README. No reset, OTP, or email flow is added.

To test manually, start Flask with the existing command:

```powershell
.\backend\venv\Scripts\python.exe .\backend\app.py
```

1. Sign in at <http://127.0.0.1:5000/>, open My Profile, and find Change Password.
2. Enter a wrong current password with matching valid new passwords. Confirm the
   error appears and the patient remains signed in.
3. Try mismatched confirmation, a password shorter than eight characters, and
   reusing the current password. Each should show an error without a save.
4. Use the correct current password and a matching different password. Confirm
   success, empty masked fields, and unchanged profile details and photo.
5. Log out. Confirm the old password fails login and the new password works.
6. To check expiry, sign out in another tab while Profile remains open, then
   submit the form. It should redirect to login and clear its password fields.

## Checks

```powershell
.\backend\venv\Scripts\python.exe -m unittest discover -s tests -v
```

The default checks use Flask's test client, mocked database connections, and an
isolated SQLite table. They never read or write patient records in MySQL. The live
MySQL tests are skipped unless explicitly enabled below.

To check popup interactions in Google Chrome, including registration,
validation, redirects, and mobile layout:

```powershell
.\backend\venv\Scripts\python.exe tests/run_notifications_browser.py
```

This uses a temporary browser profile and mocked API responses without
connecting to MySQL.

To check profile display, editing, photo previews, upload/change/removal, validation,
retries, cancellation, concurrent saves, account links, avatar synchronization,
and mobile layouts:

```powershell
.\backend\venv\Scripts\python.exe tests/run_notifications_browser.py --suite profile
.\backend\venv\Scripts\python.exe tests/run_notifications_browser.py --suite sidebar
```

The profile browser suite also checks password masking, Show/Hide, validation,
success/failure messages, duplicate prevention, sensitive-field clearing, expired
sessions, and responsive password controls. `tests/test_password.py` covers server
validation, current-password verification, safe responses, CSRF, session and SQL
ownership checks, hashing, old-password rejection, and rollback.

To run the live MySQL password/login test explicitly:

```powershell
$env:SMARTHEALTH_TEST_MYSQL = "1"
try {
    .\backend\venv\Scripts\python.exe -m unittest discover -s tests -p test_password_mysql.py -v
} finally {
    Remove-Item Env:SMARTHEALTH_TEST_MYSQL
}
```

This opt-in test creates two disposable patients and one health reading. It
verifies incorrect passwords, mismatches, unauthorized requests, a successful
change, old-password login rejection, new-password login success, and unchanged
profile information, photos, health records, and the second patient's hash. It
cleans up only its own test rows and compares existing patient and health data
before and after. Existing patients' passwords are never changed by the test.

`tests/test_profile.py` covers session enforcement, CSRF and origin checks,
read-only fields, validation, SQL ownership isolation, rollback, safe responses,
and repeatable migrations. It uses mocks and an isolated SQLite table; it never
modifies live patient data. Browser checks also use mocked API responses.

`tests/test_photos.py` checks image formats, exact file-size limits, damaged or
spoofed images, metadata stripping, dimension/animation limits, private image
serving, CSRF, patient isolation, and atomic writes/rollback.

To explicitly run the live MySQL photo lifecycle test, with the database running:

```powershell
$env:SMARTHEALTH_TEST_MYSQL = "1"
try {
    .\backend\venv\Scripts\python.exe -m unittest discover -s tests -p test_photos_mysql.py -v
} finally {
    Remove-Item Env:SMARTHEALTH_TEST_MYSQL
}
```

This opt-in test creates two uniquely named disposable test patients, verifies
upload/replacement/removal, persistence through a fresh login, and isolation,
then removes only those test rows. It compares all existing patient rows before
and after and never modifies them or recreates any table.

To check health record synchronization, dashboard cards, trends, alerts,
cross-page updates, and error recovery:

```powershell
.\backend\venv\Scripts\python.exe tests/run_notifications_browser.py --suite health-readings
```

