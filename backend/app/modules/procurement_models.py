import uuid
from decimal import Decimal
from sqlalchemy import String, Text, Numeric, Integer, DateTime, ForeignKey, Boolean, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base

class FinanceReview(Base):
    __tablename__='finance_reviews'
    id: Mapped[str]=mapped_column(String(36), primary_key=True, default=lambda:str(uuid.uuid4()))
    requisition_id: Mapped[str]=mapped_column(ForeignKey('requisitions.id'), unique=True, nullable=False)
    budget_head: Mapped[str|None]=mapped_column(String(100)); sub_head: Mapped[str|None]=mapped_column(String(100)); approved_amount: Mapped[Decimal|None]=mapped_column(Numeric(18,2))
    remarks: Mapped[str|None]=mapped_column(Text); decision: Mapped[str]=mapped_column(String(30), nullable=False)
    actor_id: Mapped[str]=mapped_column(ForeignKey('users.id'), nullable=False); decided_at: Mapped[object]=mapped_column(DateTime(timezone=True), server_default=func.now())

class ProcurementDecision(Base):
    __tablename__='procurement_decisions'
    id: Mapped[str]=mapped_column(String(36), primary_key=True, default=lambda:str(uuid.uuid4()))
    requisition_id: Mapped[str]=mapped_column(ForeignKey('requisitions.id'), unique=True, nullable=False)
    method: Mapped[str]=mapped_column(String(30), nullable=False)
    meeting_no: Mapped[str|None]=mapped_column(String(80)); meeting_date: Mapped[object|None]=mapped_column(DateTime(timezone=True))
    rule_reference: Mapped[str|None]=mapped_column(String(200)); selected_vendor_id: Mapped[str|None]=mapped_column(String(36)); remarks: Mapped[str|None]=mapped_column(Text)
    actor_id: Mapped[str]=mapped_column(ForeignKey('users.id'), nullable=False); decided_at: Mapped[object]=mapped_column(DateTime(timezone=True), server_default=func.now())

class Vendor(Base):
    __tablename__='vendors'
    id: Mapped[str]=mapped_column(String(36), primary_key=True, default=lambda:str(uuid.uuid4()))
    institution_id: Mapped[str]=mapped_column(ForeignKey('institutions.id'), nullable=False)
    name: Mapped[str]=mapped_column(String(200), nullable=False); gstin: Mapped[str|None]=mapped_column(String(30)); contact: Mapped[str|None]=mapped_column(String(120)); is_active: Mapped[bool]=mapped_column(Boolean, default=True, nullable=False)

class PurchaseOrder(Base):
    __tablename__='purchase_orders'
    id: Mapped[str]=mapped_column(String(36), primary_key=True, default=lambda:str(uuid.uuid4()))
    requisition_id: Mapped[str]=mapped_column(ForeignKey('requisitions.id'), unique=True, nullable=False)
    vendor_id: Mapped[str]=mapped_column(ForeignKey('vendors.id'), nullable=False); po_number: Mapped[str]=mapped_column(String(100), unique=True, nullable=False)
    po_date: Mapped[object]=mapped_column(DateTime(timezone=True), server_default=func.now()); total_amount: Mapped[Decimal]=mapped_column(Numeric(18,2), nullable=False)
    warranty_months: Mapped[int|None]=mapped_column(Integer); amc_required: Mapped[bool]=mapped_column(Boolean, default=False, nullable=False); delivery_terms: Mapped[str|None]=mapped_column(Text)

class DeliveryReceipt(Base):
    __tablename__='delivery_receipts'
    id: Mapped[str]=mapped_column(String(36), primary_key=True, default=lambda:str(uuid.uuid4()))
    requisition_id: Mapped[str]=mapped_column(ForeignKey('requisitions.id'), unique=True, nullable=False)
    delivery_date: Mapped[object]=mapped_column(DateTime(timezone=True), nullable=False); invoice_number: Mapped[str|None]=mapped_column(String(100)); challan_number: Mapped[str|None]=mapped_column(String(100)); remarks: Mapped[str|None]=mapped_column(Text)

