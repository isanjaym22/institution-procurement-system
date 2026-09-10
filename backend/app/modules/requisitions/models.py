import uuid
from decimal import Decimal
from sqlalchemy import String, Text, Numeric, Integer, ForeignKey, DateTime, func, Index, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.db import Base

class ProcurementSequence(Base):
    __tablename__ = "procurement_sequences"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    institution_id: Mapped[str] = mapped_column(ForeignKey("institutions.id"), nullable=False)
    financial_year: Mapped[str] = mapped_column(String(20), nullable=False)
    department_code: Mapped[str] = mapped_column(String(30), nullable=False)
    last_number: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    __table_args__ = (Index("uq_procurement_sequence", "institution_id", "financial_year", "department_code", unique=True),)

class Requisition(Base):
    __tablename__ = "requisitions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    procurement_id: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    institution_id: Mapped[str] = mapped_column(ForeignKey("institutions.id"), nullable=False, index=True)
    department_id: Mapped[str] = mapped_column(ForeignKey("departments.id"), nullable=False, index=True)
    faculty_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    # Historical snapshots: these remain unchanged if a faculty member/department is later renamed or moved.
    institution_name_snapshot: Mapped[str | None] = mapped_column(String(200))
    department_name_snapshot: Mapped[str | None] = mapped_column(String(150))
    department_code_snapshot: Mapped[str | None] = mapped_column(String(30))
    faculty_name_snapshot: Mapped[str | None] = mapped_column(String(150))
    faculty_employee_id_snapshot: Mapped[str | None] = mapped_column(String(50))
    faculty_designation_snapshot: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(50), default="DRAFT", nullable=False, index=True)
    justification: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    # New workflow (Sep 2026): origin tracks who created the requisition —
    # DEPARTMENT (staff), HOD, or OFFICE — and drives HOD-skip + acceptance routing.
    # creator_role snapshots the exact role string at creation time.
    origin: Mapped[str | None] = mapped_column(String(20))
    creator_role: Mapped[str | None] = mapped_column(String(50))
    # Step-1 AMC preference (Yes/No), kept through to Bursar's final AMC decision.
    amc_preference: Mapped[bool | None] = mapped_column(Boolean)
    hod_remarks: Mapped[str | None] = mapped_column(Text)
    hod_decision_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    hod_decision_at: Mapped[object | None] = mapped_column(DateTime(timezone=True))
    principal_remarks: Mapped[str | None] = mapped_column(Text)
    principal_decision_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    principal_decision_at: Mapped[object | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    items: Mapped[list["RequisitionItem"]] = relationship(
        back_populates="requisition", cascade="all, delete-orphan", order_by="RequisitionItem.line_no"
    )

class RequisitionItem(Base):
    __tablename__ = "requisition_items"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    requisition_id: Mapped[str] = mapped_column(ForeignKey("requisitions.id", ondelete="CASCADE"), nullable=False)
    line_no: Mapped[int] = mapped_column(Integer, nullable=False)
    item_name: Mapped[str] = mapped_column(String(200), nullable=False)
    specification: Mapped[str] = mapped_column(Text, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    tentative_unit_price: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)

    requisition: Mapped["Requisition"] = relationship(back_populates="items")

    @property
    def line_total(self):
        return self.quantity * self.tentative_unit_price
