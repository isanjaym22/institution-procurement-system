# Tech Stack — Institutional Procurement Management System (v0.4 / v0.6)

> Full lifecycle: Department requisition → HOD → Principal → Finance/Budget → Purchase/Tender Committee → Vendor → PO → Delivery → Acceptance → Stock/Asset → Bill → Verification → Payment → Utilization Certificate → AMC → Closure. One `Procurement File ID` follows the lifecycle.

## 1. Infrastructure / DevOps

| Technology | Version / Detail | Where Used |
|---|---|---|
| **Docker + Docker Compose** | `docker-compose.yml:1` | Orchestrates 3 services (`db`, `backend`, `frontend`), named volume `postgres_data` (`docker-compose.yml:42`) |
| **PostgreSQL** | `postgres:16-alpine` (`docker-compose.yml:3`) | `db` service `5432:5432` (`docker-compose.yml:9`), healthcheck `pg_isready` (`docker-compose.yml:12`), env `POSTGRES_DB/USER/PASSWORD` (`docker-compose.yml:4`, `.env.example:1`) |
| **pgcrypto** | Postgres extension | `backend/sql/schema.sql:1` `CREATE EXTENSION IF NOT EXISTS pgcrypto` (UUID support; real DDL is SQLAlchemy `create_all`) |
| **Python base image** | `python:3.12-slim` (`backend/Dockerfile:1`) | Backend container — `pip install --no-cache-dir -r requirements.txt` (`backend/Dockerfile:4`) |
| **Node base image** | `node:22-alpine` (`frontend/Dockerfile:1`) | Frontend container — `npm install && npm run build && npm start` (`frontend/Dockerfile:4`) |
| **Environment config** | `.env.example:1` | `POSTGRES_DB`, `DATABASE_URL=postgresql+psycopg://...`, `JWT_SECRET`, `JWT_EXPIRE_MINUTES`, `CORS_ORIGINS` consumed via `pydantic-settings` |

## 2. Backend

### 2.1 Dependencies — `backend/requirements.txt:1`

| Technology | Version | Where Used |
|---|---|---|
| **FastAPI** | `0.116.1` | Web framework: `backend/app/main.py:1` (`FastAPI`, `Depends`, `HTTPException`), `CORSMiddleware` (`backend/app/main.py:3`), `OAuth2PasswordRequestForm` (`backend/app/main.py:4`), `APIRouter` in `backend/app/modules/requisitions/router.py:1` and `backend/app/modules/users/admin_router.py:1`, `HTTPException` in `backend/app/modules/workflow/service.py:1` |
| **Uvicorn [standard]** | `0.35.0` | ASGI server: `backend/Dockerfile:6` `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]` |
| **SQLAlchemy** | `2.0.43` | ORM everywhere: `backend/app/core/db.py:1` (`create_engine`, `DeclarativeBase`, `sessionmaker`), all models (`Mapped`, `mapped_column`) — `backend/app/modules/users/models.py:1`, `backend/app/modules/requisitions/models.py:1`, `backend/app/modules/procurement_models.py:1`, `backend/app/modules/workflow/models.py:1`, `backend/app/modules/audit/models.py:1`; raw `text()` for startup migrations (`backend/app/main.py:6`) and sequence (`backend/app/modules/requisitions/router.py`) |
| **psycopg [binary]** | `3.2.9` | Postgres driver — no direct import; via DSN `postgresql+psycopg://` in `backend/app/core/config.py:4` → `backend/app/core/db.py:5` `create_engine(settings.database_url)` (`docker-compose.yml:21` `DATABASE_URL`) |
| **pydantic + pydantic-settings** | `2.10.1` | Validation/settings: `backend/app/core/config.py:1` (`BaseSettings`, `SettingsConfigDict`), `backend/app/modules/requisitions/schemas.py:1` (`BaseModel`, `Field`, `ConfigDict`), `backend/app/modules/users/schemas.py:1` (`BaseModel`, `EmailStr`), `backend/app/main.py:2` (`PasswordChangeIn`), `backend/app/modules/users/admin_router.py:1` (inline `DepartmentIn`/`StaffIn`) |
| **python-jose [cryptography]** | `3.5.0` | JWT: `backend/app/core/security.py:2` (`jwt.encode`, `jwt.decode`, `JWTError`, `HS256`) |
| **passlib + bcrypt** | `1.7.4` / `4.0.1` | Password hashing: `backend/app/core/security.py:3` `CryptContext(schemes=["bcrypt"])` (`backend/app/core/security.py:12`), `hash_password`/`verify_password` (`backend/app/core/security.py:15`), seeded in `backend/app/main.py:102` and `backend/app/modules/users/admin_router.py` |
| **python-multipart** | `0.0.20` | Form parsing for `OAuth2PasswordRequestForm` login (`backend/app/main.py:128`) |
| **reportlab** | `4.4.3` | PDF generation: `backend/app/modules/requisitions/router.py` (`reportlab.lib.pagesizes.A4`, `reportlab.pdfgen.canvas.Canvas`) → `GET /requisitions/{id}/pdf` |
| **email-validator** | `2.2.0` | Email validation via `EmailStr` in `backend/app/modules/users/schemas.py:1` and `backend/app/modules/users/admin_router.py:1` |

