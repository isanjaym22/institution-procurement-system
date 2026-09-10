import { useCallback, useEffect, useState } from "react";
import {
  Buildings,
  CheckCircle,
  CircleNotch,
  IdentificationCard,
  Key,
  PencilSimple,
  Plus,
  ShieldCheck,
  Users,
  XCircle,
} from "@phosphor-icons/react";
import {
  assignHod,
  changeOwnPassword,
  createDepartment,
  createDesignation,
  createStaff,
  fetchLoginAuditPaged,
  listDepartmentsAdmin,
  listDesignations,
  listStaff,
  resetStaffPassword,
  updateDepartment,
  updateDesignation,
  updateStaff,
  STAFF_ROLES,
  type Department,
  type Designation,
  type LoginAuditEvent,
  type StaffMember,
} from "../lib/api";
import { roleLabel } from "../lib/workflow";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Select } from "./ui/select";

type Tab = "staff" | "departments" | "designations" | "security";

const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
  { key: "staff", label: "Staff", icon: <Users size={16} /> },
  { key: "departments", label: "Departments", icon: <Buildings size={16} /> },
  { key: "designations", label: "Designations", icon: <IdentificationCard size={16} /> },
  { key: "security", label: "Security", icon: <ShieldCheck size={16} /> },
];

const PAGE_SIZE = 20;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      {children}
    </label>
  );
}

function Err({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <p className="text-sm text-danger">{msg}</p>;
}

function Ok({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <p className="text-sm text-success">{msg}</p>;
}

function Loading({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 py-6 text-sm text-zinc-500">
      <CircleNotch size={16} className="animate-spin" /> {label}
    </p>
  );
}

// Horizontally scrollable table wrapper for mobile.
function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200">
      <table className="w-full min-w-[720px] text-left text-sm">{children}</table>
    </div>
  );
}

const th = "border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-500";
const td = "border-b border-zinc-100 px-3 py-2 text-zinc-900";

const emptyStaff = {
  name: "",
  email: "",
  employee_id: "",
  designation: "",
  department_id: "",
  role: "DEPARTMENT_USER",
  is_active: true,
};

