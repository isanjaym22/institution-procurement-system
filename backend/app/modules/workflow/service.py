from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy.orm import Session
from app.modules.requisitions.models import Requisition
from app.modules.workflow.models import WorkflowEvent
from app.modules.audit.models import AuditLog

TRANSITIONS = {
 ('DRAFT','SUBMIT'):'SUBMITTED', ('SUBMITTED','HOD_APPROVE'):'PRINCIPAL_REVIEW', ('SUBMITTED','HOD_REJECT'):'HOD_REJECTED', ('SUBMITTED','HOD_RETURN'):'RETURNED_TO_DEPARTMENT',
 ('PRINCIPAL_REVIEW','PRINCIPAL_APPROVE'):'FINANCE_REVIEW', ('PRINCIPAL_REVIEW','PRINCIPAL_APPROVE_DIRECT'):'DIRECT_PURCHASE', ('PRINCIPAL_REVIEW','PRINCIPAL_REJECT'):'PRINCIPAL_REJECTED', ('PRINCIPAL_REVIEW','PRINCIPAL_RETURN'):'RETURNED_TO_DEPARTMENT',
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
