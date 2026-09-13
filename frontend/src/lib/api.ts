// Typed API client for the Institution Procurement backend.
// Base URL from VITE_API_URL, fallback http://localhost:8000/api/v1.
// Auth: Bearer JWT in localStorage key "ips_token".

export const API_BASE =
  import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1";

export const TOKEN_KEY = "ips_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// ---- Types (mirror backend schemas) ----

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  department_id?: string | null;
  employee_id?: string | null;
  designation?: string | null;
  institution_id: string;
}

export interface ReqItem {
  line_no: number;
  item_name: string;
  specification: string;
  quantity: number;
  tentative_unit_price: number | string;
}

export interface Req {
  id: string;
  procurement_id: string;
  institution_id: string;
  department_id: string;
  department_name_snapshot?: string | null;
  department_code_snapshot?: string | null;
  faculty_name_snapshot?: string | null;
  faculty_employee_id_snapshot?: string | null;
  faculty_designation_snapshot?: string | null;
  status: string;
  origin?: string | null;
  creator_role?: string | null;
  amc_preference?: boolean | string | null;
  category: string;
  justification: string;
  hod_remarks?: string | null;
  principal_remarks?: string | null;
  created_at?: string | null;
  items: ReqItem[];
}

export interface HistoryEvent {
  action: string;
  from_status?: string | null;
  to_status: string;
  actor_role?: string | null;
  remarks?: string | null;
  created_at?: string | null;
}

export interface TrackChecklistItem {
  key: string;
  label: string;
  state: string;
}

export interface TrackResult {
  procurement_id: string;
  status: string;
  stage_label: string;
  owner_role: string;
  last_updated?: string | null;
  checklist: TrackChecklistItem[];
}

export interface CreateReqBody {
  category: string;
  justification: string;
  amc_preference: boolean;
  items: Array<{
    item_name: string;
    specification: string;
    quantity: number;
    tentative_unit_price: number | string;
  }>;
}

export interface AuditEvent {
  action: string;
  actor_name?: string | null;
  actor_role?: string | null;
  before_data?: unknown;
  after_data?: unknown;
  remarks?: string | null;
  created_at?: string | null;
}

export interface LoginAuditEvent {
  id: string;
  user_id?: string | null;
  user_name?: string | null;
  email?: string | null;
  success?: boolean | null;
  ip_address?: string | null;
  user_agent?: string | null;
  created_at?: string | null;
}

// ---- Helpers ----

// Friendly labels for backend field names seen in 422 validation errors.
const FIELD_LABELS: Record<string, string> = {
  approved_amount: "Indicative amount",
  quantity_received: "Quantity received",
  amount: "Amount",
  budget_head: "Budget head",
  sub_head: "Sub-head",
  amc_recommendation: "AMC recommendation",
  method_other_text: "Custom method",
  head_other_text: "Custom head",
  vendor_name: "Vendor name",
  po_number: "PO number",
  invoice_number: "Invoice number",
  payment_reference: "Payment reference",
  cheque_number: "Cheque number",
  transaction_number: "Transaction number",
  justification: "Justification",
  category: "Category",
  remarks: "Remarks",
};

