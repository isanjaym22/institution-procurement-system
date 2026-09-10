"""Official procurement document generator.

Builds a formal, print-ready A4 college administrative record for one
requisition — letterhead, requisition details, items with Indian Rupee
totals, decision record, execution details, and processing history.

Display-only: every label map here is presentational. The workflow itself
is defined solely by TRANSITIONS in app/modules/workflow/service.py and
nothing here gates any logic. Only records that actually exist are shown;
empty sections are omitted, never placeholders.
"""
import io
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import (BaseDocTemplate, Frame, Image, PageTemplate,
                                Paragraph, Spacer, Table, TableStyle)
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT

LOGO_PATH = Path(__file__).resolve().parent.parent.parent / "assets" / "college-logo.png"

COLLEGE_NAME = "GOUR MAHAVIDYALAYA"
COLLEGE_ADDRESS = "Mangalbari, Malda, West Bengal 732142"

NAVY = HexColor("#1f3854")
BODY = HexColor("#1a1a1a")
MUTED = HexColor("#555555")
BORDER = HexColor("#9a9a9a")
FILL = HexColor("#eef1f4")

IST = timezone(timedelta(hours=5, minutes=30), "IST")

STATUS_LABEL = {
    "DRAFT": "Draft (with the creator)",
    "SUBMITTED": "Under consideration of the Head of Department",
    "PRINCIPAL_REVIEW": "Under consideration of the Principal",
    "HOD_REJECTED": "Rejected by the Head of Department (Closed)",
    "PRINCIPAL_REJECTED": "Rejected by the Principal (Closed)",
    "FINANCE_REVIEW": "Under consideration of the Finance Committee",
    "METHOD_PENDING": "With the Purchase Committee (method decision)",
    "WO_PENDING": "With the Purchase Committee (work order)",
    "ACCEPTANCE": "Acceptance pending",
    "BURSAR_REVIEW": "With Accounts (payment recording)",
    "COMPLETED": "Completed",
    "RETURNED_TO_DEPARTMENT": "Returned to the Department",
    "BUDGET_ALLOCATED": "Budget allocated; with the Purchase Committee",
    "DIRECT_PURCHASE": "Direct purchase by the Department",
    "FINANCE_REJECTED": "Rejected by the Finance Committee (Closed)",
    "PROCUREMENT_IN_PROGRESS": "Vendor selection in progress",
    "VENDOR_SELECTED": "Vendor selected; purchase order pending",
    "PO_ISSUED": "Purchase order issued; delivery awaited",
    "DELIVERED": "Delivered; departmental acceptance pending",
    "ACCEPTED": "Accepted; stock entry pending",
    "PARTIALLY_ACCEPTED": "Partially accepted; stock entry pending",
    "DELIVERY_REJECTED": "Delivery rejected (Closed)",
    "STOCK_UPDATED": "Stock register updated; bill pending",
    "BILL_SUBMITTED": "Bill submitted; verification pending",
    "BILL_VERIFIED": "Bill verified; payment pending",
    "PAYMENT_COMPLETED": "Payment completed; utilisation certificate pending",
    "UC_GENERATED": "Utilisation certificate generated",
    "AMC_ACTIVE": "Under Annual Maintenance Contract",
    "CLOSED": "Closed",
}

