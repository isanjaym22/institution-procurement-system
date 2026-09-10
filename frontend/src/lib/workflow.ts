// NEW procurement workflow: status labels, role labels, actionability.
// Backend enum names stay internal; UI only shows these labels.

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Awaiting HOD review",
  PRINCIPAL_REVIEW: "Awaiting Principal review",
  HOD_REJECTED: "Rejected by HOD — closed",
  PRINCIPAL_REJECTED: "Rejected by Principal — closed",
  FINANCE_REVIEW: "Finance Committee review",
  METHOD_PENDING: "Purchase method pending",
  WO_PENDING: "Work Order upload pending",
  ACCEPTANCE: "Acceptance & stock",
  BURSAR_REVIEW: "Bursar / Accounts review",
  COMPLETED: "Completed",
  // Grandfathered statuses from the previous workflow.
  RETURNED_TO_DEPARTMENT: "Returned to department (legacy)",
  DIRECT_PURCHASE: "Direct purchase (legacy)",
  BUDGET_ALLOCATED: "Budget allocated (legacy)",
  PROCUREMENT_IN_PROGRESS: "Procurement in progress (legacy)",
  VENDOR_SELECTED: "Vendor selected (legacy)",
  PO_ISSUED: "Purchase Order issued (legacy)",
  DELIVERED: "Delivered (legacy)",
  ACCEPTED: "Accepted (legacy)",
  PARTIALLY_ACCEPTED: "Partially accepted (legacy)",
  STOCK_UPDATED: "Stock updated (legacy)",
  BILL_SUBMITTED: "Bill submitted (legacy)",
  BILL_VERIFIED: "Bill verified (legacy)",
  PAYMENT_COMPLETED: "Payment completed (legacy)",
  UC_GENERATED: "Utilization Certificate (legacy)",
  AMC_ACTIVE: "AMC active (legacy)",
  CLOSED: "Closed (legacy)",
  FINANCE_REJECTED: "Rejected by Finance (legacy)",
  DELIVERY_REJECTED: "Delivery rejected (legacy)",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export const ROLE_LABELS: Record<string, string> = {
  DEPARTMENT_USER: "Department User",
  HOD: "Head of Department",
  OFFICE: "Office Staff",
  PRINCIPAL: "Principal",
  FINANCE: "Finance Committee",
  PURCHASE_COMMITTEE: "Purchase & Tender Committee",
  STORE_OFFICER: "Store Officer",
  ACCEPTANCE_OFFICER: "Acceptance Officer",
  BURSAR: "Bursar / Accounts",
  AMC_OFFICER: "AMC Officer",
  ADMIN: "Administrator",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

interface Actor {
  role: string;
}

interface QueueReq {
  status: string;
  origin?: string | null;
  creator_role?: string | null;
}

// Origin determines acceptance authority: department-origin (Department/HOD
// created) vs office-origin (Office created).
export function reqOrigin(req: QueueReq): "OFFICE" | "DEPARTMENT" {
  if (req.origin === "OFFICE" || req.creator_role === "OFFICE") return "OFFICE";
  return "DEPARTMENT";
}

const CREATOR_ROLES = new Set(["DEPARTMENT_USER", "HOD", "OFFICE"]);

// Whether this requisition needs an action from this user in their queue.
// Mirrors backend require_roles guards; ADMIN inherits FINANCE / PURCHASE /
// ACCEPTANCE / BURSAR steps. DRAFT submission is open to creator roles.
export function canAct(user: Actor, req: QueueReq): boolean {
  const admin = user.role === "ADMIN";
  switch (req.status) {
    case "DRAFT":
      return (
        user.role === "DEPARTMENT_USER" ||
        user.role === "HOD" ||
        user.role === "OFFICE"
      );
    case "SUBMITTED":
      return user.role === "HOD";
    case "PRINCIPAL_REVIEW":
      return user.role === "PRINCIPAL";
    case "FINANCE_REVIEW":
      return user.role === "FINANCE" || admin;
    case "METHOD_PENDING":
    case "WO_PENDING":
      return user.role === "PURCHASE_COMMITTEE" || admin;
    case "ACCEPTANCE":
      if (admin) return true;
      if (reqOrigin(req) === "OFFICE") return user.role === "OFFICE";
      return user.role === "DEPARTMENT_USER" || user.role === "HOD";
    case "BURSAR_REVIEW":
      return user.role === "BURSAR" || admin;
    default:
      return false;
  }
}

export function canCreate(user: Actor): boolean {
  return CREATOR_ROLES.has(user.role);
}

export function canSeeAdminPanel(user: Actor): boolean {
  return user.role === "ADMIN";
}

export type StatusTone = "neutral" | "info" | "success" | "danger" | "warning";

export function statusTone(status: string): StatusTone {
  if (status === "COMPLETED") return "success";
  if (status === "HOD_REJECTED" || status === "PRINCIPAL_REJECTED")
    return "danger";
  if (
    status === "SUBMITTED" ||
    status === "PRINCIPAL_REVIEW" ||
    status === "FINANCE_REVIEW" ||
    status === "METHOD_PENDING" ||
    status === "WO_PENDING" ||
    status === "ACCEPTANCE" ||
    status === "BURSAR_REVIEW"
  )
    return "info";
  if (status === "DRAFT") return "warning";
  return "neutral";
}

// ---- Amount gate: principal approval routes total < ₹10,000 straight to
// acceptance, skipping Finance Committee. informational hint only. ----
export const DIRECT_PURCHASE_LIMIT = 10000;

export interface PricedItem {
  quantity: number | string;
  tentative_unit_price: number | string;
}

export function estimateTotal(req: { items: PricedItem[] }): number {
  return req.items.reduce(
    (sum, it) => sum + Number(it.quantity) * Number(it.tentative_unit_price || 0),
    0,
  );
}

export function formatINR(n: number | string): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(v);
}

export function amountGateHint(total: number): string {
  if (total < DIRECT_PURCHASE_LIMIT)
    return `Estimated total ${formatINR(total)} is below ₹10,000 — approval routes straight to Acceptance, skipping Finance review.`;
  return `Estimated total ${formatINR(total)} is ₹10,000 or more — approval routes to Finance Committee review.`;
}