### 2.2 Backend Structure & Usage

| Area | File | Technology / Detail |
|---|---|---|
| **Config** | `backend/app/core/config.py:3` | `class Settings(BaseSettings)` — `database_url`, `jwt_secret`, `jwt_expire_minutes=60`, `cors_origins`; `SettingsConfigDict(env_file=".env")` |
| **DB layer** | `backend/app/core/db.py:5` | `engine = create_engine(settings.database_url, pool_pre_ping=True)`, `Base(DeclarativeBase)`, `SessionLocal = sessionmaker(...)`, `get_db()` generator (DI via `Depends(get_db)`) |
| **Auth / Security** | `backend/app/core/security.py:13` | `OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")`, `create_access_token(user_id)` (exp `timedelta(minutes=60)`), `get_current_user` (decode + `db.get(User, sub)`), `require_roles(*roles)` RBAC factory |
| **App bootstrap** | `backend/app/main.py:17` | `FastAPI(title="Institution Procurement Management System", version="0.4.0")`, `CORSMiddleware` (`backend/app/main.py:19`), `@app.on_event("startup")` (`backend/app/main.py:25`) → `Base.metadata.create_all` + idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` (`backend/app/main.py:29`) + snapshot backfill `UPDATE ... FROM institutions, departments, users` (`backend/app/main.py:53`) + `seed_demo_data()` |
| **Seed data** | `backend/app/main.py:66` | Institution `GM`, 3 Depts (CS/PHY/MATH), 14 demo users (department/hod/finance/purchase/store/bursar/acceptance/amc/principal/admin), HOD assignments, `Designation` master |
| **Auth endpoints** | `backend/app/main.py:127` | `POST /api/v1/auth/login` (form + `verify_password` + `create_access_token`), `GET /api/v1/auth/me`, `POST /api/v1/auth/change-password` (8–72 byte check) |
| **Department/Faculty** | `backend/app/main.py:156` | `GET /api/v1/departments`, `GET /api/v1/faculty` (institution-scoped, role-filtered) |
| **Requisitions — models** | `backend/app/modules/requisitions/models.py:1` | `ProcurementSequence` (unique `institution_id, financial_year, department_code`), `Requisition` (snapshots `institution_name`, `department_name/code`, `faculty_name/employee_id/designation`, `hod_remarks`, `hod_decision_by/at`, `principal_remarks`), `RequisitionItem` (`Numeric(18,2) tentative_unit_price`, `line_total` property) |
| **Requisitions — schemas** | `backend/app/modules/requisitions/schemas.py:1` | `RequisitionCreate` (`category ^(LAB\|NON_LAB)$`, `items min_length=1`), `PrincipalDecision`, `FinanceReviewIn`, `ProcurementDecisionIn`, `VendorSelectionIn`, `PurchaseOrderIn`, `DeliveryIn`, `AcceptanceIn`, `StockEntryIn`, `BillIn`, `PaymentIn`, `UCIn`, `AMCIn` |
| **Requisitions — router** | `backend/app/modules/requisitions/router.py:1` | `APIRouter(prefix="/requisitions")`, helpers `financial_year()`, `next_procurement_id()` (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`), `get_req()`; endpoints: `POST /`, `GET /hod/pending`, `GET /principal/pending`, `GET /`, `GET /{id}`, `POST /{id}/submit`, `hod/*`, `principal/*`, `GET /{id}/pdf` (reportlab), `GET /export/csv` (`csv`, `StreamingResponse`), + 13 post-principal routes (`/finance/review`, `/procurement/method`, `/procurement/vendor`, `/procurement/po`, `/delivery`, `/acceptance`, `/stock`, `/bill`, `/bill/verify`, `/payment`, `/uc`, `/amc`, `/close`) with `require_roles` + `409` status guards + `transition()` |
| **Procurement models** | `backend/app/modules/procurement_models.py:1` | 11 tables (`FinanceReview`, `ProcurementDecision`, `Vendor`, `PurchaseOrder`, `DeliveryReceipt`, `Acceptance`, `StockEntry`, `Bill`, `Payment`, `UtilizationCertificate`, `AMC`) — all `String(36)` PK `uuid4`, `ForeignKey('requisitions.id')` |
| **Workflow** | `backend/app/modules/workflow/service.py:1` | State machine `TRANSITIONS = {(from, action): to_status}` (25 transitions `DRAFT→CLOSED`), `transition(db, req, action, actor)` validates, updates `req.status`, sets `hod_*/principal_*` timestamps, writes `WorkflowEvent` + `AuditLog` (`before_data`/`after_data`) |
| **Audit** | `backend/app/modules/audit/models.py:1` | `AuditLog` — `institution_id`, `entity_type`, `entity_id` (index), `action`, `actor_id`, `before_data JSON`, `after_data JSON`, `remarks`, `created_at` |
| **Users — models** | `backend/app/modules/users/models.py:1` | `Institution` (unique `code`), `Department` (`UniqueConstraint(institution_id, code)`, `is_active`, `hod_user_id`), `Designation` (`UniqueConstraint(institution_id, name)`), `User` (`institution_id`, `department_id` nullable, `employee_id`, `designation`, `email` unique, `role`, `is_active`) |
| **Users — schemas** | `backend/app/modules/users/schemas.py:1` | `LoginResponse` (`access_token`, `token_type="bearer"`, `user: UserOut`), `UserOut`, `DepartmentOut`, `FacultyOut` |
| **Admin router** | `backend/app/modules/users/admin_router.py:1` | `APIRouter(prefix="/admin")`, all `require_roles("ADMIN")` + institution scoping; `GET/POST /departments`, `PUT /departments/{id}`, `GET/POST/PUT /designations`, `GET/POST /staff` (`func.lower(email)` uniqueness), `POST /staff/{id}/password` (8–72 bytes, `AuditLog PASSWORD_CHANGED_BY_ADMIN`), `POST /departments/{dept}/assign-hod/{user}` |

