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
|       |-- routes/
|       |   |-- frontend.py       # Pages, assets, and page access checks
|       |   |-- auth.py           # Registration, login, session, logout
|       |   |-- readings.py       # Read and save health measurements
|       |   `-- system.py         # Application and database health checks
|       `-- validators/
|           `-- readings.py       # Existing measurement validation
|-- frontend/
|   |-- pages/                    # All six HTML pages
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
The application still uses the existing MySQL `patients` and `health_readings`
tables; this reorganization does not change their schema or data.

## Development

Edit markup in `frontend/pages`, styling in `frontend/assets/css`, and browser
behavior in `frontend/assets/js`. The page URLs remain `/index.html`,
`/login.html`, `/register.html`, `/dashboard.html`, `/add-reading.html`, and
`/consultation.html`. Assets are served under `/assets/`; the previous
`/CSS/`, `/css/`, `/JS/`, `/js/`, `/Image/`, and `/image/` URLs also work.

API routes and their request/response formats are unchanged. Configuration
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

## Checks

```powershell
.\backend\venv\Scripts\python.exe -m unittest discover -s tests -v
```

The checks use Flask's test client and mocked database connections, so they
never read or write patient records in MySQL.

To check popup interactions in Google Chrome, including registration,
validation, redirects, and mobile layout:

```powershell
.\backend\venv\Scripts\python.exe tests/run_notifications_browser.py
```

This uses a temporary browser profile and mocked API responses without
connecting to MySQL.

To check health record synchronization, dashboard cards, trends, alerts,
cross-page updates, and error recovery:

```powershell
.\backend\venv\Scripts\python.exe tests/run_notifications_browser.py --suite health-readings
```

