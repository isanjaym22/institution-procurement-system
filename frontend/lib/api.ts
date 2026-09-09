const API =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  department_id?: string | null;
  employee_id?: string | null;
  designation?: string | null;
  institution_id: string;
};

export type Item = {
  line_no: number;
  item_name: string;
  specification: string;
  quantity: number;
  tentative_unit_price: string;
};

export type Req = {
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
  category: string;
  justification: string;
  hod_remarks?: string | null;
  principal_remarks?: string | null;
  created_at?: string | null;
  items: Item[];
};

export type Department = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  hod_user_id?: string | null;
};

export type HistoryEvent = {
  action: string;
  from_status?: string | null;
  to_status: string;
  actor_role?: string;
  remarks?: string | null;
  created_at?: string | null;
};

export type AuditEvent = {
  action: string;
  actor_name?: string;
  actor_role?: string;
  before_data?: Record<string, unknown> | null;
  after_data?: Record<string, unknown> | null;
  remarks?: string | null;
  created_at?: string | null;
};

export type TrackResult = {
  procurement_id: string;
  status: string;
  stage_label: string;
  owner_role: string;
  last_updated?: string | null;
  checklist: { key: string; label: string; state: string }[];
};

async function parseError(res: Response): Promise<string> {
  try {
    const x = await res.json();
    return typeof x.detail === "string"
      ? x.detail
      : JSON.stringify(x.detail) || "Action failed";
  } catch {
    return "Action failed";
  }
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export async function login(
  email: string,
  password: string
): Promise<{ access_token: string; user: User }> {
  const body = new URLSearchParams();
  body.set("username", email);
  body.set("password", password);
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("Invalid login");
  return res.json();
}

export async function fetchMe(token: string): Promise<User> {
  const res = await fetch(`${API}/auth/me`, { headers: auth(token) });
  if (!res.ok) throw new Error("Session expired");
  return res.json();
}

export async function listRequisitions(
  token: string,
  role: string
): Promise<Req[]> {
  let url = `${API}/requisitions`;
  if (role === "HOD") url += "/hod/pending";
  else if (role === "PRINCIPAL") url += "/principal/pending";
  const res = await fetch(url, { headers: auth(token) });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function listDepartments(token: string): Promise<Department[]> {
  const res = await fetch(`${API}/departments`, { headers: auth(token) });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function runAction(
  token: string,
  id: string,
  path: string,
  body: Record<string, unknown> = {}
): Promise<Req> {
  const res = await fetch(`${API}/requisitions/${id}/${path}`, {
    method: "POST",
    headers: { ...auth(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function createRequisition(
  token: string,
  body: Record<string, unknown>
): Promise<Req> {
  const res = await fetch(`${API}/requisitions`, {
    method: "POST",
    headers: { ...auth(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function trackProcurement(pid: string): Promise<TrackResult> {
  const res = await fetch(
    `${API}/requisitions/track?procurement_id=${encodeURIComponent(pid.trim())}`
  );
  if (!res.ok) throw new Error("Invalid Procurement ID");
  return res.json();
}

export async function fetchHistory(
  token: string,
  id: string
): Promise<HistoryEvent[]> {
  const res = await fetch(`${API}/requisitions/${id}/history`, {
    headers: auth(token),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fetchAudit(
  token: string,
  id: string
): Promise<AuditEvent[]> {
  const res = await fetch(`${API}/requisitions/${id}/audit`, {
    headers: auth(token),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function downloadPdf(
  token: string,
  r: Req
): Promise<void> {
  const res = await fetch(`${API}/requisitions/${r.id}/pdf`, {
    headers: auth(token),
  });
  if (!res.ok) throw new Error("Download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${r.procurement_id.replace(/\//g, "-")}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function adminList<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}/admin/${path}`, { headers: auth(token) });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function adminPost(
  token: string,
  path: string,
  body: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`${API}/admin/${path}`, {
    method: "POST",
    headers: { ...auth(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function assignHod(
  token: string,
  departmentId: string,
  userId: string
): Promise<void> {
  const res = await fetch(
    `${API}/admin/departments/${departmentId}/assign-hod/${userId}`,
    { method: "POST", headers: auth(token) }
  );
  if (!res.ok) throw new Error(await parseError(res));
}

export async function changePassword(
  token: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const res = await fetch(`${API}/auth/change-password`, {
    method: "POST",
    headers: { ...auth(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export function requisitionTotal(r: Req): number {
  return r.items.reduce(
    (a, i) => a + i.quantity * Number(i.tentative_unit_price),
    0
  );
}
