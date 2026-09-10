from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy.orm import Session
from app.modules.requisitions.models import Requisition
from app.modules.workflow.models import WorkflowEvent
from app.modules.audit.models import AuditLog

# Canonical state machine (new workflow, Sep 2026):
#   DRAFT -> SUBMITTED (dept) | PRINCIPAL_REVIEW (HOD/office create = HOD auto-passed)
#   SUBMITTED -> PRINCIPAL_REVIEW (HOD approve) | HOD_REJECTED (terminal)
#   PRINCIPAL_REVIEW -> FINANCE_REVIEW (>=₹10,000) | ACCEPTANCE (<₹10,000, direct)
#                      | PRINCIPAL_REJECTED (terminal)
#   FINANCE_REVIEW -> METHOD_PENDING (forwarded; no reject/return)
#   METHOD_PENDING -> WO_PENDING (method decided)
#   WO_PENDING -> ACCEPTANCE (work order PDF uploaded)
#   ACCEPTANCE -> BURSAR_REVIEW (acceptance recorded, origin-routed actor)
#   BURSAR_REVIEW -> COMPLETED (payment recorded; every field optional)
# Entries below the "legacy" line belong to the pre-Sep-2026 flow. They are kept
# so in-flight records keep readable history, but no endpoint drives them anymore
# (grandfathered: frozen, readable, exportable).
TRANSITIONS = {
 ('DRAFT','SUBMIT'):'SUBMITTED', ('DRAFT','SUBMIT_DIRECT'):'PRINCIPAL_REVIEW',
 ('SUBMITTED','HOD_APPROVE'):'PRINCIPAL_REVIEW', ('SUBMITTED','HOD_REJECT'):'HOD_REJECTED',
 ('PRINCIPAL_REVIEW','PRINCIPAL_APPROVE'):'FINANCE_REVIEW', ('PRINCIPAL_REVIEW','PRINCIPAL_APPROVE_DIRECT'):'ACCEPTANCE', ('PRINCIPAL_REVIEW','PRINCIPAL_REJECT'):'PRINCIPAL_REJECTED',
 ('FINANCE_REVIEW','FINANCE_FORWARD'):'METHOD_PENDING',
 ('METHOD_PENDING','METHOD_DECIDED'):'WO_PENDING',
 ('WO_PENDING','WO_UPLOADED'):'ACCEPTANCE',
 ('ACCEPTANCE','ACCEPTANCE_DONE'):'BURSAR_REVIEW',
 ('BURSAR_REVIEW','PAYMENT_RECORDED'):'COMPLETED',
 # --- legacy (pre-Sep-2026), grandfathered ---
 ('PRINCIPAL_REVIEW','PRINCIPAL_RETURN'):'RETURNED_TO_DEPARTMENT', ('SUBMITTED','HOD_RETURN'):'RETURNED_TO_DEPARTMENT',
 ('RETURNED_TO_DEPARTMENT','RESUBMIT'):'SUBMITTED',
 ('FINANCE_REVIEW','FINANCE_APPROVE'):'BUDGET_ALLOCATED', ('FINANCE_REVIEW','FINANCE_RETURN'):'RETURNED_TO_DEPARTMENT', ('FINANCE_REVIEW','FINANCE_REJECT'):'FINANCE_REJECTED',
 ('BUDGET_ALLOCATED','PROCUREMENT_METHOD_DECIDED'):'PROCUREMENT_IN_PROGRESS',
 ('DIRECT_PURCHASE','DIRECT_PURCHASED'):'PO_ISSUED',
 ('PROCUREMENT_IN_PROGRESS','VENDOR_SELECTED'):'VENDOR_SELECTED', ('VENDOR_SELECTED','PO_ISSUED'):'PO_ISSUED',
 ('PO_ISSUED','DELIVERED'):'DELIVERED', ('DELIVERED','ACCEPTED'):'ACCEPTED', ('DELIVERED','PARTIALLY_ACCEPTED'):'PARTIALLY_ACCEPTED', ('DELIVERED','REJECT_DELIVERY'):'DELIVERY_REJECTED',
 ('ACCEPTED','STOCK_UPDATED'):'STOCK_UPDATED', ('PARTIALLY_ACCEPTED','STOCK_UPDATED'):'STOCK_UPDATED',
 ('STOCK_UPDATED','BILL_SUBMITTED'):'BILL_SUBMITTED', ('BILL_SUBMITTED','BILL_VERIFIED'):'BILL_VERIFIED', ('BILL_VERIFIED','PAYMENT_COMPLETED'):'PAYMENT_COMPLETED',
 ('PAYMENT_COMPLETED','UC_GENERATE'):'UC_GENERATED', ('UC_GENERATED','AMC_START'):'AMC_ACTIVE', ('UC_GENERATED','CLOSE'):'CLOSED', ('AMC_ACTIVE','CLOSE'):'CLOSED'
}

def transition(db: Session, req: Requisition, action: str, actor, remarks: str|None=None):
    new_status=TRANSITIONS.get((req.status,action))
    if not new_status: raise HTTPException(409,f"Action '{action}' is not allowed from status '{req.status}'")
    old=req.status; req.status=new_status; now=datetime.now(timezone.utc)
    if action.startswith('HOD_'): req.hod_remarks=remarks; req.hod_decision_by=actor.id; req.hod_decision_at=now
    elif action.startswith('PRINCIPAL_'): req.principal_remarks=remarks; req.principal_decision_by=actor.id; req.principal_decision_at=now
    db.add(WorkflowEvent(requisition_id=req.id,from_status=old,to_status=new_status,action=action,actor_id=actor.id,remarks=remarks))
    db.add(AuditLog(institution_id=req.institution_id,entity_type='REQUISITION',entity_id=req.id,action=action,actor_id=actor.id,before_data={'status':old},after_data={'status':new_status,'remarks':remarks},remarks=remarks))
    db.commit(); db.refresh(req); return req
