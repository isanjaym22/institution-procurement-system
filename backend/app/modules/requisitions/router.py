import csv
import io
import os
import uuid
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse, Response, FileResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import get_current_user, require_roles
from app.modules.users.models import User, Department, Institution
from app.modules.requisitions.models import Requisition, RequisitionItem
from app.modules.requisitions.schemas import (
    RequisitionCreate, RequisitionOut, PrincipalDecision,
    FinanceForwardIn, PurchaseMethodIn, AcceptanceCompleteIn, BursarRecordIn,
)
from app.modules.workflow.models import WorkflowEvent
from app.modules.audit.models import AuditLog
from app.modules.workflow.service import transition
from app.modules.procurement_models import (
    FinanceReview, ProcurementDecision, Vendor, PurchaseOrder, DeliveryReceipt,
    Acceptance, StockEntry, Bill, Payment, UtilizationCertificate, AMC, WorkOrder,
)

router = APIRouter(prefix="/requisitions", tags=["Requisitions"])

# Amount gate decided by Principal approval: requisitions below this total go
# straight to acceptance, skipping Finance Committee entirely (>= limit goes to Finance).
DIRECT_PURCHASE_LIMIT = Decimal("10000")

# Uploaded PDFs (work orders, payment documents). Served only through
# auth-checked download endpoints — never mounted as static files.
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/data/uploads")
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

def requisition_total(req) -> Decimal:
    return sum((Decimal(item.quantity) * item.tentative_unit_price for item in req.items), Decimal("0"))

# Display-only labels for tracking. The workflow itself (valid statuses and moves)
# is defined solely by TRANSITIONS in app/modules/workflow/service.py — this map
# must stay keyed to those statuses and never gates any logic.
STATUS_META: dict[str, tuple[str, str]] = {
    "DRAFT": ("Draft — with creator", ""),
    "SUBMITTED": ("Submitted — awaiting HOD decision", "HOD"),
    "PRINCIPAL_REVIEW": ("Principal review", "PRINCIPAL"),
    "HOD_REJECTED": ("Rejected by HOD — closed", "HOD"),
    "PRINCIPAL_REJECTED": ("Rejected by Principal — closed", "PRINCIPAL"),
    "FINANCE_REVIEW": ("Finance — budget head & sub-head", "FINANCE"),
    "METHOD_PENDING": ("Purchase committee — decide method", "PURCHASE_COMMITTEE"),
    "WO_PENDING": ("Purchase committee — upload work order", "PURCHASE_COMMITTEE"),
    "ACCEPTANCE": ("Acceptance pending", ""),
    "BURSAR_REVIEW": ("Accounts — payment recording", "BURSAR"),
    "COMPLETED": ("Completed", "BURSAR"),
    # --- legacy (pre-Sep-2026), grandfathered: frozen, readable ---
    "RETURNED_TO_DEPARTMENT": ("Returned to department (legacy)", "DEPARTMENT_USER"),
    "DIRECT_PURCHASE": ("Direct purchase (legacy)", "DEPARTMENT_USER"),
    "FINANCE_REJECTED": ("Rejected by Finance (legacy)", "FINANCE"),
    "BUDGET_ALLOCATED": ("Budget allocated (legacy)", "PURCHASE_COMMITTEE"),
    "PROCUREMENT_IN_PROGRESS": ("Procurement in progress (legacy)", "PURCHASE_COMMITTEE"),
    "VENDOR_SELECTED": ("Vendor selected (legacy)", "PURCHASE_COMMITTEE"),
    "PO_ISSUED": ("PO issued (legacy)", "STORE_OFFICER"),
    "DELIVERED": ("Delivered (legacy)", "DEPARTMENT_USER"),
    "ACCEPTED": ("Accepted (legacy)", "STORE_OFFICER"),
    "PARTIALLY_ACCEPTED": ("Partially accepted (legacy)", "STORE_OFFICER"),
    "DELIVERY_REJECTED": ("Delivery rejected (legacy)", "ACCEPTANCE_OFFICER"),
    "STOCK_UPDATED": ("Stock updated (legacy)", "BURSAR"),
    "BILL_SUBMITTED": ("Bill submitted (legacy)", "BURSAR"),
    "BILL_VERIFIED": ("Bill verified (legacy)", "BURSAR"),
    "PAYMENT_COMPLETED": ("Payment completed (legacy)", "BURSAR"),
    "UC_GENERATED": ("UC generated (legacy)", "BURSAR"),
    "AMC_ACTIVE": ("AMC active (legacy)", "AMC_OFFICER"),
    "CLOSED": ("Closed (legacy)", "BURSAR"),
}
# Canonical happy-path order for the public checklist (side branches handled below).
MAIN_FLOW = ["DRAFT", "SUBMITTED", "PRINCIPAL_REVIEW", "FINANCE_REVIEW", "METHOD_PENDING",
    "WO_PENDING", "ACCEPTANCE", "BURSAR_REVIEW", "COMPLETED"]