function StaffTab({ token }: { token: string }) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [depts, setDepts] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState(emptyStaff);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pwId, setPwId] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");
  const [hodDept, setHodDept] = useState<Record<string, string>>({});

  const deptName = useCallback(
    (id?: string | null) => depts.find((d) => d.id === id)?.name ?? "—",
    [depts],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, d] = await Promise.all([listStaff(token), listDepartmentsAdmin(token)]);
      setStaff(s);
      setDepts(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load staff");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function set<K extends keyof typeof emptyStaff>(k: K, v: (typeof emptyStaff)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function startEdit(s: StaffMember) {
    setEditingId(s.id);
    setNotice(null);
    setForm({
      name: s.name,
      email: s.email,
      employee_id: s.employee_id ?? "",
      designation: s.designation ?? "",
      department_id: s.department_id ?? "",
      role: s.role,
      is_active: s.is_active,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyStaff);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      employee_id: form.employee_id.trim(),
      designation: form.designation.trim(),
      department_id: form.department_id || null,
      role: form.role,
      is_active: form.is_active,
    };
    try {
      if (editingId) {
        await updateStaff(token, editingId, payload);
        setNotice("Staff member updated.");
      } else {
        const r = await createStaff(token, payload);
        setNotice(`Staff created. Temporary password: ${r.temporary_password}`);
      }
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handlePwReset(id: string) {
    if (newPw.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await resetStaffPassword(token, id, newPw);
      setNotice("Password reset successfully.");
      setPwId(null);
      setNewPw("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password reset failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignHod(userId: string) {
    const deptId = hodDept[userId];
    if (!deptId) {
      setError("Pick a department first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await assignHod(token, deptId, userId);
      setNotice("HOD assigned (user promoted to HOD).");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "HOD assignment failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading label="Loading staff…" />;

  return (
    <div className="space-y-6">
      <Err msg={error} />
      <Ok msg={notice} />

      <form onSubmit={handleSubmit} className="grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 md:grid-cols-3">
        <div className="md:col-span-3">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <Plus size={16} /> {editingId ? "Edit staff member" : "Create staff member"}
          </h3>
        </div>
        <Field label="Name">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
        </Field>
        <Field label="Employee ID">
          <Input value={form.employee_id} onChange={(e) => set("employee_id", e.target.value)} required />
        </Field>
        <Field label="Designation">
          <Input value={form.designation} onChange={(e) => set("designation", e.target.value)} required placeholder="e.g. Assistant Professor" />
        </Field>
        <Field label="Department">
          <Select value={form.department_id} onChange={(e) => set("department_id", e.target.value)}>
            <option value="">— None —</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
            ))}
          </Select>
        </Field>
        <Field label="Role">
          <Select value={form.role} onChange={(e) => set("role", e.target.value)}>
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>{roleLabel(r)}</option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input type="checkbox" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} />
          Active
        </label>
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" size="sm" disabled={saving}>{saving ? "Saving…" : editingId ? "Update" : "Create"}</Button>
          {editingId && (
            <Button type="button" size="sm" variant="secondary" onClick={cancelEdit}>Cancel</Button>
          )}
        </div>
      </form>

      {staff.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">No staff found.</p>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Email / Emp ID</th>
              <th className={th}>Role</th>
              <th className={th}>Department</th>
              <th className={th}>Status</th>
              <th className={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td className={td}>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-zinc-500">{s.designation ?? "—"}</p>
                </td>
                <td className={td}>
                  <p>{s.email}</p>
                  <p className="text-xs text-zinc-500">{s.employee_id ?? "—"}</p>
                </td>
                <td className={td}>{roleLabel(s.role)}</td>
                <td className={td}>{deptName(s.department_id)}</td>
                <td className={td}>
                  <Badge tone={s.is_active ? "success" : "neutral"}>
                    {s.is_active ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className={td}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => startEdit(s)}>
                      <PencilSimple size={14} /> Edit
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => { setPwId(pwId === s.id ? null : s.id); setNewPw(""); }}>
                      <Key size={14} /> Password
                    </Button>
                    <Select
                      aria-label={`HOD department for ${s.name}`}
                      value={hodDept[s.id] ?? ""}
                      onChange={(e) => setHodDept((m) => ({ ...m, [s.id]: e.target.value }))}
                      className="h-8 w-auto text-xs"
                    >
                      <option value="">HOD of…</option>
                      {depts.map((d) => (
                        <option key={d.id} value={d.id}>{d.code}</option>
                      ))}
                    </Select>
                    <Button size="sm" variant="secondary" disabled={saving || !hodDept[s.id]} onClick={() => void handleAssignHod(s.id)}>
                      Assign HOD
                    </Button>
                  </div>
                  {pwId === s.id && (
                    <div className="mt-2 flex gap-2">
                      <Input
                        type="password"
                        placeholder="New password (8+ chars)"
                        value={newPw}
                        onChange={(e) => setNewPw(e.target.value)}
                        className="h-8 text-xs"
                      />
                      <Button size="sm" disabled={saving} onClick={() => void handlePwReset(s.id)}>
                        Set
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}

function DepartmentsTab({ token }: { token: string }) {
  const [depts, setDepts] = useState<Department[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [hodId, setHodId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const hodName = useCallback(
    (id?: string | null) => staff.find((s) => s.id === id)?.name ?? "—",
    [staff],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, s] = await Promise.all([listDepartmentsAdmin(token), listStaff(token)]);
      setDepts(d);
      setStaff(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load departments");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function reset() {
    setCode("");
    setName("");
    setActive(true);
    setHodId("");
    setEditingId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    const payload = { code: code.trim(), name: name.trim(), is_active: active, hod_user_id: hodId || null };
    try {
      if (editingId) {
        await updateDepartment(token, editingId, payload);
        setNotice("Department updated.");
      } else {
        await createDepartment(token, payload);
        setNotice("Department created.");
      }
      reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading label="Loading departments…" />;

  return (
    <div className="space-y-6">
      <Err msg={error} />
      <Ok msg={notice} />

      <form onSubmit={handleSubmit} className="grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <Plus size={16} /> {editingId ? "Edit department" : "Create department"}
          </h3>
        </div>
        <Field label="Code">
          <Input value={code} onChange={(e) => setCode(e.target.value)} required placeholder="e.g. CS" />
        </Field>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Computer Science" />
        </Field>
        <Field label="HOD (optional)">
          <Select value={hodId} onChange={(e) => setHodId(e.target.value)}>
            <option value="">— None —</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.email})</option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-zinc-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" size="sm" disabled={saving}>{saving ? "Saving…" : editingId ? "Update" : "Create"}</Button>
          {editingId && (
            <Button type="button" size="sm" variant="secondary" onClick={reset}>Cancel</Button>
          )}
        </div>
      </form>

      {depts.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">No departments found.</p>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Code</th>
              <th className={th}>Name</th>
              <th className={th}>HOD</th>
              <th className={th}>Status</th>
              <th className={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {depts.map((d) => (
              <tr key={d.id}>
                <td className={td}>{d.code}</td>
                <td className={td}>{d.name}</td>
                <td className={td}>{hodName(d.hod_user_id)}</td>
                <td className={td}>
                  <Badge tone={d.is_active ? "success" : "neutral"}>
                    {d.is_active ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className={td}>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditingId(d.id);
                      setCode(d.code);
                      setName(d.name);
                      setActive(d.is_active);
                      setHodId(d.hod_user_id ?? "");
                    }}
                  >
                    <PencilSimple size={14} /> Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}

function DesignationsTab({ token }: { token: string }) {
  const [rows, setRows] = useState<Designation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [active, setActive] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listDesignations(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load designations");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function reset() {
    setName("");
    setCode("");
    setActive(true);
    setEditingId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    const payload = { name: name.trim(), code: code.trim() || undefined, is_active: active };
    try {
      if (editingId) {
        await updateDesignation(token, editingId, payload);
        setNotice("Designation updated.");
      } else {
        await createDesignation(token, payload);
        setNotice("Designation created.");
      }
      reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading label="Loading designations…" />;

  return (
    <div className="space-y-6">
      <Err msg={error} />
      <Ok msg={notice} />

      <form onSubmit={handleSubmit} className="grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 md:grid-cols-3">
        <div className="md:col-span-3">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <Plus size={16} /> {editingId ? "Edit designation" : "Create designation"}
          </h3>
        </div>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Assistant Professor" />
        </Field>
        <Field label="Code (optional)">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. AP" />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-zinc-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>
        <div className="flex gap-2 md:col-span-3">
          <Button type="submit" size="sm" disabled={saving}>{saving ? "Saving…" : editingId ? "Update" : "Create"}</Button>
          {editingId && (
            <Button type="button" size="sm" variant="secondary" onClick={reset}>Cancel</Button>
          )}
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">No designations found.</p>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Code</th>
              <th className={th}>Status</th>
              <th className={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td className={td}>{d.name}</td>
                <td className={td}>{d.code ?? "—"}</td>
                <td className={td}>
                  <Badge tone={d.is_active ? "success" : "neutral"}>
                    {d.is_active ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className={td}>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditingId(d.id);
                      setName(d.name);
                      setCode(d.code ?? "");
                      setActive(d.is_active);
                    }}
                  >
                    <PencilSimple size={14} /> Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}

function SecurityTab({ token }: { token: string }) {
  const [currentPw, setCurrentPw] = useState("");
  const [nextPw, setNextPw] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

  const [rows, setRows] = useState<LoginAuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [email, setEmail] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (p: number, emailF: string, successF: string) => {
      setLoading(true);
      setError(null);
      try {
        const params: Record<string, string> = {
          limit: String(PAGE_SIZE),
          offset: String(p * PAGE_SIZE),
        };
        if (emailF.trim()) params.email = emailF.trim();
        if (successF) params.success = successF;
        const data = await fetchLoginAuditPaged(token, params);
        setRows(data.rows);
        setTotal(data.total);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load login audit");
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void load(0, "", "");
  }, [load]);

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    setPage(0);
    void load(0, email, success);
  }

  function goto(p: number) {
    setPage(p);
    void load(p, email, success);
  }

  async function handlePwChange(e: React.FormEvent) {
    e.preventDefault();
    setPwSaving(true);
    setPwErr(null);
    setPwMsg(null);
    try {
      await changeOwnPassword(token, currentPw, nextPw);
      setPwMsg("Your password was changed.");
      setCurrentPw("");
      setNextPw("");
    } catch (err) {
      setPwErr(err instanceof Error ? err.message : "Password change failed");
    } finally {
      setPwSaving(false);
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-8">
      <form onSubmit={handlePwChange} className="grid max-w-xl gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-900">
          <Key size={16} /> Change my password
        </h3>
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} required />
        </Field>
        <Field label="New password (8+ characters)">
          <Input type="password" autoComplete="new-password" value={nextPw} onChange={(e) => setNextPw(e.target.value)} required minLength={8} />
        </Field>
        <Err msg={pwErr} />
        <Ok msg={pwMsg} />
        <div>
          <Button type="submit" size="sm" disabled={pwSaving}>{pwSaving ? "Changing…" : "Change password"}</Button>
        </div>
      </form>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-900">Login audit ({total})</h3>
        <form onSubmit={applyFilters} className="flex flex-wrap items-end gap-3">
          <Field label="Email contains">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" className="w-56" />
          </Field>
          <Field label="Outcome">
            <Select value={success} onChange={(e) => setSuccess(e.target.value)} className="w-36">
              <option value="">All</option>
              <option value="true">Success</option>
              <option value="false">Failed</option>
            </Select>
          </Field>
          <Button type="submit" size="sm" variant="secondary">Apply</Button>
        </form>
        <Err msg={error} />
        {loading ? (
          <Loading label="Loading login audit…" />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">No login attempts match these filters.</p>
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <th className={th}>Time</th>
                  <th className={th}>User / Email</th>
                  <th className={th}>Outcome</th>
                  <th className={th}>IP</th>
                  <th className={th}>User agent</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className={`${td} whitespace-nowrap`}>
                      {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                    </td>
                    <td className={td}>
                      <p className="font-medium">{r.user_name ?? "—"}</p>
                      <p className="text-xs text-zinc-500">{r.email ?? "—"}</p>
                    </td>
                    <td className={td}>
                      <Badge tone={r.success ? "success" : "danger"}>
                        <span className="inline-flex items-center gap-1">
                          {r.success ? <CheckCircle size={13} /> : <XCircle size={13} />}
                          {r.success ? "Success" : "Failed"}
                        </span>
                      </Badge>
                    </td>
                    <td className={td}>{r.ip_address ?? "—"}</td>
                    <td className={`${td} max-w-[280px] truncate text-xs text-zinc-500`} title={r.user_agent ?? ""}>
                      {r.user_agent ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <div className="flex items-center gap-3 text-sm text-zinc-600">
              <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => goto(page - 1)}>
                Previous
              </Button>
              <span>Page {page + 1} of {pages}</span>
              <Button size="sm" variant="secondary" disabled={page + 1 >= pages} onClick={() => goto(page + 1)}>
                Next
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminPanel({ token }: { token: string }) {
  const [tab, setTab] = useState<Tab>("staff");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Admin panel</CardTitle>
        <CardDescription>Staff, departments, designations, and security — scoped to your institution.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Admin sections">
          {TABS.map((t) => (
            <Button
              key={t.key}
              size="sm"
              role="tab"
              aria-selected={tab === t.key}
              variant={tab === t.key ? "primary" : "secondary"}
              onClick={() => setTab(t.key)}
            >
              {t.icon} {t.label}
            </Button>
          ))}
        </div>
        {tab === "staff" && <StaffTab token={token} />}
        {tab === "departments" && <DepartmentsTab token={token} />}
        {tab === "designations" && <DesignationsTab token={token} />}
        {tab === "security" && <SecurityTab token={token} />}
      </CardContent>
    </Card>
  );
}