function fieldLabel(name: string): string {
  return (
    FIELD_LABELS[name] ??
    name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

interface ValidationIssue {
  loc?: (string | number)[];
  msg?: string;
}

function friendlyDetail(detail: unknown, status: number): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = (detail as ValidationIssue[])
      .map((d) => {
        const loc = Array.isArray(d.loc) ? d.loc : [];
        const field = [...loc].reverse().find((p) => p !== "body" && p !== "query");
        const msg = typeof d.msg === "string" ? d.msg : "is invalid";
        return field !== undefined && field !== ""
          ? `${fieldLabel(String(field))}: ${msg.charAt(0).toLowerCase()}${msg.slice(1)}`
          : msg;
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
  }
  if (status === 401) return "Your session expired — please sign in again.";
  if (status === 403) return "You don't have permission for this action.";
  if (status === 404) return "Not found — it may have been moved or deleted.";
  if (status === 409)
    return "This action isn't available right now — the requisition may have moved on. Refresh and try again.";
  if (status === 422)
    return "Some values need attention — please check the form and try again.";
  if (status >= 500) return "Something went wrong on the server. Try again in a moment.";
  return "Action failed. Try again.";
}

async function parseError(res: Response): Promise<string> {
  try {
    const x = (await res.json()) as { detail?: unknown };
    return friendlyDetail(x.detail, res.status);
  } catch {
    return friendlyDetail(undefined, res.status);
  }
}

// Normalise anything thrown by fetch into a human-readable message.
export function friendlyError(err: unknown, fallback: string): string {
  if (err instanceof TypeError) {
    return "Can't reach the server. Check your connection and try again.";
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// ---- Auth ----

export async function login(
  email: string,
  password: string,
): Promise<{ access_token: string; user: User }> {
  const body = new URLSearchParams();
  body.set("username", email);
  body.set("password", password);
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ access_token: string; user: User }>;
}

export async function fetchMe(token: string): Promise<User> {
  const res = await fetch(`${API_BASE}/auth/me`, { headers: auth(token) });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<User>;
}

// ---- Requisitions ----

// Base queue + every role pending queue combined (deduped by id).
// Pending endpoints are role-gated; 403s for other roles are skipped so one
// call serves all roles (incl. ADMIN, which inherits several steps).
export async function listReqs(token: string, _role: string): Promise<Req[]> {
  const settled = await Promise.allSettled(
    [
      "requisitions",
      "requisitions/hod/pending",
      "requisitions/principal/pending",
      "requisitions/finance/pending",
      "requisitions/purchase/pending",
      "requisitions/acceptance/pending",
      "requisitions/bursar/pending",
    ].map(async (path) => {
      const res = await fetch(`${API_BASE}/${path}`, { headers: auth(token) });
      if (!res.ok) throw new Error(await parseError(res));
      return res.json() as Promise<Req[]>;
    }),
  );
  const lists = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  if (lists.length === 0) throw new Error("Could not load queue");
  const seen = new Set<string>();
  return lists.flat().filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

export async function createReq(
  token: string,
  body: CreateReqBody,
): Promise<Req> {
  const res = await fetch(`${API_BASE}/requisitions`, {
    method: "POST",
    headers: { ...auth(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<Req>;
}

// Generic workflow transition: path is relative to /requisitions/{id}/,
// e.g. "submit", "hod/approve". Accepts JSON body or FormData (file uploads).
export async function runAction(
  token: string,
  id: string,
  path: string,
  body: Record<string, unknown> | FormData = {},
): Promise<Req> {
  const isForm = body instanceof FormData;
  const res = await fetch(`${API_BASE}/requisitions/${id}/${path}`, {
    method: "POST",
    headers: isForm
      ? auth(token)
      : { ...auth(token), "Content-Type": "application/json" },
    body: isForm ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<Req>;
}

// ---- Public tracking (no auth) ----

export async function trackProcurement(pid: string): Promise<TrackResult> {
  const res = await fetch(
    `${API_BASE}/requisitions/track?procurement_id=${encodeURIComponent(pid.trim())}`,
  );
  if (!res.ok) throw new Error("Invalid Procurement ID");
  return res.json() as Promise<TrackResult>;
}

// ---- History / PDF ----

export async function fetchHistory(
  token: string,
  id: string,
): Promise<HistoryEvent[]> {
  const res = await fetch(`${API_BASE}/requisitions/${id}/history`, {
    headers: auth(token),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<HistoryEvent[]>;
}

export async function downloadPdf(
  token: string,
  id: string,
  procurement_id: string,
): Promise<void> {
  return downloadBlob(
    token,
    `${API_BASE}/requisitions/${id}/pdf`,
    `${procurement_id.replace(/\//g, "-")}.pdf`,
  );
}

// ---- NEW workflow action helpers (thin wrappers over runAction) ----

export async function submitReq(token: string, id: string): Promise<Req> {
  return runAction(token, id, "submit");
}

export async function hodDecision(
  token: string,
  id: string,
  approve: boolean,
  remarks: string,
): Promise<Req> {
  return runAction(token, id, approve ? "hod/approve" : "hod/reject", {
    remarks,
  });
}

export async function principalDecision(
  token: string,
  id: string,
  approve: boolean,
  remarks: string,
): Promise<Req> {
  return runAction(
    token,
    id,
    approve ? "principal/approve" : "principal/reject",
    { remarks },
  );
}

export interface FinanceForwardBody {
  budget_head: string;
  head_other_text?: string;
  sub_head: string;
  approved_amount?: number | string | null;
  amount_remark?: string;
  amc_recommendation: boolean;
  remarks: string;
}

export async function financeForward(
  token: string,
  id: string,
  body: FinanceForwardBody,
): Promise<Req> {
  return runAction(token, id, "finance/forward", { ...body });
}

export interface PurchaseMethodBody {
  method: string;
  method_other_text?: string;
  meeting_no?: string;
  rule_reference?: string;
  remarks: string;
}

export async function purchaseMethod(
  token: string,
  id: string,
  body: PurchaseMethodBody,
): Promise<Req> {
  return runAction(token, id, "purchase/method", { ...body });
}

export async function uploadWorkOrder(
  token: string,
  id: string,
  file: File,
): Promise<Req> {
  const fd = new FormData();
  fd.append("file", file);
  return runAction(token, id, "purchase/work-order", fd);
}

export async function completeAcceptance(
  token: string,
  id: string,
  body: Record<string, unknown>,
): Promise<Req> {
  return runAction(token, id, "acceptance/complete", body);
}

// Bursar endpoint is FormData with all-optional string fields; amc_final is
// sent as "true"/"false" or omitted. Empty strings are dropped.
export async function bursarRecord(
  token: string,
  id: string,
  fields: Record<string, string>,
  file?: File | null,
): Promise<Req> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== "") fd.append(k, v);
  }
  if (file) fd.append("file", file);
  return runAction(token, id, "bursar/record", fd);
}

async function downloadBlob(
  token: string,
  url: string,
  filename: string,
): Promise<void> {
  const res = await fetch(url, { headers: auth(token) });
  if (!res.ok) throw new Error("Download failed");
  const blob = await res.blob();
  const obj = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = obj;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(obj);
}

export async function downloadWorkOrder(
  token: string,
  id: string,
  procurement_id: string,
): Promise<void> {
  return downloadBlob(
    token,
    `${API_BASE}/requisitions/${id}/work-order`,
    `${procurement_id.replace(/\//g, "-")}-work-order.pdf`,
  );
}

export async function downloadPaymentDoc(
  token: string,
  id: string,
  procurement_id: string,
): Promise<void> {
  return downloadBlob(
    token,
    `${API_BASE}/requisitions/${id}/payment-document`,
    `${procurement_id.replace(/\//g, "-")}-payment.pdf`,
  );
}

export async function fetchAudit(
  token: string,
  id: string,
): Promise<AuditEvent[]> {
  const res = await fetch(`${API_BASE}/requisitions/${id}/audit`, {
    headers: auth(token),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<AuditEvent[]>;
}

// ---- Admin / master data ----

export async function adminList<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API_BASE}/admin/${path}`, {
    headers: auth(token),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<T>;
}

export async function adminPost<T>(
  token: string,
  path: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}/admin/${path}`, {
    method: "POST",
    headers: { ...auth(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<T>;
}

// Login audit trail (admin). Query params e.g. { email, success, limit, offset }.
// Backend returns { total, rows }; this normalizes to rows for compatibility.
export async function fetchLoginAudit(
  token: string,
  params: Record<string, string> = {},
): Promise<LoginAuditEvent[]> {
  return (await fetchLoginAuditPaged(token, params)).rows;
}

// ---- Admin panel + reports (additive extensions; existing exports untouched) ----

// Demo seed accounts (all password "password").
export const DEMO_ACCOUNTS: string[] = [
  "department@example.com",
  "hod@example.com",
  "physics@example.com",
  "hod.physics@example.com",
  "math@example.com",
  "hod.math@example.com",
  "finance@example.com",
  "purchase@example.com",
  "store@example.com",
  "bursar@example.com",
  "acceptance@example.com",
  "amc@example.com",
  "principal@example.com",
  "office@example.com",
  "admin@example.com",
];

export const STAFF_ROLES: string[] = [
  "DEPARTMENT_USER",
  "HOD",
  "OFFICE",
  "PRINCIPAL",
  "FINANCE",
  "PURCHASE_COMMITTEE",
  "STORE_OFFICER",
  "ACCEPTANCE_OFFICER",
  "BURSAR",
  "AMC_OFFICER",
  "ADMIN",
];

// Roles allowed to view purchase reports (dept-scoped roles see own dept only).
export const REPORT_VIEW_ROLES: string[] = [
  "PRINCIPAL",
  "BURSAR",
  "ADMIN",
  "FINANCE",
  "PURCHASE_COMMITTEE",
  "DEPARTMENT_USER",
  "HOD",
  "OFFICE",
];

export const DEPT_SCOPED_REPORT_ROLES: string[] = [
  "DEPARTMENT_USER",
  "HOD",
  "OFFICE",
];

export interface Department {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  hod_user_id?: string | null;
}

export interface DepartmentPayload {
  code: string;
  name: string;
  is_active: boolean;
  hod_user_id?: string | null;
}

export interface Designation {
  id: string;
  name: string;
  code?: string | null;
  is_active: boolean;
}

export interface DesignationPayload {
  name: string;
  code?: string;
  is_active: boolean;
}

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  employee_id?: string | null;
  designation?: string | null;
  department_id?: string | null;
  role: string;
  is_active: boolean;
}

export interface StaffPayload {
  name: string;
  email: string;
  employee_id: string;
  designation: string;
  department_id?: string | null;
  role: string;
  is_active: boolean;
  password?: string;
}

export interface LoginAuditPage {
  total: number;
  rows: LoginAuditEvent[];
}

export interface PurchaseReportRow {
  procurement_id: string;
  date?: string | null;
  department?: string | null;
  department_code?: string | null;
  faculty?: string | null;
  category?: string | null;
  head?: string | null;
  sub_head?: string | null;
  method?: string | null;
  amc?: boolean | null;
  total?: string | null;
  status: string;
}

export interface PurchaseReport {
  from_date: string;
  to_date: string;
  count: number;
  rows: PurchaseReportRow[];
}

export interface ReportFilters {
  from_date: string;
  to_date: string;
  department_id?: string;
  procurement_id?: string;
  category?: string;
  head?: string;
  method?: string;
  amc?: string;
}

export async function adminPut<T>(
  token: string,
  path: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}/admin/${path}`, {
    method: "PUT",
    headers: { ...auth(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<T>;
}

export async function listDepartmentsAdmin(token: string): Promise<Department[]> {
  return adminList<Department[]>(token, "departments");
}

export async function createDepartment(
  token: string,
  body: DepartmentPayload,
): Promise<{ id: string }> {
  return adminPost<{ id: string }>(token, "departments", { ...body });
}

export async function updateDepartment(
  token: string,
  id: string,
  body: DepartmentPayload,
): Promise<{ ok: boolean }> {
  return adminPut<{ ok: boolean }>(token, `departments/${id}`, { ...body });
}

export async function assignHod(
  token: string,
  departmentId: string,
  userId: string,
): Promise<{ ok: boolean }> {
  return adminPost<{ ok: boolean }>(
    token,
    `departments/${departmentId}/assign-hod/${userId}`,
  );
}

export async function listDesignations(token: string): Promise<Designation[]> {
  return adminList<Designation[]>(token, "designations");
}

export async function createDesignation(
  token: string,
  body: DesignationPayload,
): Promise<Designation> {
  return adminPost<Designation>(token, "designations", { ...body });
}

export async function updateDesignation(
  token: string,
  id: string,
  body: DesignationPayload,
): Promise<{ ok: boolean }> {
  return adminPut<{ ok: boolean }>(token, `designations/${id}`, { ...body });
}

export async function listStaff(token: string): Promise<StaffMember[]> {
  return adminList<StaffMember[]>(token, "staff");
}

export async function createStaff(
  token: string,
  body: StaffPayload,
): Promise<{ id: string; temporary_password: string }> {
  return adminPost<{ id: string; temporary_password: string }>(token, "staff", {
    ...body,
  });
}

export async function updateStaff(
  token: string,
  id: string,
  body: StaffPayload,
): Promise<{ ok: boolean }> {
  return adminPut<{ ok: boolean }>(token, `staff/${id}`, { ...body });
}

export async function resetStaffPassword(
  token: string,
  id: string,
  newPassword: string,
): Promise<{ ok: boolean; message?: string }> {
  return adminPost<{ ok: boolean; message?: string }>(token, `staff/${id}/password`, {
    new_password: newPassword,
  });
}

// Own password change (ADMIN-only on backend: 403 for other roles).
export async function changeOwnPassword(
  token: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(`${API_BASE}/auth/change-password`, {
    method: "POST",
    headers: { ...auth(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ ok: boolean; message?: string }>;
}

// Active departments for filters (backend scopes dept roles to own dept).
export async function listActiveDepartments(token: string): Promise<Department[]> {
  const res = await fetch(`${API_BASE}/departments`, { headers: auth(token) });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<Department[]>;
}

// Paged login audit: { user_id?, email?, success?, limit?, offset? }.
export async function fetchLoginAuditPaged(
  token: string,
  params: Record<string, string> = {},
): Promise<LoginAuditPage> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/login-audit${qs ? `?${qs}` : ""}`, {
    headers: auth(token),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as
    | LoginAuditPage
    | { rows?: LoginAuditEvent[]; total?: number }
    | LoginAuditEvent[];
  if (Array.isArray(data)) return { total: data.length, rows: data };
  return { total: data.total ?? data.rows?.length ?? 0, rows: data.rows ?? [] };
}

function reportQuery(filters: ReportFilters): string {
  const p = new URLSearchParams();
  p.set("from_date", filters.from_date);
  p.set("to_date", filters.to_date);
  if (filters.department_id) p.set("department_id", filters.department_id);
  if (filters.procurement_id?.trim())
    p.set("procurement_id", filters.procurement_id.trim());
  if (filters.category) p.set("category", filters.category);
  if (filters.head) p.set("head", filters.head);
  if (filters.method) p.set("method", filters.method);
  if (filters.amc) p.set("amc", filters.amc);
  return p.toString();
}

export async function fetchPurchaseReport(
  token: string,
  filters: ReportFilters,
): Promise<PurchaseReport> {
  const res = await fetch(
    `${API_BASE}/requisitions/reports/purchases?${reportQuery(filters)}`,
    { headers: auth(token) },
  );
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<PurchaseReport>;
}

export async function downloadPurchaseReportPdf(
  token: string,
  filters: ReportFilters,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/requisitions/reports/purchases/pdf?${reportQuery(filters)}`,
    { headers: auth(token) },
  );
  if (!res.ok) throw new Error("Report PDF download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `purchase-report-${filters.from_date}-${filters.to_date}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
