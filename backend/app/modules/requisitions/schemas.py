from datetime import datetime
from decimal import Decimal
from typing import Annotated
from pydantic import AfterValidator, BaseModel, Field, ConfigDict

def _non_blank(v: str) -> str:
    if not isinstance(v, str) or not v.strip():
        raise ValueError("remarks must not be empty")
    return v.strip()

# Mandatory remark for every human workflow decision. Whitespace-only is rejected (422).
NonBlankRemark = Annotated[str, Field(min_length=1), AfterValidator(_non_blank)]

class RequisitionItemCreate(BaseModel):
    item_name: str = Field(min_length=1, max_length=200)
    specification: str = Field(min_length=1)
    quantity: int = Field(gt=0)
    tentative_unit_price: Decimal = Field(gt=0)

class RequisitionCreate(BaseModel):
    category: str = Field(pattern="^(LAB|NON_LAB)$")
    justification: str = Field(min_length=5)
    items: list[RequisitionItemCreate] = Field(min_length=1)
    amc_preference: bool = False

class PrincipalDecision(BaseModel):
    remarks: NonBlankRemark

class RequisitionItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    line_no: int
    item_name: str
    specification: str
    quantity: int
    tentative_unit_price: Decimal

class RequisitionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    procurement_id: str
    institution_id: str
    institution_name_snapshot: str | None
    department_id: str
    department_name_snapshot: str | None
    department_code_snapshot: str | None
    faculty_user_id: str
    faculty_name_snapshot: str | None
    faculty_employee_id_snapshot: str | None
    faculty_designation_snapshot: str | None
    status: str
    category: str
    justification: str
    origin: str | None
    creator_role: str | None
    amc_preference: bool | None
    hod_remarks: str | None
    hod_decision_by: str | None
    hod_decision_at: datetime | None
    principal_remarks: str | None
    principal_decision_by: str | None
    principal_decision_at: datetime | None
    created_at: datetime | None
    items: list[RequisitionItemOut]

class FinanceForwardIn(BaseModel):
    # Head enum: Recurring | Fixed Asset | Other (custom text mandatory when OTHER).
    budget_head: str = Field(pattern="^(RECURRING|FIXED_ASSET|OTHER)$")
    head_other_text: str | None = None
    # Sub-head is always mandatory (free text).
    sub_head: str = Field(min_length=1, max_length=100)
    # Indicative figures only — informational, no blocking validation.
    approved_amount: Decimal | None = Field(default=None, gt=0)
    amount_remark: str | None = None
    # AMC recommendation is mandatory Boolean.
    amc_recommendation: bool
    remarks: NonBlankRemark

class PurchaseMethodIn(BaseModel):
    # Direct | Quotation | Tender | E-Tender | Other (custom text mandatory when OTHER).
    method: str = Field(pattern="^(DIRECT|QUOTATION|TENDER|E_TENDER|OTHER)$")
    method_other_text: str | None = None
    meeting_no: str | None = None
    rule_reference: str | None = None
    remarks: NonBlankRemark

class AcceptanceCompleteIn(BaseModel):
    # Stock-detail fields recorded at acceptance. All optional; shown on PDF when present.
    brand_name: str | None = Field(default=None, max_length=200)
    specification: str | None = None
    manufacturing_date: datetime | None = None
    expiry_date: datetime | None = None
    quantity_received: int | None = Field(default=None, gt=0)
    item_asset_id: str | None = Field(default=None, max_length=100)
    acceptance_date: datetime | None = None
    accepted_by: str | None = Field(default=None, max_length=150)
    remarks: str | None = None

class BursarRecordIn(BaseModel):
    # Every field optional. Whatever is present appears on the PDF; nothing is
    # validated as mandatory and nothing blocks completion.
    cheque_number: str | None = Field(default=None, max_length=100)
    transaction_number: str | None = Field(default=None, max_length=100)
    payment_reference: str | None = Field(default=None, max_length=120)
    amount: Decimal | None = Field(default=None, gt=0)
    payment_date: datetime | None = None
    amc_final: bool | None = None
    remarks: str | None = None
