from fastapi import FastAPI, Depends, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.config import settings
from app.core.db import Base, engine, get_db
from app.core.security import verify_password, create_access_token, get_current_user, hash_password
from app.modules.users.models import User, Institution, Department, Designation
from app.modules.users.schemas import LoginResponse, UserOut, DepartmentOut, FacultyOut
from app.modules.requisitions.router import router as requisition_router
from app.modules.users.admin_router import router as admin_router
from app.modules import procurement_models  # noqa: F401

app = FastAPI(title="Institution Procurement Management System", version="0.4.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in settings.cors_origins.split(",")],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    # Non-destructive upgrades for databases created by the earlier MVP.
    statements = [
        "ALTER TABLE departments ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE departments ADD COLUMN IF NOT EXISTS hod_user_id VARCHAR(36)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id VARCHAR(50)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS designation VARCHAR(120)",
        "ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS hod_remarks TEXT",
        "ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS hod_decision_by VARCHAR(36)",
        "ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS hod_decision_at TIMESTAMPTZ",
        "ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS institution_name_snapshot VARCHAR(200)",
        "ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS department_name_snapshot VARCHAR(150)",
        "ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS department_code_snapshot VARCHAR(30)",
        "ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS faculty_name_snapshot VARCHAR(150)",
        "ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS faculty_employee_id_snapshot VARCHAR(50)",
        "ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS faculty_designation_snapshot VARCHAR(120)",
        "ALTER TABLE procurement_decisions ADD COLUMN IF NOT EXISTS selected_vendor_id VARCHAR(36)",
        "ALTER TABLE finance_reviews ADD COLUMN IF NOT EXISTS sub_head VARCHAR(100)",
        "CREATE INDEX IF NOT EXISTS ix_departments_institution_id ON departments(institution_id)",
        "CREATE INDEX IF NOT EXISTS ix_users_department_id ON users(department_id)",
        "CREATE INDEX IF NOT EXISTS ix_requisitions_department_id ON requisitions(department_id)",
        "CREATE INDEX IF NOT EXISTS ix_requisitions_faculty_user_id ON requisitions(faculty_user_id)",
    ]
    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))
        # Backfill historical requisitions from the current master records.
        conn.execute(text("""
            UPDATE requisitions r
            SET institution_name_snapshot = COALESCE(r.institution_name_snapshot, i.name),
                department_name_snapshot = COALESCE(r.department_name_snapshot, d.name),
                department_code_snapshot = COALESCE(r.department_code_snapshot, d.code),
                faculty_name_snapshot = COALESCE(r.faculty_name_snapshot, u.name),
                faculty_employee_id_snapshot = COALESCE(r.faculty_employee_id_snapshot, u.employee_id),
                faculty_designation_snapshot = COALESCE(r.faculty_designation_snapshot, u.designation)
            FROM institutions i, departments d, users u
            WHERE r.institution_id = i.id AND r.department_id = d.id AND r.faculty_user_id = u.id
        """))
    seed_demo_data()

