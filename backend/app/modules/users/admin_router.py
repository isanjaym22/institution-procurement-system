from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.core.db import get_db
from app.core.security import require_roles, hash_password
from app.modules.audit.models import AuditLog
from app.modules.users.models import User, Department, Designation

router = APIRouter(prefix="/admin", tags=["Administrator / Master Data"])

class DepartmentIn(BaseModel):
    code: str
    name: str
    is_active: bool = True
    hod_user_id: str | None = None
class DesignationIn(BaseModel):
    name: str
    code: str | None = None
    is_active: bool = True
class StaffIn(BaseModel):
    name: str
    email: EmailStr
    employee_id: str
    designation: str
    department_id: str | None = None
    role: str = "DEPARTMENT_USER"
    is_active: bool = True
    password: str | None = None

@router.get("/departments")
def list_departments(db: Session=Depends(get_db), admin: User=Depends(require_roles("ADMIN"))):
    rows=db.query(Department).filter(Department.institution_id==admin.institution_id).order_by(Department.name).all()
    return [{"id":d.id,"code":d.code,"name":d.name,"is_active":d.is_active,"hod_user_id":d.hod_user_id} for d in rows]

@router.post("/departments")
def create_department(data: DepartmentIn, db: Session=Depends(get_db), admin: User=Depends(require_roles("ADMIN"))):
    if db.query(Department).filter(Department.institution_id==admin.institution_id, func.lower(Department.code)==data.code.lower()).first(): raise HTTPException(409,"Department code already exists")
    d=Department(institution_id=admin.institution_id,code=data.code.strip().upper(),name=data.name.strip(),is_active=data.is_active,hod_user_id=data.hod_user_id);db.add(d);db.commit();db.refresh(d);return {"id":d.id}

@router.put("/departments/{department_id}")
def update_department(department_id:str,data:DepartmentIn,db:Session=Depends(get_db),admin:User=Depends(require_roles("ADMIN"))):
    d=db.query(Department).filter_by(id=department_id,institution_id=admin.institution_id).first();
    if not d: raise HTTPException(404,"Department not found")
    d.code=data.code.strip().upper();d.name=data.name.strip();d.is_active=data.is_active;d.hod_user_id=data.hod_user_id;db.commit();return {"ok":True}

@router.get("/designations")
def list_designations(db:Session=Depends(get_db),admin:User=Depends(require_roles("ADMIN"))):
    return db.query(Designation).filter(Designation.institution_id==admin.institution_id).order_by(Designation.name).all()
@router.post("/designations")
def create_designation(data:DesignationIn,db:Session=Depends(get_db),admin:User=Depends(require_roles("ADMIN"))):
    x=Designation(institution_id=admin.institution_id,name=data.name.strip(),code=(data.code or "").strip().upper() or None,is_active=data.is_active);db.add(x);db.commit();db.refresh(x);return x
@router.put("/designations/{designation_id}")
def update_designation(designation_id:str,data:DesignationIn,db:Session=Depends(get_db),admin:User=Depends(require_roles("ADMIN"))):
    x=db.query(Designation).filter_by(id=designation_id,institution_id=admin.institution_id).first();
    if not x: raise HTTPException(404,"Designation not found")
    x.name=data.name.strip();x.code=(data.code or "").strip().upper() or None;x.is_active=data.is_active;db.commit();return {"ok":True}

@router.get("/staff")
def list_staff(db:Session=Depends(get_db),admin:User=Depends(require_roles("ADMIN"))):
    rows=db.query(User).filter(User.institution_id==admin.institution_id).order_by(User.name).all()
    return [{"id":u.id,"name":u.name,"email":u.email,"employee_id":u.employee_id,"designation":u.designation,"department_id":u.department_id,"role":u.role,"is_active":u.is_active} for u in rows]
@router.post("/staff")
def create_staff(data:StaffIn,db:Session=Depends(get_db),admin:User=Depends(require_roles("ADMIN"))):
    if db.query(User).filter(func.lower(User.email)==str(data.email).lower()).first(): raise HTTPException(409,"Email already exists")
    if db.query(User).filter(User.institution_id==admin.institution_id,User.employee_id==data.employee_id).first(): raise HTTPException(409,"Employee ID already exists")
    u=User(institution_id=admin.institution_id,department_id=data.department_id,name=data.name.strip(),email=str(data.email).lower(),employee_id=data.employee_id.strip(),designation=data.designation.strip(),role=data.role,is_active=data.is_active,password_hash=hash_password(data.password or "ChangeMe123!"));db.add(u);db.commit();db.refresh(u);return {"id":u.id,"temporary_password":data.password or "ChangeMe123!"}
class AdminPasswordResetIn(BaseModel):
    new_password: str

@router.post("/staff/{user_id}/password")
def admin_change_user_password(user_id: str, data: AdminPasswordResetIn, db: Session=Depends(get_db), admin: User=Depends(require_roles("ADMIN"))):
    if len(data.new_password) < 8:
        raise HTTPException(400, "New password must be at least 8 characters")
    if len(data.new_password.encode("utf-8")) > 72:
        raise HTTPException(400, "New password must be at most 72 bytes")
    u=db.query(User).filter_by(id=user_id,institution_id=admin.institution_id).first()
    if not u:
        raise HTTPException(404, "User not found")
    u.password_hash=hash_password(data.new_password)
    db.add(AuditLog(institution_id=admin.institution_id, entity_type="USER", entity_id=u.id,
                    action="PASSWORD_CHANGED_BY_ADMIN", actor_id=admin.id,
                    before_data={"password_changed": False}, after_data={"password_changed": True},
                    remarks=f"Password changed by administrator for {u.email}"))
    db.commit()
    return {"ok": True, "message": f"Password changed for {u.name}"}

@router.put("/staff/{user_id}")
def update_staff(user_id:str,data:StaffIn,db:Session=Depends(get_db),admin:User=Depends(require_roles("ADMIN"))):
    u=db.query(User).filter_by(id=user_id,institution_id=admin.institution_id).first();
    if not u: raise HTTPException(404,"Staff member not found")
    u.name=data.name.strip();u.email=str(data.email).lower();u.employee_id=data.employee_id.strip();u.designation=data.designation.strip();u.department_id=data.department_id;u.role=data.role;u.is_active=data.is_active
    if data.password: u.password_hash=hash_password(data.password)
    db.commit();return {"ok":True}

@router.post("/departments/{department_id}/assign-hod/{user_id}")
def assign_hod(department_id:str,user_id:str,db:Session=Depends(get_db),admin:User=Depends(require_roles("ADMIN"))):
    d=db.query(Department).filter_by(id=department_id,institution_id=admin.institution_id).first();u=db.query(User).filter_by(id=user_id,institution_id=admin.institution_id).first()
    if not d or not u: raise HTTPException(404,"Department or staff member not found")
    u.department_id=d.id;u.role="HOD";d.hod_user_id=u.id;db.commit();return {"ok":True}