ACTION_LABEL = {
    "SUBMIT": "Requisition submitted",
    "SUBMIT_DIRECT": "Requisition submitted (HOD step not applicable)",
    "HOD_APPROVE": "Recommended by the Head of Department",
    "HOD_REJECT": "Rejected by the Head of Department",
    "HOD_RETURN": "Returned by the Head of Department for correction",
    "RESUBMIT": "Requisition resubmitted after correction",
    "PRINCIPAL_APPROVE": "Forwarded to the Finance Committee by the Principal",
    "PRINCIPAL_APPROVE_DIRECT": "Approved for direct acceptance by the Principal",
    "PRINCIPAL_REJECT": "Rejected by the Principal",
    "PRINCIPAL_RETURN": "Returned by the Principal for correction",
    "FINANCE_FORWARD": "Forwarded to the Purchase Committee by Finance",
    "FINANCE_APPROVE": "Budget allocated by the Finance Committee",
    "FINANCE_RETURN": "Returned by the Finance Committee for correction",
    "FINANCE_REJECT": "Rejected by the Finance Committee",
    "METHOD_DECIDED": "Procurement method decided",
    "PROCUREMENT_METHOD_DECIDED": "Procurement method decided",
    "WO_UPLOADED": "Work order uploaded",
    "VENDOR_SELECTED": "Vendor selected",
    "PO_ISSUED": "Purchase order issued",
    "DIRECT_PURCHASED": "Direct purchase completed by the Department",
    "DELIVERED": "Goods received",
    "ACCEPTED": "Departmental acceptance completed",
    "ACCEPTANCE_DONE": "Acceptance completed",
    "PARTIALLY_ACCEPTED": "Departmental acceptance completed (partial)",
    "REJECT_DELIVERY": "Delivery rejected at acceptance",
    "STOCK_UPDATED": "Stock register updated",
    "BILL_SUBMITTED": "Bill submitted",
    "BILL_VERIFIED": "Bill verified",
    "PAYMENT_COMPLETED": "Payment completed",
    "PAYMENT_RECORDED": "Payment recorded by Accounts",
    "UC_GENERATE": "Utilisation certificate generated",
    "AMC_START": "Annual Maintenance Contract commenced",
    "CLOSE": "Procurement file closed",
}

ROLE_LABEL = {
    "DEPARTMENT_USER": "Department",
    "HOD": "Head of Department",
    "OFFICE": "Office",
    "PRINCIPAL": "Principal",
    "FINANCE": "Finance Committee",
    "BURSAR": "Accounts / Bursar",
    "ACCOUNTANT": "Accounts",
    "AUDITOR": "Auditor",
    "PURCHASE_COMMITTEE": "Purchase Committee",
    "TENDER_COMMITTEE": "Tender Committee",
    "STORE": "Store",
    "STORE_OFFICER": "Store Officer",
    "ACCEPTANCE_OFFICER": "Acceptance Officer",
    "AMC_OFFICER": "AMC Officer",
    "ADMIN": "Administrator",
}

CATEGORY_LABEL = {"LAB": "Laboratory", "NON_LAB": "Non-Laboratory"}
ORIGIN_LABEL = {"DEPARTMENT": "Department", "HOD": "Head of Department", "OFFICE": "Office"}
HEAD_LABEL = {"RECURRING": "Recurring", "FIXED_ASSET": "Fixed Asset", "OTHER": "Other"}
METHOD_LABEL = {"DIRECT": "Direct", "QUOTATION": "Quotation", "TENDER": "Tender",
                "E_TENDER": "E-Tender", "OTHER": "Other"}
FINANCE_DECISION = {"APPROVE": "Approved", "FORWARD": "Forwarded", "RETURN": "Returned", "REJECT": "Rejected"}
ACCEPT_DECISION = {"ACCEPT": "Accepted", "ACCEPTED": "Accepted",
                   "PARTIAL": "Partially accepted", "PARTIALLY_ACCEPTED": "Partially accepted",
                   "REJECT": "Rejected", "REJECT_DELIVERY": "Rejected"}


def fmt_dt(dt) -> str:
    """Formal office timestamp: '08 September 2026, 18:36 hrs' (IST)."""
    if not dt:
        return ""
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt)
        except ValueError:
            return dt
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST).strftime("%d %B %Y, %H:%M hrs")


def fmt_date(dt) -> str:
    if not dt:
        return ""
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt)
        except ValueError:
            return dt
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(IST).strftime("%d %B %Y")
    return str(dt)


def inr(amount) -> str:
    """Indian Rupee formatting with Indian digit grouping (no Rs. symbol glyph)."""
    d = Decimal(str(amount if amount is not None else 0)).quantize(Decimal("0.01"))
    neg = d < 0
    s = f"{abs(d):.2f}"
    int_part, dec = s.split(".")
    if len(int_part) > 3:
        tail = int_part[-3:]
        head = int_part[:-3]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        int_part = ",".join(groups) + "," + tail
    return f"{'(-) ' if neg else ''}Rs. {int_part}.{dec}"


def esc(text) -> str:
    return escape("" if text is None else str(text)).replace("\n", "<br/>")