class Acceptance(Base):
    __tablename__='acceptances'
    id: Mapped[str]=mapped_column(String(36), primary_key=True, default=lambda:str(uuid.uuid4()))
    requisition_id: Mapped[str]=mapped_column(ForeignKey('requisitions.id'), unique=True, nullable=False)
    decision: Mapped[str]=mapped_column(String(30), nullable=False); remarks: Mapped[str|None]=mapped_column(Text); actor_id: Mapped[str]=mapped_column(ForeignKey('users.id'), nullable=False); accepted_at: Mapped[object]=mapped_column(DateTime(timezone=True), server_default=func.now())

class StockEntry(Base):
    __tablename__='stock_entries'
    id: Mapped[str]=mapped_column(String(36), primary_key=True, default=lambda:str(uuid.uuid4()))
    requisition_id: Mapped[str]=mapped_column(ForeignKey('requisitions.id'), unique=True, nullable=False)
    register_type: Mapped[str]=mapped_column(String(30), nullable=False); asset_id: Mapped[str|None]=mapped_column(String(100)); serial_no: Mapped[str|None]=mapped_column(String(100)); entry_date: Mapped[object]=mapped_column(DateTime(timezone=True), server_default=func.now()); remarks: Mapped[str|None]=mapped_column(Text)

class Bill(Base):
    __tablename__='bills'
    id: Mapped[str]=mapped_column(String(36), primary_key=True, default=lambda:str(uuid.uuid4()))
    requisition_id: Mapped[str]=mapped_column(ForeignKey('requisitions.id'), unique=True, nullable=False)
    invoice_number: Mapped[str]=mapped_column(String(100), nullable=False); amount: Mapped[Decimal]=mapped_column(Numeric(18,2), nullable=False); verified: Mapped[bool]=mapped_column(Boolean, default=False, nullable=False); remarks: Mapped[str|None]=mapped_column(Text)

class Payment(Base):
    __tablename__='payments'
    id: Mapped[str]=mapped_column(String(36), primary_key=True, default=lambda:str(uuid.uuid4()))
    requisition_id: Mapped[str]=mapped_column(ForeignKey('requisitions.id'), unique=True, nullable=False)
    payment_reference: Mapped[str]=mapped_column(String(120), nullable=False); amount: Mapped[Decimal]=mapped_column(Numeric(18,2), nullable=False); payment_date: Mapped[object]=mapped_column(DateTime(timezone=True), server_default=func.now())

class UtilizationCertificate(Base):
    __tablename__='utilization_certificates'
    id: Mapped[str]=mapped_column(String(36), primary_key=True, default=lambda:str(uuid.uuid4()))
    requisition_id: Mapped[str]=mapped_column(ForeignKey('requisitions.id'), unique=True, nullable=False); certificate_no: Mapped[str]=mapped_column(String(100), nullable=False); issued_at: Mapped[object]=mapped_column(DateTime(timezone=True), server_default=func.now()); remarks: Mapped[str|None]=mapped_column(Text)

class AMC(Base):
    __tablename__='amcs'
    id: Mapped[str]=mapped_column(String(36), primary_key=True, default=lambda:str(uuid.uuid4()))
    requisition_id: Mapped[str]=mapped_column(ForeignKey('requisitions.id'), unique=True, nullable=False); vendor_id: Mapped[str|None]=mapped_column(ForeignKey('vendors.id')); start_date: Mapped[object]=mapped_column(DateTime(timezone=True), nullable=False); end_date: Mapped[object]=mapped_column(DateTime(timezone=True), nullable=False); contract_no: Mapped[str|None]=mapped_column(String(100)); remarks: Mapped[str|None]=mapped_column(Text)
