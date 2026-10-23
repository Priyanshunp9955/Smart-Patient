# Deploy SmartHealth: Vercel Frontend + Render Backend

This guide uses **Vercel for the HTML/CSS/JavaScript frontend**, **Render for
Flask**, and a MySQL database reachable from Render.

Deploy the backend first. Then put its actual HTTPS URL into the Vercel
configuration below. `YOUR-RENDER-SERVICE` is a placeholder, not a live service.

## 1. How the two deployments connect

```text
Browser -> your-app.vercel.app
             |-- pages and /assets/* served by Vercel
             `-- /api/* proxied to your-api.onrender.com/api/*
                                          `-- MySQL
```

Keep frontend requests such as `fetch("/api/login")` and
`fetch("/api/readings")` unchanged. A Vercel external rewrite forwards those
requests to Render while the browser continues using the Vercel URL.
This matches the existing `credentials: "same-origin"` requests and
host-only Flask session cookie. See [Vercel external rewrites](https://vercel.com/docs/routing/rewrites).

Use this proxy arrangement consistently for registration, login, logout,
current-patient details, and health readings. Calling the Render origin
from browser JavaScript directly would require a different CORS and cookie
configuration.

## 2. Prepare MySQL

Render must be able to connect to MySQL. `DB_HOST=localhost` on Render does
not connect to the database on your development computer.

Use a reachable external MySQL database or a MySQL private service in the
same Render workspace. For the latter, configure persistent storage and
use the service's internal host and port as described in
[Render's MySQL deployment guide](https://render.com/docs/deploy-mysql).

The app expects:

| Table | Columns used |
| --- | --- |
| `patients` | `id`, `full_name`, `email`, `password_hash` |
| `health_readings` | `id`, `patient_id`, `heart_rate`, `spo2`, `systolic`, `diastolic`, `temperature`, `measured_at` |

The repository currently has no SQL schema or migrations. Export the working
database with MySQL Workbench or the MySQL CLI, then import it into a **new,
empty destination database**. Preserve IDs, email uniqueness, indexes,
foreign keys, and password hashes.

For example, export using the source database's credentials:

```bash
mysqldump --host=SOURCE_HOST --port=3306 --user=EXPORT_USER --password --single-transaction --no-tablespaces --result-file=smarthealth.sql SOURCE_DATABASE
```

Connect to the destination with an administrative/import account:

```bash
mysql --host=DESTINATION_HOST --port=3306 --user=IMPORT_USER --password
```

At the MySQL prompt, replace the database name and file path as appropriate:

```sql
CREATE DATABASE smarthealth CHARACTER SET utf8mb4;
USE smarthealth;
SOURCE /absolute/path/to/smarthealth.sql;
SHOW TABLES;
DESCRIBE patients;
DESCRIBE health_readings;
```

On Windows, `SOURCE C:/deploy/smarthealth.sql;` works inside the MySQL client.
For a private Render MySQL service, run the import from a machine/service
with access to that private network. See the
[MySQL SQL backup restore instructions](https://dev.mysql.com/doc/refman/8.4/en/reloading-sql-format-dumps.html).

Use a separate application account with the `SELECT` and `INSERT` access
needed by the existing endpoints. The current `database.py` accepts host,
port, database, username, and password. If the database provider requires
specific TLS/CA options, add its documented connector settings there.

## 3. Deploy the Flask backend on Render

In Render, create a **Web Service** connected to this Git repository.
Configure the service as follows:

| Setting | Value |
| --- | --- |
| Runtime / Language | Python 3 |
| Root Directory | Leave blank: use the repository root |
| Build Command | `python -m pip install -r backend/requirements.txt gunicorn` |
| Start Command | `gunicorn --bind 0.0.0.0:$PORT --workers 2 --access-logfile - --error-logfile - backend.app:app` |
| Health Check Path | `/api/health` |

The canonical entry point is `backend.app:app`. Build and start commands
above both run from the repository root; do not set Root Directory to
`backend` while using these commands. Gunicorn is installed by the build
command in addition to the application dependencies. This follows
[Render's Flask deployment flow](https://render.com/docs/deploy-flask).

### Render environment variables

Add these in the Render service's environment settings:

```dotenv
PYTHON_VERSION=3.13.1
FLASK_SECRET_KEY=replace-with-a-generated-secret
DB_HOST=your-reachable-mysql-host
DB_PORT=3306
DB_NAME=smarthealth
DB_USER=smarthealth_app
DB_PASSWORD=replace-with-the-database-password
TZ=Asia/Kolkata
```

`3.13.1` matches the existing local runtime. Render supports pinning a full
Python version with `PYTHON_VERSION`; see
[Render Python versions](https://render.com/docs/python-version).

Generate `FLASK_SECRET_KEY` locally with Python:

```powershell
python -c "import secrets; print(secrets.token_hex(32))"
```

Keep that secret stable across workers and redeploys. Keep database
credentials and the Flask secret **only on Render**. Vercel's static
frontend does not need them. Environment variables take precedence over
values loaded from `backend/.env`; do not commit a real `.env` file.

Measurement timestamps currently use local time without timezone offsets.
`TZ=Asia/Kolkata` matches the current India-based setup; use the timezone
that matches the intended measurement times. Multi-timezone support would
require normalizing timestamps in the application.

### Required HTTPS cookie setting

In `backend/smart_patient/config.py`, change the deployment configuration to:

```python
SESSION_COOKIE_HTTPONLY=True,
SESSION_COOKIE_SAMESITE="Lax",
SESSION_COOKIE_SECURE=True
```

The current code hardcodes `SESSION_COOKIE_SECURE=False`. An environment
variable with that name alone does not override it. Make the code change
before deploying publicly over HTTPS, while keeping local HTTP development
configured for its own environment. See
[Flask cookie settings](https://flask.palletsprojects.com/en/stable/web-security/#set-cookie-options).

Leave `SESSION_COOKIE_DOMAIN` unset. Do not set it to the Render hostname:
the browser receives the proxied response on the Vercel hostname and should
keep the session cookie there. Keep `SameSite="Lax"` for this same-origin
proxy design.

Deploy the service and copy its URL, for example:

```text
https://your-api.onrender.com
```

Verify `/api/health` and `/api/db-check` on that URL. The first should return
`status: "ok"`; the second should return `status: "success"`.
The database check executes `SELECT 1`, so also verify the imported tables.

## 4. Configure the Vercel frontend

Create **`frontend/vercel.json`** with the following configuration. Replace
`YOUR-RENDER-SERVICE` with the actual Render service hostname before deploying.
The file is inside `frontend` because that will be the Vercel project root.

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "cleanUrls": false,
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://YOUR-RENDER-SERVICE.onrender.com/api/:path*"
    },
    {
      "source": "/",
      "destination": "/pages/index.html"
    },
    {
      "source": "/index.html",
      "destination": "/pages/index.html"
    },
    {
      "source": "/login.html",
      "destination": "/pages/login.html"
    },
    {
      "source": "/register.html",
      "destination": "/pages/register.html"
    },
    {
      "source": "/dashboard.html",
      "destination": "/pages/dashboard.html"
    },
    {
      "source": "/add-reading.html",
      "destination": "/pages/add-reading.html"
    },
    {
      "source": "/consultation.html",
      "destination": "/pages/consultation.html"
    }
  ],
  "headers": [
    {
      "source": "/api/:path*",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "no-store, private"
        },
        {
          "key": "x-vercel-enable-rewrite-caching",
          "value": "0"
        }
      ]
    }
  ]
}
```

The page rewrites preserve the existing `.html` URLs while the actual files
remain in `frontend/pages`. Assets already live in `frontend/assets`, so
`/assets/css/style.css` and `/assets/js/sidebar.js` need no additional rewrite.

Keep `/api/:path*` pointed to **`/api/:path*` on Render**, not just `/:path*`.
The two API headers disable browser/shared response caching and Vercel
external-rewrite caching so session and patient data are fetched fresh.
See [Vercel rewrite caching controls](https://vercel.com/docs/routing/rewrites#disabling-caching-for-rewrites-to-external-origins).

### Vercel project settings

Import the same Git repository into Vercel:

| Setting | Value |
| --- | --- |
| Framework Preset | Other |
| Root Directory | `frontend` |
| Build Command | Enable Override and leave empty to skip the build |
| Output Directory | `.` |
| Install Command | No package installation needed for this plain HTML/CSS/JS frontend |
| Frontend environment variables | None required for the proxy configuration above |

These settings serve the existing files without a Node.js build, following
[Vercel's static build settings](https://vercel.com/docs/builds/configure-a-build#skip-build-step).
Do not use the repository root as the public output directory: the frontend
project should contain only its pages, assets, and routing configuration.

The Render URL is a literal value in this JSON example. Changing a Vercel
environment variable does not automatically substitute it into the file.
Update the destination and redeploy Vercel whenever the backend URL changes.

### Page access behavior

On Vercel, the HTML files are static application shells. Their markup is
publicly accessible; Flask's HTML-serving access checks do not run for
those static files. `session.js` redirects unsigned users to login, and the
Render API still enforces the patient session for private health records.
Do not put personal data or secrets directly into the static HTML files.

## 5. Verify through the Vercel domain

Use the **Vercel URL** for normal browsing and account actions:

```text
https://your-app.vercel.app
```

| Check | Expected result |
| --- | --- |
| `/` and `/index.html` | Home page loads from Vercel |
| `/login.html` and `/register.html` | Authentication pages load |
| `/assets/css/style.css` | Stylesheet loads |
| `/api/health` | Render response through Vercel, HTTP 200, `status: "ok"` |
| `/api/db-check` | MySQL connectivity succeeds through the proxy |
| Register a test account | Redirect to login with email prefilled and the success popup |
| Log in | Correct patient name appears and session persists |
| Save a test health reading | Reading appears in saved history, dashboard cards, trends, and alerts |
| Navigate sidebar links | Active page or section is highlighted |
| Log out | Login opens; `/api/me` and private reading requests return 401 |

In browser developer tools, API request URLs should start with the Vercel
domain, not the Render domain. After login, check that the session cookie
belongs to the Vercel hostname and is sent on subsequent `/api/` requests.
API responses should not be served from a shared cache.

Plotly charts currently use `cdn.plot.ly`, and Google Fonts supplies the
font. Those external assets need to be reachable. Consultation appointment
requests remain browser-local requests, not server-side bookings.

## 6. Local regression checks

Local development can continue using Flask for both pages and API routes.
The Vercel routing file has no effect on `python backend/app.py`.

```powershell
.\backend\venv\Scripts\python.exe -m unittest discover -s tests -v
.\backend\venv\Scripts\python.exe tests/run_notifications_browser.py
.\backend\venv\Scripts\python.exe tests/run_notifications_browser.py --suite health-readings
.\backend\venv\Scripts\python.exe tests/run_notifications_browser.py --suite sidebar
```

Browser checks require Google Chrome at the path configured in the runner.
These checks use mocked API/database responses; they do not replace the
live Vercel-to-Render-to-MySQL verification above.

## 7. Updates and troubleshooting

Deploy compatible backend changes to Render first, then deploy the matching
frontend to Vercel. Keep the Flask secret and database credentials stable.
Back up MySQL before schema changes. Roll back application code separately
from database data; a frontend rollback should not replace patient records.

| Problem | Check |
| --- | --- |
| Vercel pages return 404 | Root Directory is `frontend`; `frontend/vercel.json` has all six page rewrites. |
| Vercel `/api/health` returns 404 | API rewrite includes `/api/` in its Render destination and was redeployed. |
| API calls return 502 or time out | Render service is running, the hostname is correct, and it listens on `$PORT`. |
| Render cannot import `backend` | Render Root Directory is blank and Start Command uses `backend.app:app`. |
| Gunicorn is missing | Render Build Command installs it alongside `backend/requirements.txt`. |
| Login succeeds but the next request is unauthenticated | Requests stay on the Vercel origin; cookie domain is unset; secure cookies use HTTPS; workers share a secret. |
| Browser shows a CORS error | Frontend is calling Render directly instead of the Vercel `/api/` proxy. |
| Database check fails | Render can reach `DB_HOST:DB_PORT`; credentials and database name match. |
| Database connects but registration or saving fails | The expected tables, columns, indexes, and permissions exist. |
| A reading is rejected as a future date | Server clock/timezone matches the browser's local measurement times. |
| Pages show old data or scripts | Disable API rewrite caching, refresh open pages, and verify both hosts run matching releases. |