# Terminal side-branch status -> main-flow stage it failed at.
FAILED_AT = {"HOD_REJECTED": "SUBMITTED", "PRINCIPAL_REJECTED": "PRINCIPAL_REVIEW"}
# Stages skipped by the below-₹10,000 direct path (Principal -> acceptance).
DIRECT_SKIP = {"FINANCE_REVIEW", "METHOD_PENDING", "WO_PENDING"}
# HOD/office-created requisitions skip the HOD queue.
HOD_SKIP = {"SUBMITTED"}

def _checklist(status: str, skipped: set[str] | None = None) -> list[dict]:
    skipped = skipped or set()
    at = FAILED_AT.get(status, status)
    failed = status in FAILED_AT
    try:
        idx = MAIN_FLOW.index(at)
    except ValueError:
        idx = 0
    out = []
    for i, key in enumerate(MAIN_FLOW):
        label, _ = STATUS_META.get(key, (key, ""))
        if key in skipped:
            state = "done"
            label = f"{label} — skipped"
        else:
            state = "done" if i < idx else ("current" if i == idx and not failed else "todo")
        out.append({"key": key, "label": label, "state": state})
    if status not in MAIN_FLOW:
        label, _ = STATUS_META.get(status, (status, ""))
        out.append({"key": status, "label": label, "state": "current" if failed else "todo"})
        if failed:
            out[idx] = {**out[idx], "state": "done"}
    return out

def _direct_skipped(db: Session, req_id: str) -> set[str]:
    direct = db.query(WorkflowEvent).filter(WorkflowEvent.requisition_id == req_id,
        WorkflowEvent.action == "PRINCIPAL_APPROVE_DIRECT").first() is not None
    return set(DIRECT_SKIP) if direct else set()

def _hod_skipped(db: Session, req) -> set[str]:
    if (req.origin or "") in {"HOD", "OFFICE"}:
        return set(HOD_SKIP)
    direct = db.query(WorkflowEvent).filter(WorkflowEvent.requisition_id == req.id,
        WorkflowEvent.action == "SUBMIT_DIRECT").first() is not None
    return set(HOD_SKIP) if direct else set()

def financial_year(today: date | None = None) -> str:
    d = today or date.today()
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start}-{str(start + 1)[-2:]}"

def next_procurement_id(db: Session, institution_id: str, dept_code: str) -> str:
    fy = financial_year()
    # PostgreSQL upsert + RETURNING makes the per-institution/year/department counter safe under concurrency.
    row = db.execute(text("""
        INSERT INTO procurement_sequences (id, institution_id, financial_year, department_code, last_number)
        VALUES (:id, :institution_id, :fy, :dept_code, 1)
        ON CONFLICT (institution_id, financial_year, department_code)
        DO UPDATE SET last_number = procurement_sequences.last_number + 1
        RETURNING last_number
    """), {"id": str(uuid.uuid4()), "institution_id": institution_id, "fy": fy, "dept_code": dept_code}).first()
    return f"PROC/{fy}/{dept_code}/{int(row[0]):05d}"

DEPT_SCOPED_ROLES = {"DEPARTMENT_USER", "HOD", "OFFICE"}

