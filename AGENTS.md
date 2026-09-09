# AGENTS.md — Institutional Procurement Management System

## Run

- `docker compose up --build` → frontend on `http://localhost:3000`, backend on `http://localhost:8000`.
- Never run `docker compose down -v` — it wipes the `postgres_data` volume.
- Demo accounts all use password `password` (e.g. `admin@example.com`, `department@example.com`).

## Architecture

- **Backend** (`backend/`): FastAPI + SQLAlchemy 2.0, Python 3.12. Entry: `backend/app/main.py`. ASGI server: `uvicorn app.main:app --reload` (port 8000).
- **Frontend** (`frontend/`): Next.js 15 App Router, single-page app at `frontend/app/page.tsx`. No CSS framework, no state library — inline styles only. `NEXT_PUBLIC_API_URL` points to `http://localhost:8000/api/v1`.
- **DB**: PostgreSQL 16. Schema is created via `Base.metadata.create_all` at startup; there is **no Alembic, no migrations tool**. Upgrades are idempotent `ALTER TABLE ... IF NOT EXISTS` statements in `backend/app/main.py:29`. New columns must be added there to be safe across existing databases.
- **Modules**: `app/modules/requisitions` (lifecycle CRUD + PDF/CSV export), `app/modules/users` (models + `admin_router`), `app/modules/workflow` (state machine), `app/modules/audit`, `app/modules/procurement_models` (11 execution tables).

## Key quirks

- **No test suite, no linter, no typecheck.** There is no `pytest`, no `pyproject.toml`, no CI. Nothing to run for verification beyond starting the app.
- **Env loading**: backend reads `.env` via `pydantic-settings` (`SettingsConfigDict(env_file=".env")`). The `Settings` defaults match `.env.example` — copy it to `.env` to override.
- **Startup runs `seed_demo_data()`** on every boot; it is idempotent (checks existence before inserting), so re-running is safe.
- **Financial year** runs April–March (`backend/app/modules/requisitions/router.py:22`).
- **Procurement IDs** are generated via a PostgreSQL `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` upsert on `procurement_sequences` — concurrency-safe, no separate sequence object.
- **Workflow** is a dict of `(status, action) -> status` transitions in `backend/app/modules/workflow/service.py:8`. Adding a new state or action means editing both this dict and the router endpoint.
- **RBAC**: `require_roles(*roles)` in `backend/app/core/security.py:43`. Roles: `DEPARTMENT_USER`, `HOD`, `PRINCIPAL`, `FINANCE`, `PURCHASE_COMMITTEE`, `STORE_OFFICER`, `ACCEPTANCE_OFFICER`, `BURSAR`, `AMC_OFFICER`, `ADMIN`. Some endpoints accept multiple roles (e.g. finance review also allows `BURSAR`, `ACCOUNTANT`, `ADMIN`, `PRINCIPAL`).
- **Auth**: JWT HS256, 60-min expiry, token stored in `localStorage`. `get_current_user` decodes and re-fetches the user from DB each request.
- **Institution scoping**: almost every query filters on `user.institution_id`. An admin can only manage master data for their own institution.
- **`RequisitionCreate.category`** is validated `^(LAB|NON_LAB)$`.
- **Password rules**: 8–72 bytes (bcrypt's 72-byte limit is the reason for the byte check, not char count).

## Conventions

- Backend uses UUID v4 string primary keys everywhere.
- Money is `Numeric(18,2)`; prices are `Decimal`.
- Frontend is one file (`page.tsx`) with `ReqCard`, `AdminPanel`, `DepartmentPanel` as inline components. API calls use raw `fetch` with `Authorization: Bearer <token>`.
- No build step beyond `npm run build` / `pip install`. No codegen.