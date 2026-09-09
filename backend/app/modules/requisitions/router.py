import csv
import io
import uuid
from datetime import date
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import get_current_user, require_roles
from app.modules.users.models import User, Department, Institution
from app.modules.requisitions.models import Requisition, RequisitionItem
from app.modules.requisitions.schemas import RequisitionCreate, RequisitionOut, PrincipalDecision, CloseIn
from app.modules.workflow.models import WorkflowEvent
from app.modules.audit.models import AuditLog
from app.modules.workflow.service import transition

router = APIRouter(prefix="/requisitions", tags=["Requisitions"])

# Amount gate decided by Principal approval: requisitions below this total are
# purchased directly by the owning department, skipping Finance Committee.
DIRECT_PURCHASE_LIMIT = Decimal("10000")

def requisition_total(req) -> Decimal:
    return sum((Decimal(item.quantity) * item.tentative_unit_price for item in req.items), Decimal("0"))

# Display-only labels for tracking. The workflow itself (valid statuses and moves)
# is defined solely by TRANSITIONS in app/modules/workflow/service.py — this map
# must stay keyed to those statuses and never gates any logic.
STATUS_META: dict[str, tuple[str, str]] = {
    "DRAFT": ("Draft — with department", "DEPARTMENT_USER"),
    "SUBMITTED": ("Submitted — awaiting HOD decision", "HOD"),
    "PRINCIPAL_REVIEW": ("Principal review", "PRINCIPAL"),
    "RETURNED_TO_DEPARTMENT": ("Returned to department for correction", "DEPARTMENT_USER"),
    "HOD_REJECTED": ("Rejected by HOD — closed", "HOD"),
    "PRINCIPAL_REJECTED": ("Rejected by Principal — closed", "PRINCIPAL"),
    "FINANCE_REVIEW": ("Finance Committee — head & sub-head review", "FINANCE"),
    "BUDGET_ALLOCATED": ("Budget allocated — with purchase committee", "PURCHASE_COMMITTEE"),
    "DIRECT_PURCHASE": ("Direct purchase — with department", "DEPARTMENT_USER"),
    "FINANCE_REJECTED": ("Rejected by Finance — closed", "FINANCE"),
    "PROCUREMENT_IN_PROGRESS": ("Procurement in progress — vendor selection", "PURCHASE_COMMITTEE"),
    "VENDOR_SELECTED": ("Vendor selected — PO pending", "PURCHASE_COMMITTEE"),
    "PO_ISSUED": ("PO issued — awaiting delivery", "STORE_OFFICER"),
    "DELIVERED": ("Delivered — departmental acceptance of items", "DEPARTMENT_USER"),
    "ACCEPTED": ("Accepted — stock entry pending", "STORE_OFFICER"),
    "PARTIALLY_ACCEPTED": ("Partially accepted — stock entry pending", "STORE_OFFICER"),
    "DELIVERY_REJECTED": ("Delivery rejected — closed", "ACCEPTANCE_OFFICER"),
    "STOCK_UPDATED": ("Stock updated — bill pending", "BURSAR"),
    "BILL_SUBMITTED": ("Bill submitted — verification pending", "BURSAR"),
    "BILL_VERIFIED": ("Bill verified — payment pending", "BURSAR"),
    "PAYMENT_COMPLETED": ("Payment completed — UC pending", "BURSAR"),
    "UC_GENERATED": ("UC generated — AMC or closure", "BURSAR"),
    "AMC_ACTIVE": ("AMC active — closure pending", "AMC_OFFICER"),
    "CLOSED": ("Closed", "BURSAR"),
}
# Canonical happy-path order for the public checklist (side branches handled below).
MAIN_FLOW = ["DRAFT", "SUBMITTED", "PRINCIPAL_REVIEW", "FINANCE_REVIEW", "BUDGET_ALLOCATED",
    "PROCUREMENT_IN_PROGRESS", "VENDOR_SELECTED", "PO_ISSUED", "DELIVERED", "ACCEPTED",
    "STOCK_UPDATED", "BILL_SUBMITTED", "BILL_VERIFIED", "PAYMENT_COMPLETED", "UC_GENERATED",
    "AMC_ACTIVE", "CLOSED"]
# Terminal side-branch status -> main-flow stage it failed at.
FAILED_AT = {"HOD_REJECTED": "SUBMITTED", "PRINCIPAL_REJECTED": "PRINCIPAL_REVIEW",
    "FINANCE_REJECTED": "FINANCE_REVIEW", "DELIVERY_REJECTED": "DELIVERED",
    "RETURNED_TO_DEPARTMENT": "SUBMITTED", "PARTIALLY_ACCEPTED": "ACCEPTED"}

