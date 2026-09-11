# Afromia Training Manager

Training-center and finance management system for Afromia Domestic Works
Training Institute. A standalone Node.js/Express + PostgreSQL app — no
dependency on any external platform.

## Stack

- **Backend**: Express, serving a small generic JSON-document API
  (`/api/db/:collection[/:docId]`) backed by a single Postgres table, plus
  `/api/auth/*` for login.
- **Frontend**: one self-contained HTML/CSS/JS file in `public/index.html`
  (no build step, no framework).
- **Auth**: username + password, hashed with bcrypt, sessions as JWTs.

## Local development

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL (a local Postgres) and JWT_SECRET
npm start
```

Then open http://localhost:3000. On first run, the database is empty except
for the real Afromia data seeded automatically from `server/seed-data.json`
(branches, batches, trainees, revenue/expense/kitchen logs, overhead) — no
staff accounts. The login screen will prompt you to create the first
administrator account.

## Deploying on Railway

1. Add a Postgres database to the project (Railway → New → Database →
   Postgres).
2. On this app's service, set environment variables:
   - `DATABASE_URL` → `${{Postgres.DATABASE_URL}}` (reference to the Postgres
     plugin)
   - `JWT_SECRET` → a long random string
3. Deploy. On first boot the app creates its schema and seeds the real
   Afromia data automatically (only if the `documents` table is empty, so
   this is safe to leave in place — it will never overwrite live data on
   later deploys).
4. Generate a public domain for the service and open it. Create the first
   administrator account from the login screen.

## Data model

Everything is stored as JSON documents in one Postgres table:

```sql
documents (collection TEXT, doc_id TEXT, data JSONB, updated_at TIMESTAMPTZ,
           PRIMARY KEY (collection, doc_id))
```

Collections: `branches`, `staff`, `modules` (curriculum), `cohorts`
(training batches), `trainees`, `dormRooms`, `revenueLog`, `expenseLog`,
`kitchenItems`, `overhead`, `settings`, `attendance`, `assessments`.

Writes to every collection except `attendance` and `assessments` require an
administrator account; those two (day-to-day attendance/assessment entry)
are open to any signed-in staff member, matching how the app's UI is
already gated.