class NumberedCanvas(pdf_canvas.Canvas):
    """Canvas that renders 'Page X of Y' footers once the total is known."""

    def __init__(self, *args, proc_id: str = "", **kwargs):
        super().__init__(*args, **kwargs)
        self._proc_id = proc_id
        self._saved_pages = []

    def showPage(self):
        self._saved_pages.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = max(len(self._saved_pages), 1)
        for state in self._saved_pages:
            self.__dict__.update(state)
            self._draw_footer(total)
            super().showPage()
        super().save()

    def _draw_footer(self, total: int):
        self.saveState()
        self.setFont("Helvetica", 7.5)
        self.setFillColor(MUTED)
        self.drawString(18 * mm, 12 * mm, f"{COLLEGE_NAME.title()}  \xb7  {self._proc_id}")
        self.drawRightString(A4[0] - 18 * mm, 12 * mm, f"Page {self._pageNumber} of {total}")
        self.restoreState()


def _styles():
    base = ParagraphStyle("base", fontName="Helvetica", fontSize=9,
                          leading=13, textColor=BODY, alignment=TA_LEFT)
    return {
        "base": base,
        "cell": ParagraphStyle("cell", parent=base, fontSize=8.5, leading=12),
        "cell_small": ParagraphStyle("cell_small", parent=base, fontSize=7.5,
                                     leading=10.5, textColor=MUTED),
        "cell_right": ParagraphStyle("cell_right", parent=base, fontSize=8.5,
                                     leading=12, alignment=TA_RIGHT),
        "head": ParagraphStyle("head", parent=base, fontName="Helvetica-Bold",
                               fontSize=8.5, leading=12, textColor=NAVY),
        "section": ParagraphStyle("section", fontName="Helvetica-Bold", fontSize=11,
                                  leading=14, textColor=NAVY, spaceBefore=14,
                                  spaceAfter=6, keepWithNext=True),
        "justify": ParagraphStyle("justify", parent=base, alignment=TA_JUSTIFY),
        "center": ParagraphStyle("center", parent=base, alignment=TA_CENTER),
        "college": ParagraphStyle("college", fontName="Helvetica-Bold", fontSize=18,
                                  leading=22, textColor=BODY, alignment=TA_CENTER),
        "address": ParagraphStyle("address", parent=base, fontSize=9.5, leading=13,
                                  textColor=HexColor("#444444"), alignment=TA_CENTER),
    }


def _table(rows, widths, header=True, align_right=()) -> Table:
    style = [
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), FILL),
                  ("TEXTCOLOR", (0, 0), (-1, 0), NAVY)]
    for col in align_right:
        style.append(("ALIGN", (col, 0), (col, -1), "RIGHT"))
    return Table(rows, colWidths=widths, repeatRows=1 if header else 0,
                 style=TableStyle(style))


