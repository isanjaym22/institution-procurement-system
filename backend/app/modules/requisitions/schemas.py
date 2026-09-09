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
    hod_remarks: str | None
    hod_decision_by: str | None
    hod_decision_at: datetime | None
    principal_remarks: str | None
    principal_decision_by: str | None
    principal_decision_at: datetime | None
    created_at: datetime | None
    items: list[RequisitionItemOut]

class FinanceReviewIn(BaseModel):
    decision: str = Field(pattern="^(APPROVE|RETURN|REJECT)$")
    budget_head: str | None = None
    sub_head: str | None = None
    approved_amount: Decimal | None = Field(default=None, gt=0)
    remarks: NonBlankRemark

class ProcurementDecisionIn(BaseModel):
    method: str = Field(pattern="^(DIRECT|QUOTATION|TENDER|E_TENDER)$")
    meeting_no: str | None = None
    rule_reference: str | None = None
    remarks: NonBlankRemark

class VendorSelectionIn(BaseModel):
    vendor_name: str = Field(min_length=2, max_length=200)
    gstin: str | None = None
    contact: str | None = None
    remarks: NonBlankRemark

class DirectPurchaseIn(BaseModel):
    vendor_name: str = Field(min_length=2, max_length=200)
    contact: str | None = None
    po_number: str = Field(min_length=2, max_length=100)
    total_amount: Decimal = Field(gt=0)
    remarks: NonBlankRemark

class PurchaseOrderIn(BaseModel):
    po_number: str = Field(min_length=2, max_length=100)
    total_amount: Decimal = Field(gt=0)
    warranty_months: int | None = Field(default=None, ge=0)
    amc_required: bool = False
    delivery_terms: str | None = None
    remarks: NonBlankRemark

class DeliveryIn(BaseModel):
    invoice_number: str | None = None
    challan_number: str | None = None
    remarks: NonBlankRemark

class AcceptanceIn(BaseModel):
    decision: str = Field(pattern="^(ACCEPT|PARTIAL|REJECT)$")
    remarks: NonBlankRemark

class StockEntryIn(BaseModel):
    register_type: str = Field(pattern="^(STOCK|ASSET)$")
    asset_id: str | None = None
    serial_no: str | None = None
    remarks: NonBlankRemark

class BillIn(BaseModel):
    invoice_number: str
    amount: Decimal = Field(gt=0)
    remarks: NonBlankRemark

class PaymentIn(BaseModel):
    payment_reference: str
    amount: Decimal = Field(gt=0)
    remarks: NonBlankRemark

class UCIn(BaseModel):
    certificate_no: str
    remarks: NonBlankRemark

class AMCIn(BaseModel):
    start_date: datetime
    end_date: datetime
    contract_no: str | None = None
    remarks: NonBlankRemark

class CloseIn(BaseModel):
    remarks: NonBlankRemark