## 3. Frontend

### 3.1 Dependencies — `frontend/package.json:1`

| Technology | Version | Where Used |
|---|---|---|
| **Next.js** | `15.5.2` | App Router framework: `frontend/Dockerfile:6` `npm run build`, `frontend/app/layout.tsx:8` `RootLayout`, `frontend/app/page.tsx:1` `"use client"` |
| **React + ReactDOM** | `19.1.1` | UI: `frontend/app/page.tsx:2` (`useState`, `useEffect`, `FormEvent`), components `ReqCard`, `AdminPanel`, `DepartmentPanel` (`frontend/app/page.tsx:22`) |
| **TypeScript** | `^5.0.0` | Strict types: `frontend/tsconfig.json:3` (`strict:true`, `target ES2020`, `jsx:preserve`, `moduleResolution: bundler`), `frontend/next-env.d.ts:1`, types `User`/`Req`/`Item`/`Department` (`frontend/app/page.tsx:4`) |
| **@types/node, @types/react, @types/react-dom** | `^22.0.0` / `^19.0.0` | Dev types (`frontend/package.json:14`) |

### 3.2 Frontend Structure & Usage

| Area | File | Technology / Detail |
|---|---|---|
| **Layout** | `frontend/app/layout.tsx:8` | `RootLayout` — `<html lang="en">`, inline `background:#f5f7fa`, `metadata {title, description}` |
| **Dashboard** | `frontend/app/page.tsx:9` | Single-page app: `NEXT_PUBLIC_API_URL` (`frontend/app/page.tsx:3`, `docker-compose.yml:36` `http://localhost:8000/api/v1`), `localStorage` token (`frontend/app/page.tsx:12`), `fetch` for all API calls, role-aware queue (`HOD → /hod/pending`, `PRINCIPAL → /principal/pending`) (`frontend/app/page.tsx:11`), `filter` by department for Principal (`frontend/app/page.tsx:20`) |
| **Auth UI** | `frontend/app/page.tsx:15` | Login form (`email`/`password` → `URLSearchParams` → `POST /auth/login`), demo accounts hint, `Logout` (`localStorage.removeItem`) |
| **Procurement actions** | `frontend/app/page.tsx:22` | `ReqCard` renders `procurement_id`, snapshots (`department_name_snapshot`, `faculty_*_snapshot`), `items`, `labels` map (`frontend/app/page.tsx:8`), action buttons per role/status (`DEPARTMENT_USER DRAFT→submit`, `HOD SUBMITTED→approve/return/reject`, `PRINCIPAL→finance`, `FINANCE→budget`, `PURCHASE_COMMITTEE→method/vendor/PO`, `STORE→delivery/stock`, `ACCEPTANCE→accept`, `BURSAR→bill/verify/payment/UC`, `PRINCIPAL/BURSAR→close`) |
| **Admin panel** | `frontend/app/page.tsx:40` | `AdminPanel` — `fetch /admin/departments|staff|designations` (`frontend/app/page.tsx:47`), `POST /admin/departments|designations|staff`, `POST /admin/departments/{id}/assign-hod/{user}`, `POST /auth/change-password` + `POST /admin/staff/{id}/password` |
| **Department panel** | `frontend/app/page.tsx:62` | `DepartmentPanel` — `POST /requisitions` (`category`, `justification`, `items[]`) |
| **Styling** | `frontend/app/page.tsx:63` | No CSS framework — inline style objects `wrap`, `card`, `input`, `button`, `badge`, `meta` |
| **Config** | `frontend/tsconfig.json:1` | `ES2020`, `dom` libs, `noEmit`, `plugins: next` |
| **Build** | `frontend/Dockerfile:1` | `node:22-alpine`, `COPY package*.json`, `RUN npm install`, `COPY .`, `RUN npm run build`, `CMD ["npm","start"]` → `3000:3000` (`docker-compose.yml:38`) |