def build_procurement_pdf(req, data: dict, events: list, users: dict) -> bytes:
    """Assemble the official document. `data` holds stage records (may be None);
    `events` the chronological workflow events; `users` maps id -> (name, role)."""
    S = _styles()
    W = A4[0] - 36 * mm  # usable width with 18mm side margins
    story = []

    def P(text, style="cell"):
        return Paragraph(text, S[style])

    def section(title):
        story.append(P(escape(title), "section"))

    # ---- Letterhead ----
    if LOGO_PATH.exists():
        story.append(Image(str(LOGO_PATH), width=30 * mm, height=36 * mm))
        story.append(Spacer(1, 2 * mm))
    story.append(Paragraph(escape(COLLEGE_NAME), S["college"]))
    story.append(Paragraph(escape(COLLEGE_ADDRESS), S["address"]))
    story.append(Spacer(1, 3 * mm))
    story.append(Table([[""]], colWidths=[W],
                       style=TableStyle([("LINEBELOW", (0, 0), (-1, 0), 1.2, NAVY)])))
    story.append(Spacer(1, 4 * mm))

    # ---- Document title + identification ----
    story.append(Paragraph('<font size="13"><b>PROCUREMENT REQUISITION</b></font>', S["center"]))
    story.append(Spacer(1, 3 * mm))
    parts = (req.procurement_id or "").split("/")
    fin_year = parts[1] if len(parts) > 2 else ""
    dept_line = " / ".join(x for x in
                           [req.department_name_snapshot, req.department_code_snapshot] if x)
    id_rows = [
        [P("<b>Procurement ID</b>", "head"), P(esc(req.procurement_id)),
         P("<b>Date of Issue</b>", "head"), P(esc(fmt_date(datetime.now(timezone.utc))))],
        [P("<b>Department</b>", "head"), P(esc(dept_line or req.department_id)),
         P("<b>Financial Year</b>", "head"), P(esc(fin_year))],
    ]
    story.append(_table(id_rows, [W * 0.20, W * 0.30, W * 0.20, W * 0.30], header=False))

    # ---- Requisition details ----
    section("Requisition Details")
    detail_pairs = [
        ("Requested by", req.faculty_name_snapshot),
        ("Employee ID", req.faculty_employee_id_snapshot),
        ("Designation", req.faculty_designation_snapshot),
        ("Raised by", ORIGIN_LABEL.get(getattr(req, "origin", None) or "", getattr(req, "origin", None) or "")),
        ("Procurement Category", CATEGORY_LABEL.get(req.category, req.category)),
        ("AMC Required (at requisition)", "Yes" if getattr(req, "amc_preference", False) else "No"),
        ("Current Status", STATUS_LABEL.get(req.status, req.status)),
        ("Date of Requisition", fmt_date(req.created_at)),
    ]
    detail_rows = [[P(f"<b>{escape(k)}</b>", "head"), P(esc(v) or "&mdash;")]
                   for k, v in detail_pairs if v]
    story.append(_table(detail_rows, [W * 0.30, W * 0.70], header=False))

    # ---- Purpose / justification ----
    section("Purpose / Justification")
    story.append(P(esc(req.justification) or "&mdash;", "justify"))

    # ---- Items ----
    section("Items and Financial Details")
    item_rows = [[P("<b>Sl. No.</b>", "head"), P("<b>Description</b>", "head"),
                  P("<b>Qty.</b>", "head"), P("<b>Unit Price</b>", "head"),
                  P("<b>Amount</b>", "head")]]
    estimated = Decimal("0")
    for item in req.items or []:
        line_total = Decimal(item.quantity) * item.tentative_unit_price
        estimated += line_total
        desc = esc(item.item_name)
        if item.specification:
            desc += f'<br/><font size="7.5" color="#555555">{esc(item.specification)}</font>'
        item_rows.append([P(str(item.line_no), "cell_right"), P(desc),
                          P(str(item.quantity), "cell_right"),
                          P(inr(item.tentative_unit_price), "cell_right"),
                          P(inr(line_total), "cell_right")])
    story.append(_table(item_rows, [W * 0.08, W * 0.44, W * 0.08, W * 0.20, W * 0.20],
                        align_right=(0, 2, 3, 4)))
    story.append(Spacer(1, 2 * mm))
    totals = [[P("<b>Estimated Total</b>", "head"), P(f"<b>{inr(estimated)}</b>", "cell_right")]]
    fr = data.get("finance_review")
    if fr and fr.approved_amount is not None:
        totals.append([P("<b>Indicative Amount (Finance)</b>", "head"),
                       P(f"<b>{inr(fr.approved_amount)}</b>", "cell_right")])
    if fr and fr.amount_remark:
        totals.append([P("<b>Amount Remark (Finance)</b>", "head"),
                       P(esc(fr.amount_remark), "cell")])
    po = data.get("purchase_order")
    if po:
        totals.append([P("<b>Purchase Order Amount</b>", "head"),
                       P(f"<b>{inr(po.total_amount)}</b>", "cell_right")])
    story.append(_table(totals, [W * 0.60, W * 0.40], header=False))

    # ---- Decision record ----
    hod_action = next((e.action for e in events if e.action.startswith("HOD_")), None)
    princ_action = next((e.action for e in events if e.action.startswith("PRINCIPAL_")), None)
    hod_name = users.get(getattr(req, "hod_decision_by", None), ("", ""))[0]
    princ_name = users.get(getattr(req, "principal_decision_by", None), ("", ""))[0]
    HOD_WORD = {"HOD_APPROVE": "Recommended", "HOD_RETURN": "Returned for correction",
                "HOD_REJECT": "Not recommended"}
    PRINC_WORD = {"PRINCIPAL_APPROVE": "Forwarded to the Finance Committee",
                  "PRINCIPAL_APPROVE_DIRECT": "Approved for direct acceptance",
                  "PRINCIPAL_RETURN": "Returned to the Department",
                  "PRINCIPAL_REJECT": "Not recommended"}
    dec_rows = [[P("<b>Authority</b>", "head"), P("<b>Decision</b>", "head"),
                 P("<b>Date &amp; Time</b>", "head"), P("<b>Remarks</b>", "head")]]
    if hod_action and req.hod_remarks is not None:
        dec_rows.append([P(f"Head of Department{f'<br/><font size=7.5 color=\"#555555\">' + esc(hod_name) + '</font>' if hod_name else ''}"),
                         P(esc(HOD_WORD.get(hod_action, hod_action))),
                         P(esc(fmt_dt(req.hod_decision_at))), P(esc(req.hod_remarks))])
    if princ_action and req.principal_remarks is not None:
        dec_rows.append([P(f"Principal{f'<br/><font size=7.5 color=\"#555555\">' + esc(princ_name) + '</font>' if princ_name else ''}"),
                         P(esc(PRINC_WORD.get(princ_action, princ_action))),
                         P(esc(fmt_dt(req.principal_decision_at))), P(esc(req.principal_remarks))])
    if fr:
        fin_actor = users.get(fr.actor_id, ("", ""))[0]
        fin_dec = FINANCE_DECISION.get(fr.decision, fr.decision)
        if fr.decision == "APPROVE":
            fin_dec = (f"Budget allocated under Head \u201c{fr.budget_head}\u201d, "
                       f"Sub-head \u201c{fr.sub_head}\u201d for {inr(fr.approved_amount)}"
                       if fr.approved_amount is not None else "Budget allocated")
        elif fr.decision == "FORWARD":
            head_txt = HEAD_LABEL.get(fr.budget_head or "", fr.budget_head or "")
            if (fr.budget_head or "") == "OTHER" and fr.head_other_text:
                head_txt = f"Other \u2014 {fr.head_other_text}"
            bits = [f"Head \u201c{head_txt}\u201d", f"Sub-head \u201c{fr.sub_head}\u201d"]
            if fr.approved_amount is not None:
                bits.append(f"indicative {inr(fr.approved_amount)}")
            if fr.amount_remark:
                bits.append(fr.amount_remark)
            bits.append("AMC recommended" if fr.amc_recommendation else "AMC not recommended")
            fin_dec = "Forwarded to the Purchase Committee (" + "; ".join(bits) + ")"
        dec_rows.append([P(f"Finance Committee{f'<br/><font size=7.5 color=\"#555555\">' + esc(fin_actor) + '</font>' if fin_actor else ''}"),
                         P(esc(fin_dec)), P(esc(fmt_dt(fr.decided_at))), P(esc(fr.remarks))])
    if len(dec_rows) > 1:
        section("Approval / Decision Record")
        story.append(_table(dec_rows, [W * 0.22, W * 0.28, W * 0.22, W * 0.28]))

    # ---- Procurement / execution ----
    pd = data.get("procurement_decision")
    wo = data.get("work_order")
    if pd or po or wo:
        section("Purchase Committee and Work Order")
        if pd:
            method = METHOD_LABEL.get(pd.method, pd.method)
            if pd.method == "OTHER" and getattr(pd, "method_other_text", None):
                method = f"Other \u2014 {pd.method_other_text}"
            vendor_name = data.get("selected_vendor_name") or ""
            po_vendor = data.get("po_vendor")
            if po_vendor and not vendor_name:
                vendor_name = po_vendor.name
            exec_pairs = [("Procurement Method", method)]
            if pd.meeting_no:
                exec_pairs.append(("Meeting No.", pd.meeting_no))
            if pd.rule_reference:
                exec_pairs.append(("Rule Reference", pd.rule_reference))
            if vendor_name:
                exec_pairs.append(("Selected Supplier", vendor_name))
            gstin = (data.get("selected_vendor_gstin") or
                     (po_vendor.gstin if po_vendor else None))
            if gstin:
                exec_pairs.append(("Supplier GSTIN", gstin))
            contact = (data.get("selected_vendor_contact") or
                       (po_vendor.contact if po_vendor else None))
            if contact:
                exec_pairs.append(("Supplier Contact", contact))
            story.append(_table([[P(f"<b>{escape(k)}</b>", "head"), P(esc(v))]
                                 for k, v in exec_pairs],
                                [W * 0.30, W * 0.70], header=False))
            story.append(Spacer(1, 2 * mm))
        if po:
            po_vendor = data.get("po_vendor")
            po_pairs = [("Purchase Order No.", po.po_number),
                        ("Purchase Order Date", fmt_date(po.po_date)),
                        ("Supplier", po_vendor.name if po_vendor else ""),
                        ("Order Amount", inr(po.total_amount))]
            if po.warranty_months is not None:
                po_pairs.append(("Warranty", f"{po.warranty_months} months"))
            if po.amc_required:
                po_pairs.append(("AMC", "Required"))
            if po.delivery_terms:
                po_pairs.append(("Delivery Terms", po.delivery_terms))
            story.append(_table([[P(f"<b>{escape(k)}</b>", "head"), P(esc(v))]
                             for k, v in po_pairs if v],
                            [W * 0.30, W * 0.70], header=False))
        if wo:
            story.append(Spacer(1, 2 * mm))
            story.append(_table([[P("<b>Work Order</b>", "head"),
                                  P(f"Uploaded on {esc(fmt_date(wo.uploaded_at))} "
                                    f"(copy retained in the system)")]],
                                [W * 0.30, W * 0.70], header=False))

    dl = data.get("delivery")
    ac = data.get("acceptance")
    if dl or ac:
        section("Delivery and Acceptance")
        rows = []
        if dl:
            bits = []
            if dl.invoice_number:
                bits.append(f"Invoice No. {dl.invoice_number}")
            if dl.challan_number:
                bits.append(f"Challan No. {dl.challan_number}")
            rows.append([P("<b>Delivery</b>", "head"),
                         P(f"{esc(fmt_date(dl.delivery_date))}"
                           f"{' — ' + esc('; '.join(bits)) if bits else ''}"
                           f"{'<br/>' + esc(dl.remarks) if dl.remarks else ''}")])
        if ac:
            ac_actor = users.get(ac.actor_id, ("", ""))[0]
            ac_bits = [f"{esc(ACCEPT_DECISION.get(ac.decision, ac.decision))}"
                       f" — {esc(fmt_date(ac.accepted_at))}"]
            if ac_actor:
                ac_bits.append(f"Accepted by {esc(ac_actor)}")
            stock_fields = [
                ("Brand", getattr(ac, "brand_name", None)),
                ("Specification", getattr(ac, "specification", None)),
                ("Manufacturing Date", fmt_date(getattr(ac, "manufacturing_date", None)) or None),
                ("Expiry Date", fmt_date(getattr(ac, "expiry_date", None)) or None),
                ("Quantity Received", getattr(ac, "quantity_received", None)),
                ("Asset / Item ID", getattr(ac, "item_asset_id", None)),
                ("Date of Acceptance", fmt_date(getattr(ac, "acceptance_date", None)) or None),
                ("Accepted By (name)", getattr(ac, "accepted_by", None)),
            ]
            for k, v in stock_fields:
                if v not in (None, ""):
                    ac_bits.append(f"{k}: {esc(v)}")
            if ac.remarks:
                ac_bits.append(esc(ac.remarks))
            rows.append([P("<b>Acceptance</b>", "head"), P("<br/>".join(ac_bits))])
        story.append(_table(rows, [W * 0.30, W * 0.70], header=False))

    st = data.get("stock_entry")
    if st:
        section("Stock / Store Record")
        st_pairs = [("Register Type",
                     {"STOCK": "Stock Register", "ASSET": "Asset Register"}.get(st.register_type, st.register_type)),
                    ("Entry Date", fmt_date(st.entry_date))]
        if st.asset_id:
            st_pairs.append(("Asset ID", st.asset_id))
        if st.serial_no:
            st_pairs.append(("Serial No.", st.serial_no))
        if st.remarks:
            st_pairs.append(("Remarks", st.remarks))
        story.append(_table([[P(f"<b>{escape(k)}</b>", "head"), P(esc(v))]
                             for k, v in st_pairs],
                            [W * 0.30, W * 0.70], header=False))

    bill = data.get("bill")
    pay = data.get("payment")
    uc = data.get("uc")
    amc = data.get("amc")
    if bill or pay or uc:
        section("Accounts, Payment and Utilisation")
        rows = []
        if bill:
            rows.append([P("<b>Bill</b>", "head"),
                         P(f"Invoice No. {esc(bill.invoice_number)} for {inr(bill.amount)}"
                           f" — {'Verified' if bill.verified else 'Submitted, verification pending'}"
                           f"{'<br/>' + esc(bill.remarks) if bill.remarks else ''}")])
        if pay:
            pay_bits = []
            if pay.payment_reference:
                pay_bits.append(f"Ref. {esc(pay.payment_reference)}")
            if getattr(pay, "cheque_number", None):
                pay_bits.append(f"Cheque No. {esc(pay.cheque_number)}")
            if getattr(pay, "transaction_number", None):
                pay_bits.append(f"Transaction No. {esc(pay.transaction_number)}")
            if pay.amount is not None:
                pay_bits.insert(0, inr(pay.amount))
            if pay.payment_date:
                pay_bits.append(f"on {esc(fmt_date(pay.payment_date))}")
            if getattr(pay, "document_path", None):
                pay_bits.append("(supporting document retained in the system)")
            pay_line = " ".join(pay_bits) if pay_bits else "Recorded"
            rows.append([P("<b>Payment</b>", "head"), P(pay_line)])
        if uc:
            rows.append([P("<b>Utilisation Certificate</b>", "head"),
                         P(f"No. {esc(uc.certificate_no)} issued on {esc(fmt_date(uc.issued_at))}"
                           f"{'<br/>' + esc(uc.remarks) if uc.remarks else ''}")])
        story.append(_table(rows, [W * 0.30, W * 0.70], header=False))

    # ---- AMC chain: requisition preference -> finance recommendation -> bursar final ----
    amc_pref = getattr(req, "amc_preference", None)
    amc_rec = fr.amc_recommendation if fr else None
    amc_final = getattr(pay, "amc_final", None) if pay else None
    if amc_pref or amc_rec or amc_final is not None or amc:
        section("Annual Maintenance Contract")
        chain = [("At Requisition", "Yes" if amc_pref else "No")]
        if amc_rec is not None:
            chain.append(("Finance Recommendation", "Yes" if amc_rec else "No"))
        if amc_final is not None:
            chain.append(("Final (Accounts)", "Yes" if amc_final else "No"))
        story.append(_table([[P(f"<b>{escape(k)}</b>", "head"), P(esc(v))]
                             for k, v in chain],
                            [W * 0.30, W * 0.70], header=False))
        story.append(Spacer(1, 2 * mm))
    if amc:
        if not (amc_pref or amc_rec or amc_final is not None):
            section("Annual Maintenance Contract")
        amc_pairs = [("Contract Period",
                      f"{fmt_date(amc.start_date)} to {fmt_date(amc.end_date)}")]
        if amc.contract_no:
            amc_pairs.append(("Contract No.", amc.contract_no))
        amc_vendor = data.get("amc_vendor")
        if amc_vendor:
            amc_pairs.append(("Vendor", amc_vendor.name))
        if amc.remarks:
            amc_pairs.append(("Remarks", amc.remarks))
        story.append(_table([[P(f"<b>{escape(k)}</b>", "head"), P(esc(v))]
                             for k, v in amc_pairs],
                            [W * 0.30, W * 0.70], header=False))

    # ---- Processing history ----
    if events:
        section("Processing History")
        hist_rows = [[P("<b>Date &amp; Time</b>", "head"), P("<b>Action</b>", "head"),
                      P("<b>Authority</b>", "head"), P("<b>Remarks</b>", "head")]]
        for e in events:
            name, role = users.get(e.actor_id, ("", ""))
            authority = ROLE_LABEL.get(role, role)
            if name:
                authority += f'<br/><font size="7.5" color="#555555">{esc(name)}</font>'
            hist_rows.append([P(esc(fmt_dt(e.created_at))), P(esc(ACTION_LABEL.get(e.action, e.action))),
                              P(authority), P(esc(e.remarks) or "&mdash;")])
        story.append(_table(hist_rows, [W * 0.20, W * 0.30, W * 0.20, W * 0.30]))

    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph(
        '<font size="8" color="#555555">This is a system-generated record of the institutional '
        'procurement workflow. Decisions shown above were recorded digitally by the '
        "concerned authorities.</font>", S["center"]))

    doc = BaseDocTemplate(io.BytesIO(), pagesize=A4,
                          leftMargin=18 * mm, rightMargin=18 * mm,
                          topMargin=15 * mm, bottomMargin=18 * mm,
                          showBoundary=0)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
    doc.addPageTemplates([PageTemplate(id="page", frames=[frame])])

    buf = doc.filename  # the BytesIO passed above
    maker = NumberedCanvas
    proc_id = req.procurement_id or ""
    doc.build(story, canvasmaker=lambda *a, **k: maker(*a, proc_id=proc_id, **k))
    return buf.getvalue()