def get_req(db: Session, req_id: str, user: User, allow_principal=True):
    req = db.get(Requisition, req_id)
    if not req or req.institution_id != user.institution_id:
        raise HTTPException(404, "Requisition not found")
    if user.role in DEPT_SCOPED_ROLES and req.department_id != user.department_id:
        raise HTTPException(403, "Forbidden")
    if not allow_principal and user.role == "PRINCIPAL":
        raise HTTPException(403, "Forbidden")
    return req

def _save_pdf(file: UploadFile, req_id: str, prefix: str) -> str:
    # PDF-only uploads: magic-byte check, 10MB cap, stored outside the repo.
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "File exceeds the 10MB limit")
    if not data.startswith(b"%PDF"):
        raise HTTPException(400, "Only PDF files are accepted")
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    path = os.path.join(UPLOAD_DIR, f"{req_id}_{prefix}.pdf")
    with open(path, "wb") as f:
        f.write(data)
    return path

@router.post("", response_model=RequisitionOut)
def create_requisition(payload: RequisitionCreate, db: Session = Depends(get_db),
        user: User = Depends(require_roles("DEPARTMENT_USER", "HOD", "OFFICE"))):
    if not user.department_id:
        raise HTTPException(400, "User has no department assigned")
    dept = db.get(Department, user.department_id)
    inst = db.get(Institution, user.institution_id)
    if not dept or not dept.is_active:
        raise HTTPException(400, "User's department is not active")
    origin = {"DEPARTMENT_USER": "DEPARTMENT", "HOD": "HOD", "OFFICE": "OFFICE"}[user.role]
    req = Requisition(
        procurement_id=next_procurement_id(db, user.institution_id, dept.code),
        institution_id=user.institution_id, department_id=dept.id, faculty_user_id=user.id,
        institution_name_snapshot=inst.name if inst else None,
        department_name_snapshot=dept.name, department_code_snapshot=dept.code,
        faculty_name_snapshot=user.name, faculty_employee_id_snapshot=user.employee_id,
        faculty_designation_snapshot=user.designation,
        status="DRAFT", category=payload.category, justification=payload.justification,
        origin=origin, creator_role=user.role, amc_preference=payload.amc_preference,
    )
    for i, item in enumerate(payload.items, 1):
        req.items.append(RequisitionItem(line_no=i, item_name=item.item_name, specification=item.specification,
                                         quantity=item.quantity, tentative_unit_price=item.tentative_unit_price))
    db.add(req); db.commit(); db.refresh(req); return req

def _pending(db: Session, user: User, statuses: list[str]):
    q = db.query(Requisition).filter(Requisition.institution_id == user.institution_id,
        Requisition.status.in_(statuses))
    if user.role in DEPT_SCOPED_ROLES:
        q = q.filter(Requisition.department_id == user.department_id)
    return q.order_by(Requisition.created_at.asc()).all()

@router.get("/hod/pending", response_model=list[RequisitionOut])
def hod_pending(db: Session = Depends(get_db), user: User = Depends(require_roles("HOD"))):
    return _pending(db, user, ["SUBMITTED"])

@router.get("/principal/pending", response_model=list[RequisitionOut])
def principal_pending(db: Session = Depends(get_db), user: User = Depends(require_roles("PRINCIPAL"))):
    return _pending(db, user, ["PRINCIPAL_REVIEW"])

@router.get("/finance/pending", response_model=list[RequisitionOut])
def finance_pending(db: Session = Depends(get_db), user: User = Depends(require_roles("FINANCE", "ADMIN"))):
    return _pending(db, user, ["FINANCE_REVIEW"])

@router.get("/purchase/pending", response_model=list[RequisitionOut])
def purchase_pending(db: Session = Depends(get_db), user: User = Depends(require_roles("PURCHASE_COMMITTEE", "ADMIN"))):
    return _pending(db, user, ["METHOD_PENDING", "WO_PENDING"])

@router.get("/acceptance/pending", response_model=list[RequisitionOut])
def acceptance_pending(db: Session = Depends(get_db),
        user: User = Depends(require_roles("DEPARTMENT_USER", "HOD", "OFFICE", "ADMIN"))):
    reqs = _pending(db, user, ["ACCEPTANCE"])
    # Origin routing: department-origin accepted by dept staff/HOD, office-origin by office.
    return [r for r in reqs if (r.origin or "DEPARTMENT") == "OFFICE"
            and user.role in {"OFFICE", "ADMIN"}
            or (r.origin or "DEPARTMENT") != "OFFICE"
            and user.role in {"DEPARTMENT_USER", "HOD", "ADMIN"}]