def _checklist(status: str, direct_done: bool = False) -> list[dict]:
    # DIRECT_PURCHASE positions at PRINCIPAL_REVIEW but is not a failure.
    at = {"DIRECT_PURCHASE": "PRINCIPAL_REVIEW"}.get(status, FAILED_AT.get(status, status))
    failed = status in FAILED_AT and status != "PARTIALLY_ACCEPTED"
    try:
        idx = MAIN_FLOW.index(at)
    except ValueError:
        idx = 0
    out = []
    for i, key in enumerate(MAIN_FLOW):
        label, _ = STATUS_META.get(key, (key, ""))
        state = "done" if i < idx else ("current" if i == idx and not failed else "todo")
        out.append({"key": key, "label": label, "state": state})
        if key == "PRINCIPAL_REVIEW" and (status == "DIRECT_PURCHASE" or direct_done):
            # Side branch off Principal: show direct purchase inline, not appended at the end.
            dlabel, _ = STATUS_META.get("DIRECT_PURCHASE", ("DIRECT_PURCHASE", ""))
            out.append({"key": "DIRECT_PURCHASE", "label": dlabel,
                "state": "done" if direct_done and status != "DIRECT_PURCHASE" else "current"})
    if status not in MAIN_FLOW and status != "DIRECT_PURCHASE":
        label, _ = STATUS_META.get(status, (status, ""))
        out.append({"key": status, "label": label, "state": "current" if failed or status == "PARTIALLY_ACCEPTED" else "todo"})
        if failed:
            out[idx] = {**out[idx], "state": "done"}
    return out

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

def get_req(db: Session, req_id: str, user: User, allow_principal=True):
    req = db.get(Requisition, req_id)
    if not req or req.institution_id != user.institution_id:
        raise HTTPException(404, "Requisition not found")
    if user.role in {"DEPARTMENT_USER", "HOD"} and req.department_id != user.department_id:
        raise HTTPException(403, "Forbidden")
    if not allow_principal and user.role == "PRINCIPAL":
        raise HTTPException(403, "Forbidden")
    return req

@router.post("", response_model=RequisitionOut)
def create_requisition(payload: RequisitionCreate, db: Session = Depends(get_db), user: User = Depends(require_roles("DEPARTMENT_USER"))):
    if not user.department_id:
        raise HTTPException(400, "User has no department assigned")
    dept = db.get(Department, user.department_id)
    inst = db.get(Institution, user.institution_id)
    if not dept or not dept.is_active:
        raise HTTPException(400, "User's department is not active")
    req = Requisition(
        procurement_id=next_procurement_id(db, user.institution_id, dept.code),
        institution_id=user.institution_id, department_id=dept.id, faculty_user_id=user.id,
        institution_name_snapshot=inst.name if inst else None,
        department_name_snapshot=dept.name, department_code_snapshot=dept.code,
        faculty_name_snapshot=user.name, faculty_employee_id_snapshot=user.employee_id,
        faculty_designation_snapshot=user.designation,
        status="DRAFT", category=payload.category, justification=payload.justification,
    )
    for i, item in enumerate(payload.items, 1):
        req.items.append(RequisitionItem(line_no=i, item_name=item.item_name, specification=item.specification,
                                         quantity=item.quantity, tentative_unit_price=item.tentative_unit_price))
    db.add(req); db.commit(); db.refresh(req); return req

@router.get("/hod/pending", response_model=list[RequisitionOut])
def hod_pending(db: Session = Depends(get_db), user: User = Depends(require_roles("HOD"))):
    return db.query(Requisition).filter(Requisition.institution_id == user.institution_id,
        Requisition.department_id == user.department_id, Requisition.status == "SUBMITTED")\
        .order_by(Requisition.created_at.asc()).all()