def build_report_pdf(rows: list[dict], from_date: str, to_date: str, institution: str) -> bytes:
    """Date-wise purchase report over completed/accepted records.

    One landscape row per requisition: Procurement ID, Date (requisition
    creation date), Department, Requester, Category, Budget Head, Method, AMC,
    Total, Status. Terminal rejects never reach this function (router filters).
    """
    S = _styles()
    story = []

    def P(text, style="cell"):
        return Paragraph(text, S[style])

    story.append(Paragraph(escape(COLLEGE_NAME), S["college"]))
    story.append(Paragraph(escape(COLLEGE_ADDRESS), S["address"]))
    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph(f'<font size="13"><b>PURCHASE REPORT</b></font>', S["center"]))
    story.append(Paragraph(
        f'<font size="9" color="#555555">{escape(institution)} &nbsp;|&nbsp; '
        f'{escape(from_date)} to {escape(to_date)} &nbsp;|&nbsp; {len(rows)} record(s)</font>',
        S["center"]))
    story.append(Spacer(1, 4 * mm))

    W = A4[0] - 36 * mm
    widths = [W * 0.16, W * 0.10, W * 0.12, W * 0.13, W * 0.09,
              W * 0.10, W * 0.08, W * 0.05, W * 0.10, W * 0.07]
    table_rows = [[P("<b>Procurement ID</b>", "head"), P("<b>Date</b>", "head"),
                   P("<b>Department</b>", "head"), P("<b>Requester</b>", "head"),
                   P("<b>Category</b>", "head"), P("<b>Head</b>", "head"),
                   P("<b>Method</b>", "head"), P("<b>AMC</b>", "head"),
                   P("<b>Total</b>", "head"), P("<b>Status</b>", "head")]]
    for r in rows:
        amc = r.get("amc")
        table_rows.append([
            P(esc(r.get("procurement_id"))),
            P(esc(r.get("date"))),
            P(esc(r.get("department") or r.get("department_code"))),
            P(esc(r.get("faculty"))),
            P(esc(CATEGORY_LABEL.get(r.get("category") or "", r.get("category") or ""))),
            P(esc(HEAD_LABEL.get(r.get("head") or "", r.get("head") or "") or "&mdash;")),
            P(esc(METHOD_LABEL.get(r.get("method") or "", r.get("method") or "") or "&mdash;")),
            P("Yes" if amc else ("No" if amc is False else "&mdash;")),
            P(esc(inr(r.get("total") or 0)), "cell_right"),
            P(esc(STATUS_LABEL.get(r.get("status") or "", r.get("status") or ""))),
        ])
    if not rows:
        table_rows.append([P("No completed or accepted procurements in this period.", "cell")] + [P("")] * 9)
    story.append(_table(table_rows, widths, align_right=(8,)))

    doc = BaseDocTemplate(io.BytesIO(), pagesize=A4,
                          leftMargin=18 * mm, rightMargin=18 * mm,
                          topMargin=15 * mm, bottomMargin=18 * mm,
                          showBoundary=0)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
    doc.addPageTemplates([PageTemplate(id="page", frames=[frame])])
    buf = doc.filename
    doc.build(story, canvasmaker=lambda *a, **k: NumberedCanvas(*a, proc_id="Purchase Report", **k))
    return buf.getvalue()