@router.get("/bursar/pending", response_model=list[RequisitionOut])
def bursar_pending(db: Session = Depends(get_db), user: User = Depends(require_roles("BURSAR", "ADMIN"))):
    return _pending(db, user, ["BURSAR_REVIEW"])

@router.get("/track")
def track_procurement(procurement_id: str, db: Session = Depends(get_db)):
    # Public, unauthenticated. Returns status/stage only — never names, items,
    # prices, remarks, or snapshots.
    pid = (procurement_id or "").strip()
    if not pid:
        raise HTTPException(404, "Invalid Procurement ID")
    req = db.query(Requisition).filter(Requisition.procurement_id == pid).first()
    if not req:
        req = db.query(Requisition).filter(Requisition.procurement_id.ilike(pid)).first()
    if not req:
        raise HTTPException(404, "Invalid Procurement ID")
    label, owner = STATUS_META.get(req.status, (req.status, ""))
    if req.status == "ACCEPTANCE":
        owner = "OFFICE" if (req.origin or "") == "OFFICE" else "DEPARTMENT_USER"
    skipped = _direct_skipped(db, req.id) | _hod_skipped(db, req)
    return {"procurement_id": req.procurement_id, "status": req.status,
        "stage_label": label, "owner_role": owner,
        "checklist": _checklist(req.status, skipped=skipped), "last_updated": req.updated_at}