@router.get("/principal/pending", response_model=list[RequisitionOut])
def principal_pending(db: Session = Depends(get_db), user: User = Depends(require_roles("PRINCIPAL"))):
    return db.query(Requisition).filter(Requisition.institution_id == user.institution_id,
        Requisition.status == "PRINCIPAL_REVIEW").order_by(Requisition.created_at.asc()).all()

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
    # A direct purchase rejoins the shared PO_ISSUED status with the committee flow.
    # Disambiguate from history so tracking never attributes it to the committee/store:
    # the DIRECT_PURCHASED event's actor role proves the department drove this branch.
    direct = db.query(WorkflowEvent).filter(WorkflowEvent.requisition_id == req.id,
        WorkflowEvent.action == "DIRECT_PURCHASED").first() is not None
    if direct and req.status in {"DIRECT_PURCHASE", "PO_ISSUED", "DELIVERED"}:
        owner = "DEPARTMENT_USER (direct purchase)"
    return {"procurement_id": req.procurement_id, "status": req.status,
        "stage_label": label, "owner_role": owner,
        "checklist": _checklist(req.status, direct_done=direct), "last_updated": req.updated_at}

@router.get("/{req_id}/history")
def requisition_history(req_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # Same authorization as every other protected requisition read.
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
    # Complete technical audit trail for one requisition. Same authorization as
    # every other protected requisition read; unlike /history this exposes the
    # actor's name plus the recorded before/after state of each action.
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
    if user.role in {"DEPARTMENT_USER", "HOD"}:
        q = q.filter(Requisition.department_id == user.department_id)
    return q.order_by(Requisition.created_at.desc()).all()

@router.get("/{req_id}", response_model=RequisitionOut)
def get_requisition(req_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return get_req(db, req_id, user)

@router.post("/{req_id}/submit", response_model=RequisitionOut)
def submit(req_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("DEPARTMENT_USER"))):
    return transition(db, get_req(db, req_id, user), "SUBMIT", user)

@router.post("/{req_id}/hod/approve", response_model=RequisitionOut)
def hod_approve(req_id: str, payload: PrincipalDecision, db: Session = Depends(get_db), user: User = Depends(require_roles("HOD"))):
    return transition(db, get_req(db, req_id, user), "HOD_APPROVE", user, payload.remarks)

@router.post("/{req_id}/hod/reject", response_model=RequisitionOut)
def hod_reject(req_id: str, payload: PrincipalDecision, db: Session = Depends(get_db), user: User = Depends(require_roles("HOD"))):
    return transition(db, get_req(db, req_id, user), "HOD_REJECT", user, payload.remarks)

@router.post("/{req_id}/hod/return", response_model=RequisitionOut)
def hod_return(req_id: str, payload: PrincipalDecision, db: Session = Depends(get_db), user: User = Depends(require_roles("HOD"))):
    return transition(db, get_req(db, req_id, user), "HOD_RETURN", user, payload.remarks)

@router.post("/{req_id}/principal/approve", response_model=RequisitionOut)
def principal_approve(req_id: str, payload: PrincipalDecision, db: Session = Depends(get_db), user: User = Depends(require_roles("PRINCIPAL"))):
    req = get_req(db, req_id, user)
    # Amount gate on the server-computed item total: below the limit the owning
    # department purchases directly, skipping Finance Committee entirely.
    if requisition_total(req) < DIRECT_PURCHASE_LIMIT:
        return transition(db, req, "PRINCIPAL_APPROVE_DIRECT", user, payload.remarks)
    return transition(db, req, "PRINCIPAL_APPROVE", user, payload.remarks)

@router.post("/{req_id}/principal/reject", response_model=RequisitionOut)
def principal_reject(req_id: str, payload: PrincipalDecision, db: Session = Depends(get_db), user: User = Depends(require_roles("PRINCIPAL"))):
    return transition(db, get_req(db, req_id, user), "PRINCIPAL_REJECT", user, payload.remarks)

@router.post("/{req_id}/principal/return", response_model=RequisitionOut)
def principal_return(req_id: str, payload: PrincipalDecision, db: Session = Depends(get_db), user: User = Depends(require_roles("PRINCIPAL"))):
    return transition(db, get_req(db, req_id, user), "PRINCIPAL_RETURN", user, payload.remarks)

@router.get("/{req_id}/pdf")
def requisition_pdf(req_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.modules.procurement_models import (FinanceReview, ProcurementDecision, Vendor,
        PurchaseOrder, DeliveryReceipt, Acceptance, StockEntry, Bill, Payment,
        UtilizationCertificate, AMC)
    from app.modules.requisitions.pdf_document import build_procurement_pdf
    req = get_req(db, req_id, user)
    q1 = lambda m: db.query(m).filter(m.requisition_id == req.id).first()
    fr, pd, po, dl, ac, st, bill, pay, uc, amc = (q1(m) for m in
        (FinanceReview, ProcurementDecision, PurchaseOrder, DeliveryReceipt, Acceptance,
         StockEntry, Bill, Payment, UtilizationCertificate, AMC))
    po_vendor = db.get(Vendor, po.vendor_id) if po else None
    sel_vendor = db.get(Vendor, pd.selected_vendor_id) if pd and pd.selected_vendor_id else None
    amc_vendor = db.get(Vendor, amc.vendor_id) if amc and amc.vendor_id else None
    data = {"finance_review": fr, "procurement_decision": pd,
        "selected_vendor_name": sel_vendor.name if sel_vendor else None,
        "selected_vendor_gstin": sel_vendor.gstin if sel_vendor else None,
        "selected_vendor_contact": sel_vendor.contact if sel_vendor else None,
        "purchase_order": po, "po_vendor": po_vendor, "delivery": dl,
        "acceptance": ac, "stock_entry": st, "bill": bill, "payment": pay,
        "uc": uc, "amc": amc, "amc_vendor": amc_vendor}
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
    if user.role in {"DEPARTMENT_USER", "HOD"}: q = q.filter(Requisition.department_id == user.department_id)
    output = io.StringIO(); writer = csv.writer(output)
    writer.writerow(["Procurement ID","Institution","Department Code","Department","Faculty/Staff","Employee ID","Designation","Status","Category","Justification","Item","Quantity","Unit Price","Line Total"])
    for req in q.order_by(Requisition.created_at.desc()).all():
        for item in req.items:
            writer.writerow([req.procurement_id, req.institution_name_snapshot, req.department_code_snapshot,
                req.department_name_snapshot, req.faculty_name_snapshot, req.faculty_employee_id_snapshot,
                req.faculty_designation_snapshot, req.status, req.category, req.justification,
                item.item_name, item.quantity, str(item.tentative_unit_price), str(item.line_total)])
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=procurement.csv"})

# -------- Post-Principal procurement execution --------
from datetime import datetime, timezone
from app.modules.procurement_models import FinanceReview, ProcurementDecision, Vendor, PurchaseOrder, DeliveryReceipt, Acceptance, StockEntry, Bill, Payment, UtilizationCertificate, AMC
from app.modules.requisitions.schemas import FinanceReviewIn, ProcurementDecisionIn, VendorSelectionIn, DirectPurchaseIn, PurchaseOrderIn, DeliveryIn, AcceptanceIn, StockEntryIn, BillIn, PaymentIn, UCIn, AMCIn, CloseIn

def _transition(db, req, action, user, remarks=None):
    return transition(db, req, action, user, remarks)


@router.post("/{req_id}/finance/review", response_model=RequisitionOut)
def finance_review(req_id: str, payload: FinanceReviewIn, db: Session = Depends(get_db), user: User = Depends(require_roles("FINANCE", "BURSAR", "ACCOUNTANT", "ADMIN", "PRINCIPAL"))):
    req=get_req(db,req_id,user); 
    if req.status != "FINANCE_REVIEW": raise HTTPException(409,"Requisition is not awaiting finance review")
    if payload.decision=="APPROVE" and payload.approved_amount is None: raise HTTPException(400,"approved_amount is required for approval")
    if payload.decision=="APPROVE" and (not (payload.budget_head or "").strip() or not (payload.sub_head or "").strip()):
        raise HTTPException(400,"budget_head and sub_head are required for approval")
    db.add(FinanceReview(requisition_id=req.id,decision=payload.decision,budget_head=payload.budget_head,sub_head=payload.sub_head,approved_amount=payload.approved_amount,remarks=payload.remarks,actor_id=user.id))
    action={"APPROVE":"FINANCE_APPROVE","RETURN":"FINANCE_RETURN","REJECT":"FINANCE_REJECT"}[payload.decision]
    return _transition(db,req,action,user,payload.remarks)

@router.post("/{req_id}/direct-purchase", response_model=RequisitionOut)
def direct_purchase(req_id: str, payload: DirectPurchaseIn, db: Session = Depends(get_db), user: User = Depends(require_roles("DEPARTMENT_USER","HOD","ADMIN"))):
    # Below-limit branch: the owning department buys directly (vendor + PO in one
    # step) and rejoins the shared flow at PO_ISSUED. get_req scopes dept users/HODs
    # to their own department, so a department can only purchase for itself.
    req=get_req(db,req_id,user)
    if req.status!="DIRECT_PURCHASE": raise HTTPException(409,"Requisition is not awaiting direct purchase")
    v=Vendor(institution_id=req.institution_id,name=payload.vendor_name,contact=payload.contact); db.add(v); db.flush()
    db.add(PurchaseOrder(requisition_id=req.id,vendor_id=v.id,po_number=payload.po_number,total_amount=payload.total_amount))
    return _transition(db,req,"DIRECT_PURCHASED",user,payload.remarks)

@router.post("/{req_id}/procurement/method", response_model=RequisitionOut)
def procurement_method(req_id: str, payload: ProcurementDecisionIn, db: Session = Depends(get_db), user: User = Depends(require_roles("PURCHASE_COMMITTEE","TENDER_COMMITTEE","ADMIN"))):
    req=get_req(db,req_id,user)
    if req.status!="BUDGET_ALLOCATED": raise HTTPException(409,"Budget must be allocated first")
    db.add(ProcurementDecision(requisition_id=req.id,method=payload.method,meeting_no=payload.meeting_no,rule_reference=payload.rule_reference,remarks=payload.remarks,actor_id=user.id))
    return _transition(db,req,"PROCUREMENT_METHOD_DECIDED",user,payload.remarks)

@router.post("/{req_id}/procurement/vendor", response_model=RequisitionOut)
def select_vendor(req_id: str, payload: VendorSelectionIn, db: Session = Depends(get_db), user: User = Depends(require_roles("PURCHASE_COMMITTEE","TENDER_COMMITTEE","ADMIN"))):
    req=get_req(db,req_id,user)
    if req.status!="PROCUREMENT_IN_PROGRESS": raise HTTPException(409,"Procurement is not in progress")
    v=Vendor(institution_id=req.institution_id,name=payload.vendor_name,gstin=payload.gstin,contact=payload.contact); db.add(v); db.flush()
    pd=db.query(ProcurementDecision).filter(ProcurementDecision.requisition_id==req.id).first()
    if pd: pd.selected_vendor_id=v.id
    return _transition(db,req,"VENDOR_SELECTED",user,payload.remarks)

@router.post("/{req_id}/procurement/po", response_model=RequisitionOut)
def issue_po(req_id: str, payload: PurchaseOrderIn, db: Session = Depends(get_db), user: User = Depends(require_roles("PURCHASE_COMMITTEE","TENDER_COMMITTEE","ADMIN"))):
    req=get_req(db,req_id,user)
    if req.status!="VENDOR_SELECTED": raise HTTPException(409,"Vendor must be selected first")
    pd=db.query(ProcurementDecision).filter(ProcurementDecision.requisition_id==req.id).first()
    v=db.get(Vendor, pd.selected_vendor_id) if pd and pd.selected_vendor_id else None
    if not v: raise HTTPException(400,"Vendor not found")
    db.add(PurchaseOrder(requisition_id=req.id,vendor_id=v.id,po_number=payload.po_number,total_amount=payload.total_amount,warranty_months=payload.warranty_months,amc_required=payload.amc_required,delivery_terms=payload.delivery_terms))
    return _transition(db,req,"PO_ISSUED",user,payload.remarks)

@router.post("/{req_id}/delivery", response_model=RequisitionOut)
def record_delivery(req_id: str, payload: DeliveryIn, db: Session = Depends(get_db), user: User = Depends(require_roles("STORE", "STORE_OFFICER", "DEPARTMENT_USER", "ADMIN"))):
    req=get_req(db,req_id,user)
    if req.status!="PO_ISSUED": raise HTTPException(409,"Purchase Order must be issued first")
    db.add(DeliveryReceipt(requisition_id=req.id,delivery_date=datetime.now(timezone.utc),invoice_number=payload.invoice_number,challan_number=payload.challan_number,remarks=payload.remarks))
    return _transition(db,req,"DELIVERED",user,payload.remarks)

@router.post("/{req_id}/acceptance", response_model=RequisitionOut)
def accept_delivery(req_id: str, payload: AcceptanceIn, db: Session = Depends(get_db), user: User = Depends(require_roles("DEPARTMENT_USER","HOD","ADMIN"))):
    req=get_req(db,req_id,user)
    if req.status!="DELIVERED": raise HTTPException(409,"Delivery is not awaiting acceptance")
    db.add(Acceptance(requisition_id=req.id,decision=payload.decision,remarks=payload.remarks,actor_id=user.id))
    action={"ACCEPT":"ACCEPTED","PARTIAL":"PARTIALLY_ACCEPTED","REJECT":"REJECT_DELIVERY"}[payload.decision]
    return _transition(db,req,action,user,payload.remarks)

@router.post("/{req_id}/stock", response_model=RequisitionOut)
def update_stock(req_id: str, payload: StockEntryIn, db: Session = Depends(get_db), user: User = Depends(require_roles("STORE","STORE_OFFICER","ADMIN"))):
    req=get_req(db,req_id,user)
    if req.status not in {"ACCEPTED","PARTIALLY_ACCEPTED"}: raise HTTPException(409,"Department acceptance is required first")
    db.add(StockEntry(requisition_id=req.id,register_type=payload.register_type,asset_id=payload.asset_id,serial_no=payload.serial_no,remarks=payload.remarks))
    return _transition(db,req,"STOCK_UPDATED",user,payload.remarks)

@router.post("/{req_id}/bill", response_model=RequisitionOut)
def submit_bill(req_id: str, payload: BillIn, db: Session = Depends(get_db), user: User = Depends(require_roles("BURSAR","ACCOUNTANT","ADMIN"))):
    req=get_req(db,req_id,user)
    if req.status!="STOCK_UPDATED": raise HTTPException(409,"Stock/asset entry is required first")
    db.add(Bill(requisition_id=req.id,invoice_number=payload.invoice_number,amount=payload.amount,remarks=payload.remarks))
    return _transition(db,req,"BILL_SUBMITTED",user,payload.remarks)

@router.post("/{req_id}/bill/verify", response_model=RequisitionOut)
def verify_bill(req_id: str, payload: PrincipalDecision, db: Session = Depends(get_db), user: User = Depends(require_roles("BURSAR","ACCOUNTANT","AUDITOR","ADMIN"))):
    req=get_req(db,req_id,user)
    if req.status!="BILL_SUBMITTED": raise HTTPException(409,"No submitted bill to verify")
    bill=db.query(Bill).filter(Bill.requisition_id==req.id).first()
    if not bill: raise HTTPException(404,"Bill not found")
    bill.verified=True; bill.remarks=payload.remarks
    return _transition(db,req,"BILL_VERIFIED",user,payload.remarks)

@router.post("/{req_id}/payment", response_model=RequisitionOut)
def complete_payment(req_id: str, payload: PaymentIn, db: Session = Depends(get_db), user: User = Depends(require_roles("BURSAR","ACCOUNTANT","ADMIN"))):
    req=get_req(db,req_id,user)
    if req.status!="BILL_VERIFIED": raise HTTPException(409,"Bill must be verified first")
    db.add(Payment(requisition_id=req.id,payment_reference=payload.payment_reference,amount=payload.amount))
    return _transition(db,req,"PAYMENT_COMPLETED",user,payload.remarks)

@router.post("/{req_id}/uc", response_model=RequisitionOut)
def generate_uc(req_id: str, payload: UCIn, db: Session = Depends(get_db), user: User = Depends(require_roles("BURSAR","ACCOUNTANT","ADMIN"))):
    req=get_req(db,req_id,user)
    if req.status!="PAYMENT_COMPLETED": raise HTTPException(409,"Payment must be completed first")
    db.add(UtilizationCertificate(requisition_id=req.id,certificate_no=payload.certificate_no,remarks=payload.remarks))
    return _transition(db,req,"UC_GENERATE",user,payload.remarks)

@router.post("/{req_id}/amc", response_model=RequisitionOut)
def start_amc(req_id: str, payload: AMCIn, db: Session = Depends(get_db), user: User = Depends(require_roles("AMC_OFFICER","ADMIN"))):
    req=get_req(db,req_id,user)
    if req.status!="UC_GENERATED": raise HTTPException(409,"UC must be generated first")
    po=db.query(PurchaseOrder).filter(PurchaseOrder.requisition_id==req.id).first()
    if not po or not po.amc_required: raise HTTPException(400,"AMC is not marked as required")
    db.add(AMC(requisition_id=req.id,start_date=payload.start_date,end_date=payload.end_date,vendor_id=po.vendor_id,contract_no=payload.contract_no,remarks=payload.remarks))
    return _transition(db,req,"AMC_START",user,payload.remarks)

@router.post("/{req_id}/close", response_model=RequisitionOut)
def close_procurement(req_id: str, payload: CloseIn, db: Session = Depends(get_db), user: User = Depends(require_roles("BURSAR","ADMIN","PRINCIPAL"))):
    req=get_req(db,req_id,user)
    if req.status not in {"UC_GENERATED","AMC_ACTIVE"}: raise HTTPException(409,"Procurement is not ready for closure")
    return _transition(db,req,"CLOSE",user,payload.remarks)
