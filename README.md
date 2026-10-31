# SmartHealth / Smart Patient

A plain HTML, CSS, and JavaScript patient portal. **All persistent application
data uses localStorage only**: accounts, salted password verifiers, sessions,
profiles, readings, normalized photos, appointment requests, and import metadata.
There is no application backend, database server, IndexedDB, or sessionStorage.

## Open the project

Serve this project directory as the static document root. For example, with
Node.js/npm available:

```powershell
npx http-server . -a localhost -p 5500 -c-1 --no-dotfiles -d false
```

Open **http://localhost:5500/**, which opens `Pages/index.html`. The direct
**http://localhost:5500/Pages/index.html** address also works. An editor's static
file server can serve the same directory. Do not use the deleted `start.ps1`,
old `frontend/` path, or a server rooted only at `Pages/`: the pages need their
sibling `css/`, `js/`, and `assets/` folders. Use a current browser on localhost
for Web Crypto and Web Locks support. There is no build or installation step
for the application itself.

## Folder structure

```text
index.html                 Root entry linking to the home page
Pages/                     Ten application pages
css/                       Shared and page-specific styles
js/
  app.js                   localStorage collections, authentication, services,
                           session guards, and ordered controller loading
  validators.js            Shared reading/profile/account validation
  portal.js                Shared account controls and responsive sidebar
  script.js                Home navigation and registration/login forms
  health-readings.js       Shared reading actions and edit/delete controls
  add-reading.js           Add Reading form and saved list
  dashboard.js             Overview/history and native interactive SVG charts
  health-alerts.js         Existing academic demonstration rules
  profile.js               Profile editing and password controls
  profile-photo.js         Photo preview/save/cancel/remove controls
  photo-codec.js           Photo validation and metadata-free normalization
  data-transfer.js         Account backups and explicit legacy-request import
  consultation.js          Fictional doctors and local appointment requests
  notifications.js         Accessible notifications and redirect messages
assets/images/             Supplied project images
README.md
```

The six former shared-module files were consolidated into `app.js` and
`portal.js`; obsolete references were removed. Profile helpers load only on
the pages that need them. Every remaining JavaScript file has an active role.
The deleted Plotly file is no longer requested: charts use browser SVG and
JavaScript, with metric/range selection, hover values, zoom, pan, reset, keyboard
controls, and SVG download. No chart CDN, external font, or network API is needed.

## Local accounts and persistence

Create an account, then sign in. The app does not preload patients or readings.
Email addresses are normalized and unique. Passwords use per-account random
salts and PBKDF2-HMAC-SHA-256 with 600,000 iterations; plaintext passwords are
never persisted. Sessions are shared across tabs and expire eight hours after
login. Logout invalidates other open patient pages.

The application saves one versioned JSON snapshot under
`smarthealth_data_v1`. Web Locks serialize writes across tabs. A successful
write replaces the snapshot once; validation, cancelled operations, and failed
writes leave the previous snapshot intact. Increasing record counters prevent
ID reuse after deletion. Corrupt or unsupported stored data produces an error
instead of being silently cleared. Additional `smarthealth_*` localStorage keys
hold small session references, refresh signals, and one-time form/redirect messages.

Photos are validated, resized to at most 512×512, and encoded as WebP/base64
inside localStorage. Blob URLs are temporary display/preview objects and are
not persisted. localStorage has a small browser-controlled quota: photos and
large histories can fill it. A quota error preserves the previous save and
asks you to export data and free space before retrying.

Local sign-in is for normal use of this academic app. It cannot protect data
from someone who controls this browser/computer or developer tools, and account
passwords do not encrypt the stored records. Storage belongs to the exact browser
profile and origin: changing hostname, port, browser, or clearing site data gives
different or empty storage. Keep private backups.

## Features and data transfer

- Dashboard: four latest-measurement cards, chart preview, five recent readings.
- Readings: validated create/edit/delete, confirmation/cancel, persistent history.
- Trends: five metrics, seven-day/full-history ranges, interactive local charts.
- Alerts: highest saved reading ID, including backdated saves; the existing five
  academic rules and their separate empty/incomplete/error/no-match states.
- Profile: six displayed fields, read-only email, edit/cancel, photo workflow,
  and verified password changes.
- Consultation: fictional doctors, Audio/Video requests, account-scoped local
  history, and explicit selection of earlier locally saved appointment requests.
  No real booking or calling service is connected.
- Shared navigation, mobile menus, keyboard focus, notifications, and tab refresh.

Use **My Profile → Export account data** to download profile details, readings,
photo, and appointment requests. Credentials and session tokens are excluded.
To restore, sign in to an account with the same email and no readings or
appointment requests, choose the backup JSON, review its counts, and confirm.
Cancellation makes no changes; repeated imports of the same file are a no-op.
ID conflicts with another account are rejected without partial writes. The file
size limit is 16 MB; actual restoration also depends on available localStorage space.

Earlier IndexedDB/MySQL data is **not automatically read, converted, or deleted**.
Import an existing compatible account JSON backup through My Profile. If you
need a new export from the previous version, use that version to export before
switching. Existing browser data outside the new localStorage key remains untouched.
No claim is made that existing patient records were imported during this change.

## Verification

31 checks passed in Chrome 156.0.8078.76 using a disposable browser profile and
temporary localhost server. IndexedDB and sessionStorage access were deliberately
blocked. Checks covered every page/asset/anchor/controller URL, registration and
login, validation, concurrent localStorage saves, quota-error rollback, editing,
photos after reload, password changes, appointments, backup round trips, chart
controls, mobile navigation, account separation, and cross-tab logout.

No application JavaScript exceptions, API requests, or external resource requests
were observed. The audit used synthetic records and did not modify normal browser
data. Other browser versions and actual browser-disk exhaustion were not tested.
