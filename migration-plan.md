# Smart Patient migration plan

Target: HTML, CSS, and JavaScript frontend; Node.js and Express backend;
MongoDB database. This is a plan only; implementation and database migration
have not started.

## Scope and approach

The frontend already uses the requested technologies. Keep its ten pages,
styles, notifications, sidebar, charts, and relative `/api/` requests. Replace
the canonical `backend/smart_patient/` Flask application and MySQL storage
with an Express application and MongoDB. Develop the replacement separately
until it passes the existing behavior checks.

Preserve registration, login/logout, patient sessions, reading create/read/
edit/delete, dashboard, records, trends, academic alerts, profile editing,
password changes, and private photo upload/removal. Consultation currently
saves demonstration requests in browser localStorage; preserve this behavior
for migration parity. Moving those requests to MongoDB is an optional later
feature, not evidence that real doctor bookings exist.

Continue the intended hosting arrangement: Vercel serves the frontend and
proxies `/api/*` to Express on Render; Express connects to MongoDB. Locally,
Express should serve the frontend and APIs together.

```text
Browser -> Vercel: HTML / CSS / JavaScript
                -> /api/* rewrite -> Render: Node.js / Express -> MongoDB
```

## Phase 1: Inventory and capture current behavior

- Identify the canonical backend and the duplicate Python packages at the
  repository root. Use `backend/smart_patient/` as the behavior reference.
- Record request bodies, response bodies, status codes, cookies, headers,
  validation rules, and errors for every endpoint listed below.
- Record all page URLs and the expected signed-in and signed-out behavior.
- Run the existing isolated backend and browser checks; record any existing
  failures separately from migration regressions.
- Inspect the source schema and data types without changing records. Inventory
  ID ranges, password-hash formats, decimal precision, nullable fields, photo
  sizes, and source timestamp timezone. Resolve ambiguity before conversion.
- Create a migration branch and verify that a database backup can be restored
  into an isolated environment. Use anonymized or synthetic development data.

**Deliverables:** API contract, feature checklist, schema inventory, and test baseline.

**Completion check:** Every current feature has a documented expected result;
the restore procedure works.

## Phase 2: Establish the Node.js and Express foundation

- Create `backend-node/` alongside the existing Python backend during migration.
  Use JavaScript modules and pin a tested Node.js LTS release and dependency lockfile.
- Add Express, the official MongoDB Node.js driver, environment configuration,
  request validation, session middleware, and a MongoDB session store.
- Separate application construction from the listening server so integration
  tests can start an isolated application.
- Add central error handling, bounded request bodies, configuration validation,
  structured logs without credentials or patient records, and graceful shutdown.
- Use `PORT` supplied by the host and listen on `0.0.0.0`. Add `/api/health`
  for process health and `/api/db-check` for MongoDB connectivity.
- Define scripts: `npm run dev`, `npm start`, `npm test`, and database setup/
  migration commands. Document them only once implemented and verified.

Suggested structure:

```text
backend-node/
  package.json
  package-lock.json
  .env.example
  src/
    app.js
    server.js
    config/
    db/
    middleware/
    routes/
    services/
    repositories/
    validators/
  scripts/
  tests/
frontend/                       # existing pages and assets
```

**Deliverables:** Runnable Express skeleton and isolated test setup.

**Completion check:** Startup rejects missing settings clearly, health endpoints
work, and the server closes connections cleanly.

