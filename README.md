# Institutional Procurement Management System — v0.3

Cloud-ready MVP for a paperless, auditable procurement lifecycle.

## Lifecycle

Department Faculty/Staff requisition → HOD → Principal → Finance/Budget → Purchase/Tender Committee → Procurement Method → Vendor → Purchase Order → Delivery → Department Acceptance → Stock/Asset Register → Bill → Bill Verification → Payment → Utilization Certificate → AMC (if required) → Closure.

One Procurement File ID follows the complete lifecycle.

## Multi-department model

Institution → Departments → Faculty/Staff → Requisitions. Department and requester identity are derived from authentication and historical snapshots are stored on each requisition.

## Demo accounts

All passwords are `password`:

- department@example.com
- hod@example.com
- principal@example.com
- finance@example.com
- purchase@example.com
- store@example.com
- bursar@example.com
- acceptance@example.com
- amc@example.com

## Run

```bash
docker compose up --build
```

Open `http://localhost:3000`.

Do not use `docker compose down -v` if you want to preserve PostgreSQL data.

This MVP uses startup schema upgrades for development. Production deployment should use Alembic migrations, stronger authorization policy, document storage, notifications, and institution-specific procurement rules before live use.

## v0.4 Administrator / Master Data
Login with `admin@example.com` / `password` to configure master data from the web UI.

Administrator capabilities:
- Create and maintain multiple departments within the institution.
- Create faculty/staff accounts with employee ID, email, designation, department, role and active status.
- Maintain a designation master list.
- Assign a faculty/staff member as HOD for a department; the assignment also updates that user's department and HOD role.
- Institution-scoped administration: an administrator can only manage master data belonging to their institution.
- Existing demo master data remains as initial sample data only; actual institutional data can now be created through the UI.

For production, replace the startup ALTER statements with Alembic migrations and enforce password-change-on-first-login.