def seed_demo_data():
    db = next(get_db())
    try:
        inst = db.query(Institution).filter_by(code="GM").first()
        if not inst:
            inst = Institution(name="Demo Institution", code="GM")
            db.add(inst); db.flush()

        departments = {}
        for code, name in [("CS", "Computer Science"), ("PHY", "Physics"), ("MATH", "Mathematics")]:
            dept = db.query(Department).filter_by(code=code, institution_id=inst.id).first()
            if not dept:
                dept = Department(name=name, code=code, institution_id=inst.id)
                db.add(dept); db.flush()
            departments[code] = dept

        demo_users = [
            ("Department User", "department@example.com", "DEPARTMENT_USER", "CS", "CS001", "Assistant Professor"),
            ("Head of Computer Science", "hod@example.com", "HOD", "CS", "CS-HOD", "Head of Department"),
            ("Physics Department User", "physics@example.com", "DEPARTMENT_USER", "PHY", "PHY001", "Assistant Professor"),
            ("Head of Physics", "hod.physics@example.com", "HOD", "PHY", "PHY-HOD", "Head of Department"),
            ("Mathematics Department User", "math@example.com", "DEPARTMENT_USER", "MATH", "MATH001", "Assistant Professor"),
            ("Head of Mathematics", "hod.math@example.com", "HOD", "MATH", "MATH-HOD", "Head of Department"),
            ("Finance Officer", "finance@example.com", "FINANCE", None, "FIN001", "Finance Officer"),
            ("Purchase Committee Officer", "purchase@example.com", "PURCHASE_COMMITTEE", None, "PC001", "Purchase Committee Member"),
            ("Store Officer", "store@example.com", "STORE_OFFICER", None, "ST001", "Store Officer"),
            ("Bursar", "bursar@example.com", "BURSAR", None, "BUR001", "Bursar"),
            ("Acceptance Officer", "acceptance@example.com", "ACCEPTANCE_OFFICER", None, "ACC001", "Acceptance Officer"),
            ("AMC Officer", "amc@example.com", "AMC_OFFICER", None, "AMC001", "AMC Officer"),
            ("Principal", "principal@example.com", "PRINCIPAL", None, "PRINCIPAL", "Principal"),
            ("System Administrator", "admin@example.com", "ADMIN", None, "ADMIN001", "Administrator"),
        ]
        for name, email, role, code, employee_id, designation in demo_users:
            user = db.query(User).filter_by(email=email).first()
            dept_id = departments[code].id if code else None
            if not user:
                user = User(institution_id=inst.id, department_id=dept_id, name=name,
                            email=email, password_hash=hash_password("password"), role=role,
                            employee_id=employee_id, designation=designation)
                db.add(user)
            else:
                user.institution_id = inst.id
                user.department_id = dept_id
                user.employee_id = user.employee_id or employee_id
                user.designation = user.designation or designation
                user.name = user.name or name
        db.flush()
        # Maintain HOD assignments and designation master data.
        for code, email in [("CS","hod@example.com"),("PHY","hod.physics@example.com"),("MATH","hod.math@example.com")]:
            hod=db.query(User).filter_by(email=email).first()
            if hod: departments[code].hod_user_id=hod.id
        for name in ["Assistant Professor","Associate Professor","Professor","Head of Department","Principal","Finance Officer","Bursar","Store Officer","Administrator"]:
            if not db.query(Designation).filter_by(institution_id=inst.id,name=name).first(): db.add(Designation(institution_id=inst.id,name=name,is_active=True))
        db.commit()
    finally:
        db.close()

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/api/v1/auth/login", response_model=LoginResponse)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form.username).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {"access_token": create_access_token(user.id), "user": user}

@app.get("/api/v1/auth/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user

class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str

@app.post("/api/v1/auth/change-password")
def change_password(data: PasswordChangeIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(data.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    if len(data.new_password.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail="New password must be at most 72 bytes")
    if data.current_password == data.new_password:
        raise HTTPException(status_code=400, detail="New password must be different from the current password")
    user.password_hash = hash_password(data.new_password)
    db.commit()
    return {"ok": True, "message": "Password changed successfully"}

@app.get("/api/v1/departments", response_model=list[DepartmentOut])
def departments(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(Department).filter(Department.institution_id == user.institution_id, Department.is_active.is_(True))
    if user.role in {"DEPARTMENT_USER", "HOD"}:
        q = q.filter(Department.id == user.department_id)
    return q.order_by(Department.name.asc()).all()

@app.get("/api/v1/faculty", response_model=list[FacultyOut])
def faculty(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(User).filter(User.institution_id == user.institution_id, User.is_active.is_(True),
                              User.role.in_(["DEPARTMENT_USER", "HOD"]))
    if user.role in {"DEPARTMENT_USER", "HOD"}:
        q = q.filter(User.department_id == user.department_id)
    return q.order_by(User.name.asc()).all()

app.include_router(requisition_router, prefix="/api/v1")
app.include_router(admin_router, prefix="/api/v1")
