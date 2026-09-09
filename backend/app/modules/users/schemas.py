from pydantic import BaseModel, EmailStr, ConfigDict

class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"

class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    email: str
    role: str
    department_id: str | None = None
    employee_id: str | None = None
    designation: str | None = None
    institution_id: str

class DepartmentOut(BaseModel):
    id: str
    institution_id: str
    code: str
    name: str
    is_active: bool

class FacultyOut(BaseModel):
    id: str
    name: str
    employee_id: str | None = None
    designation: str | None = None
    email: EmailStr
    role: str
    department_id: str | None = None