## 4. Cross-Cutting

| Technology / Pattern | Where Used |
|---|---|
| **JWT Bearer Auth (HS256)** | `backend/app/core/security.py:22` `jwt.encode({"sub": user_id, "exp": exp})`, `backend/app/main.py:132` login returns `LoginResponse`, `frontend/app/page.tsx:11` `Authorization: Bearer <token>` |
| **CORS** | `backend/app/main.py:19` `CORSMiddleware(allow_origins=[x.strip() for x in settings.cors_origins.split(",")])`, `docker-compose.yml:24` `CORS_ORIGINS=http://localhost:3000` |
| **RBAC (10 roles)** | `DEPARTMENT_USER`, `HOD`, `PRINCIPAL`, `FINANCE`, `PURCHASE_COMMITTEE`, `STORE_OFFICER`, `BURSAR`, `ACCEPTANCE_OFFICER`, `AMC_OFFICER`, `ADMIN` — enforced via `require_roles` in `backend/app/modules/requisitions/router.py` and `backend/app/modules/users/admin_router.py` |
| **CSV Export** | `backend/app/modules/requisitions/router.py` — `csv` + `io` + `StreamingResponse` → `GET /export/csv` |
| **Stdlib** | `uuid` (PKs in all models), `decimal.Decimal` (prices `Numeric(18,2)`), `datetime`/`timezone`/`date` (expiry, `financial_year`, timestamps `func.now()`), `csv`/`io` (export) |

## 5. What’s Not Used (Notable Absences)

- No Alembic/pytest/pyproject — migrations are idempotent `ALTER TABLE ... IF NOT EXISTS` in `backend/app/main.py:29`.
- No CSS framework, no UI component library, no state library (Zustand/Redux), no ORM alternative, no external validation beyond `pydantic`/`email-validator`.

---
*Generated from `requirements.txt`, `package.json`, `Dockerfile`s, `docker-compose.yml`, `sql/schema.sql`, `app/main.py`, `app/core/*`, `app/modules/*`, `frontend/app/*`.*