Use an Active or Maintenance LTS runtime for production, following the
[Node.js release policy](https://nodejs.org/en/about/previous-releases).

## Phase 3: Design MongoDB collections and compatibility rules

| Collection | Contents | Required indexes |
| --- | --- | --- |
| `patients` | Public numeric `id`, name, normalized email, password hash, nullable profile fields, normalized photo bytes and version | Unique `id`; unique normalized email |
| `health_readings` | Public numeric `id`, numeric `patient_id`, five measurements, measurement timestamp | Unique `id`; `{ patient_id: 1, measured_at: -1, id: -1 }`; `{ patient_id: 1, id: -1 }` |
| `counters` | Next public numeric patient/reading sequences | Unique sequence name via `_id` |
| `sessions` | Server-side session records and expiry | Store-managed expiry index |

- Keep readings in a separate collection to avoid an ever-growing patient document.
- Preserve existing numeric public IDs: browser code calls `Number(id)`, subtracts
  IDs for sorting, and uses the highest reading ID for alerts. MongoDB `_id`
  values remain internal. Allocate new IDs with an atomic counter initialized
  above imported maxima; allow gaps and reject values outside JavaScript's safe
  integer range. Do not infer business ordering from ObjectIds.
- Keep snake_case API field names. Use explicit serializers so database details,
  password hashes, and raw photo bytes never leak through normal JSON responses.
- Preserve SQL decimal values as Decimal128 where appropriate; return finite JSON
  numbers compatible with the frontend after checking source precision/ranges.
- Store measurement instants as BSON Dates after resolving the source timezone.
  Preserve the existing `YYYY-MM-DDTHH:mm` API contract by converting explicitly
  to/from that agreed application timezone. Keep birth dates as `YYYY-MM-DD`
  calendar strings. Do not parse legacy timestamps as UTC by accident.
- Store each normalized avatar and its version together in the patient document
  so replacement is atomic; enforce the existing upload and image-size limits.
- Add database schema validation and unique indexes. Detect duplicate normalized
  emails and orphan readings during rehearsal; produce a reconciliation report
  rather than silently merging or discarding records.
- Enforce patient references in application code; MongoDB does not recreate SQL
  foreign-key behavior automatically. Use multi-document transactions only for
  operations that actually require coordinated document changes.

**Deliverables:** Collection definitions, index setup, serializers, and repository layer.

**Completion check:** Invalid documents and duplicate emails are rejected, numeric
IDs remain compatible, and representative date/decimal conversions round-trip.

References: [MongoDB schema validation](https://www.mongodb.com/docs/manual/core/schema-validation/),
[unique indexes](https://www.mongodb.com/docs/manual/core/index-unique/), and
[atomic operations](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/).

## Phase 4: Migrate authentication and sessions

- Implement registration, login, current patient, logout, and password changes
  with the existing API contracts and email normalization.
- Import existing Werkzeug password hashes unchanged. Implement a narrowly scoped
  verifier for the actual inventoried scrypt/PBKDF2 formats and test it using
  synthetic hashes generated by Python. Node crypto provides the underlying
  primitives, but its output is not automatically a Werkzeug-format verifier.
- Define a versioned password-hash format for new passwords using asynchronous
  scrypt with explicit reviewed parameters, random salts, resource limits, and
  constant-time comparisons. Never hash an existing hash as a substitute for
  verifying the original password. A password reset is a fallback only for
  formats that cannot be migrated safely.
- Use server-side sessions stored in MongoDB. Regenerate the session ID on login,
  persist before responding, destroy it on logout, and enforce expiry during
  requests rather than relying on eventual database expiry cleanup.
- Use a distinct session cookie name; users sign in again after cutover because
  Flask cookies and Express sessions are different formats.
- Configure HTTPS cookies (`HttpOnly`, `Secure`, `SameSite=Lax`) with no Render
  cookie domain. Configure proxy trust for the verified Render/Vercel topology;
  do not trust arbitrary forwarded headers.
- Preserve CSRF tokens, exact public-origin checks, custom action headers, and
  patient ownership checks. Add login rate limits and generic login errors.
- For password changes, condition the database update on the previously verified
  hash so concurrent requests cannot both change an obsolete password.

**Deliverables:** Authentication middleware and compatible account endpoints.

**Completion check:** Imported test passwords work; wrong passwords fail; sessions
survive backend restarts; logout/expiry and concurrent password-change tests pass.

References: [Express sessions](https://expressjs.com/en/resources/middleware/session/),
[Werkzeug password hashing](https://werkzeug.palletsprojects.com/en/stable/utils/#werkzeug.security.generate_password_hash),
and [Node.js crypto](https://nodejs.org/api/crypto.html).

## Phase 5: Migrate readings and patient profile features

- Port reading validation and create/list/edit/delete operations. Scope every
  query or mutation to the patient identity from the server session.
- Preserve measurement-date/ID ordering and the separate highest-ID alert rule,
  including backdated readings. Keep the existing academic thresholds and wording.
- Preserve confirmed deletion, custom edit/delete headers, unchanged-update
  success, and identical 404 behavior for missing and other-patient records.
- Port profile field validation, immutable email, optional-field clearing, and
  profile CSRF token responses. Do not accept client-supplied patient identities.
- Replace Pillow processing with a Node image pipeline, such as Sharp, plus a
  bounded multipart parser. Preserve content/extension checks, the 2 MiB upload
  cap, 16-million-pixel/8192-side limits, animation rejection, orientation,
  512-pixel thumbnail bounds, WebP output, and metadata removal.
- Serve photos only through the authenticated API with the existing private
  cache and content headers. Update photo bytes/version together.
- Preserve `Cache-Control: no-store` for account, profile, photo, and reading APIs.

**Deliverables:** All current feature APIs backed by MongoDB.

**Completion check:** Feature and patient-isolation tests pass, including invalid
images, duplicate submissions, failed writes, and concurrent updates.

Reference for the proposed image pipeline:
[Sharp output and metadata behavior](https://sharp.pixelplumbing.com/api-output/).

## Phase 6: Connect and verify the existing frontend

- Keep the ten current HTML pages and `/assets/` paths. Add equivalent Express
  page serving and protected-page behavior for local development.
- Keep browser calls to relative `/api/` URLs and same-origin credentials.
- Check registration feedback, session redirects, reading edit/delete dialogs,
  cross-tab refresh, dashboard cards, trend charts, alerts, profile, photos,
  password changes, sidebar navigation, and mobile layouts against Express.
- Preserve the consultation demonstration and browser-local requests. Do not
  automatically associate shared-browser localStorage entries with a patient.
- Adapt the browser runner to support the Node server without depending on the
  Python runtime; reuse the existing browser fixture suites where appropriate.

**Deliverables:** Complete frontend running against Express without a redesign.

**Completion check:** Every page and workflow works on desktop/mobile, with no
new CORS requirement or API response-shape mismatch.

## Phase 7: Rehearse the MySQL-to-MongoDB data migration

- Build a separate migration utility with source read-only credentials and a
  dedicated destination database. Temporary migration tooling may read MySQL;
  the finished application runtime must use MongoDB only.
- Export a consistent snapshot of patients/readings, hashes, profile fields,
  photos, versions, and IDs. Keep a manifest and source high-water marks.
- Convert dates, decimals, nullable values, and binary photos according to phase
  3. Initialize numeric counters above imported maxima.
- Make imports resumable and repeatable against a clean migration destination,
  keyed by source IDs. Record checkpoints and errors; never overwrite a live
  MongoDB database with application writes during a rerun.
- Compare total and per-patient counts, references, full field values, ID maxima,
  photo digests, and hash strings. Test known synthetic imported credentials.
- Rehearse on representative data and measure export/import/verification time
  to determine a realistic maintenance window. Resolve every discrepancy before
  cutover; do not silently skip rejected records.

**Deliverables:** Migration utility, reconciliation report, timing, and restore runbook.

**Completion check:** Repeated rehearsals produce matching data and no orphaned
records; rollback restoration has been exercised.

## Phase 8: Stage and perform the production cutover

- Run the Node backend in a separate Render staging service against a separate
  MongoDB database. Keep production pointing at Flask during validation.
- Configure proposed backend variables: `NODE_ENV=production`, `MONGODB_URI`,
  `SESSION_SECRET`, `PUBLIC_ORIGIN`, and the agreed application timezone. Keep
  secrets on Render and retain the frontend API proxy/no-cache configuration.
- Once scripts exist, use Render build command `npm ci` and start command
  `npm start`, with Root Directory `backend-node`. Configure health checks and
  verify MongoDB network access from Render.
- Verify Vercel-to-Render cookies, CSRF/origin checks, image upload, and protected
  mutations over HTTPS. Port critical Python regression scenarios to JavaScript
  and run meaningful integration tests against an isolated real MongoDB instance.
- For final cutover, pause all source writes and show a maintenance state. Take
  a fresh consistent export, import it into the final MongoDB destination, and
  complete reconciliation while MySQL remains frozen.
- Switch Vercel's API rewrite to the Node service, update the public origin,
  require a fresh login, and run smoke checks with disposable accounts before
  opening writes. Keep the old backend inaccessible to normal application writes
  so an old deployment or direct URL cannot continue changing MySQL.
- Monitor failed logins, API errors, latency, session persistence, and database
  failures. Define acceptable thresholds and an observation period in the runbook.

**Deliverables:** Validated staging release, updated deployment instructions,
and production release checklist.

**Completion check:** Reconciliation and all critical HTTPS workflows pass, and
the designated observation period completes within the agreed thresholds.

### Rollback boundary

Before accepting MongoDB writes, rollback can restore the Flask deployment and
the frozen MySQL source. Once MongoDB accepts new writes, simply repointing at
old MySQL would lose registrations, edits, deletions, and password changes.
Freeze writes again and use a rehearsed reverse reconciliation of every change
and deletion, or restore the previous compatible Node release while keeping
MongoDB authoritative. Choose and test the post-write recovery path before
cutover; do not treat a frontend rollback as a database rollback.

## Phase 9: Retire the old stack and finish documentation

- After the observation period and backup verification, archive the old backend
  and source database under the agreed retention policy.
- Remove duplicate Python packages, Flask/MySQL runtime dependencies, obsolete
  commands, and old service credentials from the active application. Retain a
  recoverable release tag and migration records without committing secrets.
- Make one clear Node backend directory the final source of truth; update any
  paths if renaming `backend-node/` to `backend/`.
- Update README, deployment instructions, environment examples, database setup,
  test commands, backup/restore procedures, and API documentation.
- Ensure frontend and backend development, tests, and production startup no
  longer require Python or MySQL. Keep migration tooling separate if retained.

**Deliverables:** Complete target-stack repository and operating documentation.

**Completion check:** A fresh checkout can be configured, tested, and run with
Node.js and MongoDB; all original user workflows pass.

## API parity checklist

| Method | Route | Migration responsibility |
| --- | --- | --- |
| GET | `/api/health` | Process health |
| GET | `/api/db-check` | MongoDB connectivity |
| POST | `/api/register` | Create patient with unique email |
| POST | `/api/login` | Verify migrated/new hash and establish session |
| GET | `/api/me` | Current patient and private photo URL |
| POST | `/api/logout` | Destroy session |
| POST | `/api/change-password` | CSRF-protected, concurrency-safe password change |
| GET, POST | `/api/readings` | Patient-scoped history and creation |
| PUT, DELETE | `/api/readings/:reading_id` | Patient-scoped edit and confirmed delete |
| GET, PUT | `/api/profile` | Profile, CSRF token, validated edits |
| GET, POST, DELETE | `/api/profile/photo` | Private avatar serving, upload, removal |

Implement in phase order. Later feature phases can use fixtures while phase 7
prepares migration tooling, but production cutover depends on every preceding
completion check. Database size and existing data quality determine the final
cutover duration; measure them during rehearsal rather than assuming downtime.
