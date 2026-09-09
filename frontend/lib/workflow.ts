import type { Req, User } from "./api";

/** Human-readable stage name per workflow status. */
export const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "HOD Review",
  PRINCIPAL_REVIEW: "Principal Review",
  RETURNED_TO_DEPARTMENT: "Returned to Department",
  HOD_REJECTED: "Rejected by HOD",
  PRINCIPAL_REJECTED: "Rejected by Principal",
  FINANCE_REVIEW: "Finance Committee — Head & Sub-head",
  FINANCE_REJECTED: "Rejected by Finance",
  BUDGET_ALLOCATED: "Purchase / Tender Committee",
  PROCUREMENT_IN_PROGRESS: "Procurement in Progress",
  VENDOR_SELECTED: "Vendor Selected — PO Pending",
  DIRECT_PURCHASE: "Direct Purchase by Department",
  PO_ISSUED: "Awaiting Delivery",
  DELIVERED: "Department Acceptance",
  DELIVERY_REJECTED: "Delivery Rejected",
  ACCEPTED: "Stock / Asset Entry",
  PARTIALLY_ACCEPTED: "Stock / Asset Entry",
  STOCK_UPDATED: "Bill Submission",
  BILL_SUBMITTED: "Bill Verification",
  BILL_VERIFIED: "Payment",
  PAYMENT_COMPLETED: "Utilization Certificate",
  UC_GENERATED: "AMC or Closure",
  AMC_ACTIVE: "AMC / Closure",
  CLOSED: "Closed",
};

/** Broader phase each status belongs to — used to group queue cards. */
export const STAGE_GROUP: Record<string, string> = {
  DRAFT: "Approvals",
  SUBMITTED: "Approvals",
  PRINCIPAL_REVIEW: "Approvals",
  RETURNED_TO_DEPARTMENT: "Approvals",
  HOD_REJECTED: "Approvals",
  PRINCIPAL_REJECTED: "Approvals",
  FINANCE_REVIEW: "Finance Committee",
  FINANCE_REJECTED: "Finance Committee",
  BUDGET_ALLOCATED: "Purchase / Tender Committee",
  PROCUREMENT_IN_PROGRESS: "Purchase / Tender Committee",
  VENDOR_SELECTED: "Purchase / Tender Committee",
  DIRECT_PURCHASE: "Direct Purchase by Department",
  PO_ISSUED: "Delivery & Departmental Acceptance",
  DELIVERED: "Delivery & Departmental Acceptance",
  DELIVERY_REJECTED: "Delivery & Departmental Acceptance",
  ACCEPTED: "Stock, Billing & Payment",
  PARTIALLY_ACCEPTED: "Stock, Billing & Payment",
  STOCK_UPDATED: "Stock, Billing & Payment",
  BILL_SUBMITTED: "Stock, Billing & Payment",
  BILL_VERIFIED: "Stock, Billing & Payment",
  PAYMENT_COMPLETED: "Stock, Billing & Payment",
  UC_GENERATED: "UC, AMC & Closure",
  AMC_ACTIVE: "UC, AMC & Closure",
  CLOSED: "UC, AMC & Closure",
};

export type StatusTone = "neutral" | "info" | "pending" | "success" | "danger";

/** Badge tone per status: blue = in progress, amber = waiting on someone,
 *  green = done/verified, red = rejected/returned, slate = draft/closed. */
export const STATUS_TONE: Record<string, StatusTone> = {
  DRAFT: "neutral",
  SUBMITTED: "pending",
  PRINCIPAL_REVIEW: "pending",
  RETURNED_TO_DEPARTMENT: "danger",
  HOD_REJECTED: "danger",
  PRINCIPAL_REJECTED: "danger",
  FINANCE_REVIEW: "pending",
  FINANCE_REJECTED: "danger",
  BUDGET_ALLOCATED: "info",
  PROCUREMENT_IN_PROGRESS: "info",
  VENDOR_SELECTED: "info",
  DIRECT_PURCHASE: "pending",
  PO_ISSUED: "info",
  DELIVERED: "pending",
  DELIVERY_REJECTED: "danger",
  ACCEPTED: "success",
  PARTIALLY_ACCEPTED: "pending",
  STOCK_UPDATED: "info",
  BILL_SUBMITTED: "pending",
  BILL_VERIFIED: "success",
  PAYMENT_COMPLETED: "success",
  UC_GENERATED: "info",
  AMC_ACTIVE: "info",
  CLOSED: "neutral",
};

export const ROLE_LABELS: Record<string, string> = {
  DEPARTMENT_USER: "Department Staff",
  HOD: "Head of Department",
  PRINCIPAL: "Principal",
  FINANCE: "Finance Committee",
  PURCHASE_COMMITTEE: "Purchase Committee",
  TENDER_COMMITTEE: "Tender Committee",
  STORE_OFFICER: "Store Officer",
  ACCEPTANCE_OFFICER: "Acceptance Officer",
  BURSAR: "Bursar / Accounts",
  ACCOUNTANT: "Accountant",
  AUDITOR: "Auditor",
  AMC_OFFICER: "AMC Officer",
  ADMIN: "Administrator",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * Whether the signed-in user has an action button on this requisition.
 * Mirrors the backend role + status guards so the "needs your action"
 * count stays truthful.
 */
export function canAct(user: User, r: Req): boolean {
  const role = user.role;
  const s = r.status;
  if (role === "DEPARTMENT_USER" && s === "DRAFT") return true;
  if (role === "HOD" && (s === "SUBMITTED" || s === "DIRECT_PURCHASE" || s === "DELIVERED"))
    return true;
  if (role === "PRINCIPAL" && (s === "PRINCIPAL_REVIEW" || s === "UC_GENERATED"))
    return true;
  if (role === "FINANCE" && s === "FINANCE_REVIEW") return true;
  if (
    role === "PURCHASE_COMMITTEE" &&
    (s === "BUDGET_ALLOCATED" ||
      s === "PROCUREMENT_IN_PROGRESS" ||
      s === "VENDOR_SELECTED")
  )
    return true;
  if (role === "DEPARTMENT_USER" && (s === "DIRECT_PURCHASE" || s === "DELIVERED"))
    return true;
  if (role === "STORE_OFFICER" && (s === "PO_ISSUED" || s === "ACCEPTED" || s === "PARTIALLY_ACCEPTED"))
    return true;
  if (
    role === "BURSAR" &&
    (s === "STOCK_UPDATED" ||
      s === "BILL_SUBMITTED" ||
      s === "BILL_VERIFIED" ||
      s === "PAYMENT_COMPLETED" ||
      s === "UC_GENERATED")
  )
    return true;
  return false;
}