@router.get("/{req_id}/history")
def requisition_history(req_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    req = get_req(db, req_id, user)
    events = db.query(WorkflowEvent).filter(WorkflowEvent.requisition_id == req.id)\
        .order_by(WorkflowEvent.created_at.asc()).all()
    actor_ids = list({e.actor_id for e in events})
    roles = {u.id: u.role for u in db.query(User).filter(User.id.in_(actor_ids)).all()} if actor_ids else {}
    return [{"action": e.action, "from_status": e.from_status, "to_status": e.to_status,
        "actor_role": roles.get(e.actor_id, ""), "remarks": e.remarks,
        "created_at": e.created_at} for e in events]

@router.get("/{req_id}/audit")
def requisition_audit(req_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    req = get_req(db, req_id, user)
    logs = db.query(AuditLog).filter(AuditLog.entity_type == "REQUISITION",
        AuditLog.entity_id == req.id).order_by(AuditLog.created_at.asc()).all()
    actor_ids = list({e.actor_id for e in logs})
    actors = {u.id: u for u in db.query(User).filter(User.id.in_(actor_ids)).all()} if actor_ids else {}
    return [{"action": e.action, "actor_name": actors[e.actor_id].name if e.actor_id in actors else "",
        "actor_role": actors[e.actor_id].role if e.actor_id in actors else "",
        "before_data": e.before_data, "after_data": e.after_data,
        "remarks": e.remarks, "created_at": e.created_at} for e in logs]

@router.get("", response_model=list[RequisitionOut])
def list_requisitions(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(Requisition).filter(Requisition.institution_id == user.institution_id)
    if user.role in DEPT_SCOPED_ROLES:
        q = q.filter(Requisition.department_id == user.department_id)
    return q.order_by(Requisition.created_at.desc()).all()

@router.get("/{req_id}", response_model=RequisitionOut)
def get_requisition(req_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return get_req(db, req_id, user)

@router.post("/{req_id}/submit", response_model=RequisitionOut)
def submit(req_id: str, db: Session = Depends(get_db),
        user: User = Depends(require_roles("DEPARTMENT_USER", "HOD", "OFFICE"))):
    req = get_req(db, req_id, user)
    if req.status != "DRAFT":
        raise HTTPException(409, "Only drafts can be submitted")
    # HOD/office-created requisitions skip the HOD queue (HOD auto-considered passed).
    if (req.origin or "DEPARTMENT") == "DEPARTMENT":
        return transition(db, req, "SUBMIT", user)
    return transition(db, req, "SUBMIT_DIRECT", user, "HOD step skipped — created by HOD/Office")

@router.post("/{req_id}/hod/approve", response_model=RequisitionOut)
def hod_approve(req_id: str, payload: PrincipalDecision, db: Session = Depends(get_db), user: User = Depends(require_roles("HOD"))):
    return transition(db, get_req(db, req_id, user), "HOD_APPROVE", user, payload.remarks)

@router.post("/{req_id}/hod/reject", response_model=RequisitionOut)
def hod_reject(req_id: str, payload: PrincipalDecision, db: Session = Depends(get_db), user: User = Depends(require_roles("HOD"))):
    return transition(db, get_req(db, req_id, user), "HOD_REJECT", user, payload.remarks)

@router.post("/{req_id}/principal/approve", response_model=RequisitionOut)
def principal_approve(req_id: str, payload: PrincipalDecision, db: Session = Depends(get_db), user: User = Depends(require_roles("PRINCIPAL"))):
    req = get_req(db, req_id, user)
    # Amount gate on the server-computed item total: below ₹10,000 goes straight
    # to acceptance, skipping Finance Committee; ₹10,000+ goes to Finance.
    if requisition_total(req) < DIRECT_PURCHASE_LIMIT:
        return transition(db, req, "PRINCIPAL_APPROVE_DIRECT", user, payload.remarks)
    return transition(db, req, "PRINCIPAL_APPROVE", user, payload.remarks)

@router.post("/{req_id}/principal/reject", response_model=RequisitionOut)
def principal_reject(req_id: str, payload: PrincipalDecision, db: Session = Depends(get_db), user: User = Depends(require_roles("PRINCIPAL"))):
    return transition(db, get_req(db, req_id, user), "PRINCIPAL_REJECT", user, payload.remarks)

@router.post("/{req_id}/finance/forward", response_model=RequisitionOut)
def finance_forward(req_id: str, payload: FinanceForwardIn, db: Session = Depends(get_db),
        user: User = Depends(require_roles("FINANCE", "ADMIN"))):
    req = get_req(db, req_id, user)
    if req.status != "FINANCE_REVIEW":
        raise HTTPException(409, "Requisition is not awaiting finance review")
    if not (payload.sub_head or "").strip():
        raise HTTPException(400, "Sub-head is required")
    if payload.budget_head == "OTHER" and not (payload.head_other_text or "").strip():
        raise HTTPException(400, "Custom head text is required when head is Other")
    db.add(FinanceReview(requisition_id=req.id, decision="FORWARD",
        budget_head=payload.budget_head, head_other_text=(payload.head_other_text or "").strip() or None,
        sub_head=payload.sub_head.strip(), approved_amount=payload.approved_amount,
        amount_remark=(payload.amount_remark or "").strip() or None,
        amc_recommendation=payload.amc_recommendation, remarks=payload.remarks, actor_id=user.id))
    return transition(db, req, "FINANCE_FORWARD", user, payload.remarks)

@router.post("/{req_id}/purchase/method", response_model=RequisitionOut)
def purchase_method(req_id: str, payload: PurchaseMethodIn, db: Session = Depends(get_db),
        user: User = Depends(require_roles("PURCHASE_COMMITTEE", "ADMIN"))):
    req = get_req(db, req_id, user)
    if req.status != "METHOD_PENDING":
        raise HTTPException(409, "Purchase method has already been decided")
    if payload.method == "OTHER" and not (payload.method_other_text or "").strip():
        raise HTTPException(400, "Custom method text is required when method is Other")
    db.add(ProcurementDecision(requisition_id=req.id, method=payload.method,
        method_other_text=(payload.method_other_text or "").strip() or None,
        meeting_no=(payload.meeting_no or "").strip() or None,
        rule_reference=(payload.rule_reference or "").strip() or None,
        remarks=payload.remarks, actor_id=user.id))
    return transition(db, req, "METHOD_DECIDED", user, payload.remarks)

@router.post("/{req_id}/purchase/work-order", response_model=RequisitionOut)
def upload_work_order(req_id: str, db: Session = Depends(get_db),
        user: User = Depends(require_roles("PURCHASE_COMMITTEE", "ADMIN")),
        file: UploadFile = File(...)):
    # Second Purchase Committee login: uploads the Work Order PDF, which sits
    # between method decision and acceptance. No remark required.
    req = get_req(db, req_id, user)
    if req.status != "WO_PENDING":
        raise HTTPException(409, "Work order has already been uploaded")
    path = _save_pdf(file, req.id, "work_order")
    wo = db.query(WorkOrder).filter(WorkOrder.requisition_id == req.id).first()
    if wo:
        wo.file_path = path; wo.uploaded_by = user.id
    else:
        db.add(WorkOrder(requisition_id=req.id, file_path=path, uploaded_by=user.id))
    return transition(db, req, "WO_UPLOADED", user, "Work order uploaded")

@router.get("/{req_id}/work-order")
def download_work_order(req_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    req = get_req(db, req_id, user)
    wo = db.query(WorkOrder).filter(WorkOrder.requisition_id == req.id).first()
    if not wo or not os.path.exists(wo.file_path):
        raise HTTPException(404, "Work order not found")
    return FileResponse(wo.file_path, media_type="application/pdf",
        filename=f"{req.procurement_id.replace('/', '-')}-work-order.pdf")

@router.post("/{req_id}/acceptance/complete", response_model=RequisitionOut)
def complete_acceptance(req_id: str, payload: AcceptanceCompleteIn, db: Session = Depends(get_db),
        user: User = Depends(require_roles("DEPARTMENT_USER", "HOD", "OFFICE", "ADMIN"))):
    req = get_req(db, req_id, user)
    if req.status != "ACCEPTANCE":
        raise HTTPException(409, "Requisition is not awaiting acceptance")
    # Origin routing: department-origin accepted by dept staff/HOD, office-origin by office.
    office_origin = (req.origin or "DEPARTMENT") == "OFFICE"
    if user.role != "ADMIN" and (office_origin != (user.role == "OFFICE")):
        raise HTTPException(403, "Acceptance belongs to the originating side")
    db.add(Acceptance(requisition_id=req.id, decision="ACCEPT",
        brand_name=(payload.brand_name or "").strip() or None,
        specification=(payload.specification or "").strip() or None,
        manufacturing_date=payload.manufacturing_date, expiry_date=payload.expiry_date,
        quantity_received=payload.quantity_received,
        item_asset_id=(payload.item_asset_id or "").strip() or None,
        acceptance_date=payload.acceptance_date,
        accepted_by=(payload.accepted_by or "").strip() or None,
        remarks=(payload.remarks or "").strip() or None, actor_id=user.id))
    return transition(db, req, "ACCEPTANCE_DONE", user, (payload.remarks or "").strip() or None)

@router.post("/{req_id}/bursar/record", response_model=RequisitionOut)
def bursar_record(req_id: str, db: Session = Depends(get_db),
        user: User = Depends(require_roles("BURSAR", "ADMIN")),
        cheque_number: str | None = Form(None), transaction_number: str | None = Form(None),
        payment_reference: str | None = Form(None), amount: str | None = Form(None),
        payment_date: str | None = Form(None), amc_final: str | None = Form(None),
        remarks: str | None = Form(None), file: UploadFile | None = File(None)):
    # Endpoint of the workflow: every field optional, supporting document
    # PDF-only when present. Whatever is present appears on the PDF.
    req = get_req(db, req_id, user)
    if req.status != "BURSAR_REVIEW":
        raise HTTPException(409, "Requisition is not awaiting payment recording")
    try:
        amount_dec = Decimal(amount) if (amount or "").strip() else None
        if amount_dec is not None and amount_dec <= 0:
            raise HTTPException(400, "Amount must be positive")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "Amount is not a valid number")
    try:
        pay_date = datetime.fromisoformat(payment_date) if (payment_date or "").strip() else None
    except Exception:
        raise HTTPException(400, "Payment date is not valid")
    amc_bool = None
    if (amc_final or "").strip() != "":
        amc_bool = amc_final.strip().lower() in {"true", "1", "yes"}
    doc_path = None
    if file is not None and (file.filename or ""):
        doc_path = _save_pdf(file, req.id, "payment_doc")
    db.add(Payment(requisition_id=req.id,
        cheque_number=(cheque_number or "").strip() or None,
        transaction_number=(transaction_number or "").strip() or None,
        payment_reference=(payment_reference or "").strip() or None,
        amount=amount_dec, payment_date=pay_date or datetime.now(timezone.utc),
        document_path=doc_path, amc_final=amc_bool))
    return transition(db, req, "PAYMENT_RECORDED", user, (remarks or "").strip() or None)

@router.get("/{req_id}/payment-document")
def download_payment_doc(req_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    req = get_req(db, req_id, user)
    pay = db.query(Payment).filter(Payment.requisition_id == req.id).first()
    if not pay or not pay.document_path or not os.path.exists(pay.document_path):
        raise HTTPException(404, "Payment document not found")
    return FileResponse(pay.document_path, media_type="application/pdf",
        filename=f"{req.procurement_id.replace('/', '-')}-payment.pdf")

# -------- Reports --------
REPORTABLE = ["BURSAR_REVIEW", "COMPLETED", "CLOSED"]

@router.get("/reports/purchases")
def report_purchases(
    from_date: date = Query(...), to_date: date = Query(...),
    department_id: str | None = Query(None), procurement_id: str | None = Query(None),
    category: str | None = Query(None), head: str | None = Query(None),
    method: str | None = Query(None), amc: str | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("PRINCIPAL", "BURSAR", "ADMIN", "FINANCE", "PURCHASE_COMMITTEE",
                                        "DEPARTMENT_USER", "HOD", "OFFICE"))):
    # Date-wise purchase report over completed/accepted records. Report date =
    # requisition creation date. Terminal rejects are always excluded.
    rows = _report_rows(db, user, from_date, to_date, department_id, procurement_id,
                        category, head, method, amc)
    return {"from_date": str(from_date), "to_date": str(to_date), "count": len(rows), "rows": rows}

@router.get("/reports/purchases/pdf")
def report_purchases_pdf(
    from_date: date = Query(...), to_date: date = Query(...),
    department_id: str | None = Query(None), procurement_id: str | None = Query(None),
    category: str | None = Query(None), head: str | None = Query(None),
    method: str | None = Query(None), amc: str | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("PRINCIPAL", "BURSAR", "ADMIN", "FINANCE", "PURCHASE_COMMITTEE",
                                        "DEPARTMENT_USER", "HOD", "OFFICE"))):
    from app.modules.requisitions.pdf_document import build_report_pdf
    rows = _report_rows(db, user, from_date, to_date, department_id, procurement_id,
                        category, head, method, amc)
    inst = db.get(Institution, user.institution_id)
    pdf_bytes = build_report_pdf(rows, str(from_date), str(to_date), inst.name if inst else "")
    return Response(pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="purchase-report-{from_date}-{to_date}.pdf"'})

def _report_rows(db, user, from_date, to_date, department_id, procurement_id,
                 category, head, method, amc):
    q = db.query(Requisition).filter(Requisition.institution_id == user.institution_id,
        Requisition.status.in_(REPORTABLE),
        Requisition.created_at >= datetime(from_date.year, from_date.month, from_date.day),
        Requisition.created_at < datetime(to_date.year, to_date.month, to_date.day) + timedelta(days=1))
    if user.role in DEPT_SCOPED_ROLES:
        q = q.filter(Requisition.department_id == user.department_id)
    elif department_id:
        q = q.filter(Requisition.department_id == department_id)
    if procurement_id:
        q = q.filter(Requisition.procurement_id.ilike(f"%{procurement_id.strip()}%"))
    if category:
        q = q.filter(Requisition.category == category)
    reqs = q.order_by(Requisition.created_at.asc()).all()
    if not reqs:
        return []
    ids = [r.id for r in reqs]
    frs = {f.requisition_id: f for f in db.query(FinanceReview).filter(FinanceReview.requisition_id.in_(ids)).all()}
    pds = {p.requisition_id: p for p in db.query(ProcurementDecision).filter(ProcurementDecision.requisition_id.in_(ids)).all()}
    pays = {p.requisition_id: p for p in db.query(Payment).filter(Payment.requisition_id.in_(ids)).all()}
    out = []
    for r in reqs:
        fr, pd, pay = frs.get(r.id), pds.get(r.id), pays.get(r.id)
        head_val = fr.budget_head if fr else None
        method_val = pd.method if pd else None
        amc_val = pay.amc_final if pay and pay.amc_final is not None else (r.amc_preference if r.amc_preference else None)
        if head and head_val != head:
            continue
        if method and method_val != method:
            continue
        if (amc or "") != "" and amc.lower() in {"true", "false"}:
            if amc_val is None or amc_val != (amc.lower() == "true"):
                continue
        out.append({"procurement_id": r.procurement_id, "date": r.created_at.date().isoformat() if r.created_at else None,
            "department": r.department_name_snapshot, "department_code": r.department_code_snapshot,
            "faculty": r.faculty_name_snapshot, "category": r.category,
            "head": head_val, "sub_head": fr.sub_head if fr else None,
            "method": method_val, "amc": amc_val,
            "total": str(requisition_total(r)), "status": r.status})
    return out

@router.get("/{req_id}/pdf")
def requisition_pdf(req_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.modules.requisitions.pdf_document import build_procurement_pdf
    req = get_req(db, req_id, user)
    q1 = lambda m: db.query(m).filter(m.requisition_id == req.id).first()
    fr, pd, po, dl, ac, st, bill, pay, uc, amc = (q1(m) for m in
        (FinanceReview, ProcurementDecision, PurchaseOrder, DeliveryReceipt, Acceptance,
         StockEntry, Bill, Payment, UtilizationCertificate, AMC))
    wo = q1(WorkOrder)
    po_vendor = db.get(Vendor, po.vendor_id) if po else None
    sel_vendor = db.get(Vendor, pd.selected_vendor_id) if pd and pd.selected_vendor_id else None
    amc_vendor = db.get(Vendor, amc.vendor_id) if amc and amc.vendor_id else None
    data = {"finance_review": fr, "procurement_decision": pd,
        "selected_vendor_name": sel_vendor.name if sel_vendor else None,
        "selected_vendor_gstin": sel_vendor.gstin if sel_vendor else None,
        "selected_vendor_contact": sel_vendor.contact if sel_vendor else None,
        "purchase_order": po, "po_vendor": po_vendor, "delivery": dl,
        "acceptance": ac, "stock_entry": st, "bill": bill, "payment": pay,
        "uc": uc, "amc": amc, "amc_vendor": amc_vendor, "work_order": wo}
    events = db.query(WorkflowEvent).filter(WorkflowEvent.requisition_id == req.id)\
        .order_by(WorkflowEvent.created_at.asc()).all()
    actor_ids = list({e.actor_id for e in events} | {u for u in
        [getattr(req, "hod_decision_by", None), getattr(req, "principal_decision_by", None),
          fr.actor_id if fr else None, ac.actor_id if ac else None] if u})
    users = {u.id: (u.name, u.role) for u in
             db.query(User).filter(User.id.in_(actor_ids)).all()} if actor_ids else {}
    pdf_bytes = build_procurement_pdf(req, data, events, users)
    return Response(pdf_bytes, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{req.procurement_id.replace("/","-")}.pdf"'})

@router.get("/export/csv")
def export_csv(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(Requisition).filter(Requisition.institution_id == user.institution_id)
    if user.role in DEPT_SCOPED_ROLES: q = q.filter(Requisition.department_id == user.department_id)
    output = io.StringIO(); writer = csv.writer(output)
    writer.writerow(["Procurement ID","Institution","Department Code","Department","Faculty/Staff","Employee ID","Designation","Status","Origin","Category","Justification","Item","Quantity","Unit Price","Line Total"])
    for req in q.order_by(Requisition.created_at.desc()).all():
        for item in req.items:
            writer.writerow([req.procurement_id, req.institution_name_snapshot, req.department_code_snapshot,
                req.department_name_snapshot, req.faculty_name_snapshot, req.faculty_employee_id_snapshot,
                req.faculty_designation_snapshot, req.status, req.origin or "", req.category, req.justification,
                item.item_name, item.quantity, str(item.tentative_unit_price), str(item.line_total)])
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=procurement.csv"})
