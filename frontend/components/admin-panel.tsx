import { useEffect, useState, type FormEvent } from "react";
import {
  BuildingOffice,
  IdentificationBadge,
  Key,
  Tag,
  Users,
} from "@phosphor-icons/react";
import {
  adminList,
  adminPost,
  assignHod,
  changePassword,
  type Department,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card, CardBody, CardDescription, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Field, Input, Select } from "./ui/field";
import { Notice } from "./ui/feedback";

type Staff = {
  id: string;
  name: string;
  email: string;
  employee_id?: string | null;
  designation?: string | null;
  department_id?: string | null;
  role: string;
};

type Desig = { id: string; name: string };

const TABS = [
  { id: "staff", label: "Staff & HOD", icon: Users },
  { id: "departments", label: "Departments", icon: BuildingOffice },
  { id: "designations", label: "Designations", icon: Tag },
  { id: "security", label: "Passwords", icon: Key },
] as const;

type TabId = (typeof TABS)[number]["id"];

const ROLES = [
  "DEPARTMENT_USER",
  "HOD",
  "PRINCIPAL",
  "FINANCE",
  "PURCHASE_COMMITTEE",
  "STORE_OFFICER",
  "ACCEPTANCE_OFFICER",
  "BURSAR",
  "AMC_OFFICER",
  "ADMIN",
];

export function AdminPanel({ token }: { token: string }) {
  const [tab, setTab] = useState<TabId>("staff");
  const [deps, setDeps] = useState<Department[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [desigs, setDesigs] = useState<Desig[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const [d, s, g] = await Promise.all([
        adminList<Department[]>(token, "departments"),
        adminList<Staff[]>(token, "staff"),
        adminList<Desig[]>(token, "designations"),
      ]);
      setDeps(d);
      setStaff(s);
      setDesigs(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load master data");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(path: string, body: Record<string, unknown>, okMsg: string) {
    setNotice("");
    setError("");
    try {
      await adminPost(token, path, body);
      setNotice(okMsg);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      return false;
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="flex items-center gap-2">
          <IdentificationBadge size={20} className="text-brand-700" aria-hidden="true" />
          <CardTitle>Administrator / Master Data</CardTitle>
        </div>
        <CardDescription>
          Departments, staff accounts, designations, HOD assignments and
          passwords for your institution.
        </CardDescription>

        <div
          role="tablist"
          aria-label="Master data sections"
          className="mt-4 flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 nice-scroll"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors duration-150",
                tab === t.id
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              <t.icon size={15} aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>

        {notice && (
          <Notice tone="success" className="mt-3">
            {notice}
          </Notice>
        )}
        {error && (
          <Notice tone="error" className="mt-3">
            {error}
          </Notice>
        )}

        <div className="mt-4" role="tabpanel">
          {tab === "staff" && (
            <StaffTab
              token={token}
              staff={staff}
              deps={deps}
              desigs={desigs}
              save={save}
              reload={load}
              setNotice={setNotice}
              setError={setError}
            />
          )}
          {tab === "departments" && (
            <DepartmentsTab deps={deps} save={save} />
          )}
          {tab === "designations" && (
            <DesignationsTab desigs={desigs} save={save} />
          )}
          {tab === "security" && (
            <SecurityTab
              token={token}
              staff={staff}
              setNotice={setNotice}
              setError={setError}
            />
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function StaffTab({
  token,
  staff,
  deps,
  desigs,
  save,
  reload,
  setNotice,
  setError,
}: {
  token: string;
  staff: Staff[];
  deps: Department[];
  desigs: Desig[];
  save: (path: string, body: Record<string, unknown>, ok: string) => Promise<boolean>;
  reload: () => Promise<void>;
  setNotice: (s: string) => void;
  setError: (s: string) => void;
}) {
  const [person, setPerson] = useState({
    name: "",
    email: "",
    employee_id: "",
    designation: "",
    department_id: "",
    role: "DEPARTMENT_USER",
    password: "",
  });

  async function create() {
    const ok = await save(
      "staff",
      {
        ...person,
        department_id: person.department_id || null,
        is_active: true,
        password: person.password || null,
      },
      "Staff account created"
    );
    if (ok)
      setPerson({
        name: "",
        email: "",
        employee_id: "",
        designation: "",
        department_id: "",
        role: "DEPARTMENT_USER",
        password: "",
      });
  }

  async function makeHod(u: Staff) {
    if (!u.department_id) return;
    setNotice("");
    setError("");
    try {
      await assignHod(token, u.department_id, u.id);
      setNotice(`HOD assigned: ${u.name}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assignment failed");
    }
  }

  const set = (k: keyof typeof person) => ({
    value: person[k],
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
    ) => setPerson({ ...person, [k]: e.target.value }),
  });

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Add faculty / staff</h3>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Full name" required><Input {...set("name")} /></Field>
          <Field label="Employee ID"><Input {...set("employee_id")} /></Field>
          <Field label="Email" required><Input type="email" {...set("email")} /></Field>
          <Field label="Designation">
            <Select {...set("designation")}>
              <option value="">Select designation</option>
              {desigs.map((d) => (
                <option key={d.id}>{d.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Department">
            <Select {...set("department_id")}>
              <option value="">Institution-level / no department</option>
              {deps.filter((d) => d.is_active).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Role" required>
            <Select {...set("role")}>
              {ROLES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
          </Field>
          <Field label="Initial password" hint="Optional">
            <Input type="password" autoComplete="new-password" {...set("password")} />
          </Field>
        </div>
        <Button size="sm" className="mt-3" onClick={create}>
          Create Staff Account
        </Button>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-900">Faculty / staff & HOD assignment</h3>
        <div className="nice-scroll mt-2 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-160 text-left text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <th scope="col" className="px-3 py-2 font-medium">Employee</th>
                <th scope="col" className="px-3 py-2 font-medium">Designation</th>
                <th scope="col" className="px-3 py-2 font-medium">Department</th>
                <th scope="col" className="px-3 py-2 font-medium">Role</th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staff.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2">
                    <span className="font-medium text-slate-900">{u.name}</span>
                    <br />
                    <span className="text-xs text-slate-500">
                      {u.employee_id} · {u.email}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{u.designation || "—"}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {deps.find((d) => d.id === u.department_id)?.name || "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{u.role}</td>
                  <td className="px-3 py-2">
                    {u.department_id && (
                      <Button size="sm" variant="outline" onClick={() => makeHod(u)}>
                        Assign as HOD
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DepartmentsTab({
  deps,
  save,
}: {
  deps: Department[];
  save: (path: string, body: Record<string, unknown>, ok: string) => Promise<boolean>;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  async function add() {
    if (await save("departments", { code, name, is_active: true, hod_user_id: null }, "Department added")) {
      setCode("");
      setName("");
    }
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900">Departments</h3>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <Field label="Code" required><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CS" /></Field>
        <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Computer Science" /></Field>
        <Button size="sm" onClick={add} className="sm:mb-0.5">Add Department</Button>
      </div>
      <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {deps.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2 px-3.5 py-2 text-sm">
            <span>
              <span className="font-mono font-medium text-slate-900">{d.code}</span>
              <span className="text-slate-500"> — {d.name}</span>
            </span>
            {d.hod_user_id && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                HOD assigned
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DesignationsTab({
  desigs,
  save,
}: {
  desigs: Desig[];
  save: (path: string, body: Record<string, unknown>, ok: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");

  async function add() {
    if (await save("designations", { name, is_active: true }, "Designation added")) setName("");
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900">Designations</h3>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Designation" className="sm:flex-1" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Assistant Professor" />
        </Field>
        <Button size="sm" onClick={add} className="sm:mb-0.5">Add Designation</Button>
      </div>
      <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {desigs.map((d) => (
          <li key={d.id} className="px-3.5 py-2 text-sm text-slate-800">{d.name}</li>
        ))}
      </ul>
    </div>
  );
}

function SecurityTab({
  token,
  staff,
  setNotice,
  setError,
}: {
  token: string;
  staff: Staff[];
  setNotice: (s: string) => void;
  setError: (s: string) => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [targetPw, setTargetPw] = useState("");
  const [targetConfirm, setTargetConfirm] = useState("");
  const [targetBusy, setTargetBusy] = useState(false);

  async function changeOwn(e: FormEvent) {
    e.preventDefault();
    setNotice("");
    setError("");
    if (next !== confirm) {
      setError("New password and confirmation do not match");
      return;
    }
    setBusy(true);
    try {
      await changePassword(token, current, next);
      setNotice("Administrator password changed successfully");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Password change failed");
    } finally {
      setBusy(false);
    }
  }

  async function changeOther(e: FormEvent) {
    e.preventDefault();
    setNotice("");
    setError("");
    const target = staff.find((u) => u.id === targetId);
    if (!target) return;
    if (targetPw !== targetConfirm) {
      setError("New password and confirmation do not match");
      return;
    }
    if (targetPw.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    setTargetBusy(true);
    try {
      await adminPost(token, `staff/${target.id}/password`, { new_password: targetPw });
      setNotice(`Password changed for ${target.name}`);
      setTargetId("");
      setTargetPw("");
      setTargetConfirm("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Password change failed");
    } finally {
      setTargetBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <form onSubmit={changeOwn}>
        <h3 className="text-sm font-semibold text-slate-900">Change your password</h3>
        <div className="mt-2 space-y-3">
          <Field label="Current password" required>
            <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </Field>
          <Field label="New password" hint="Use at least 8 characters." required>
            <Input type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
          </Field>
          <Field label="Confirm new password" required>
            <Input type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? "Changing…" : "Change Password"}
          </Button>
        </div>
      </form>
      <form onSubmit={changeOther}>
        <h3 className="text-sm font-semibold text-slate-900">Set any staff password</h3>
        <div className="mt-2 space-y-3">
          <Field label="Staff member" required>
            <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
              <option value="">Select staff</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.email}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="New password" required>
            <Input type="password" autoComplete="new-password" minLength={8} value={targetPw} onChange={(e) => setTargetPw(e.target.value)} required />
          </Field>
          <Field label="Confirm new password" required>
            <Input type="password" autoComplete="new-password" minLength={8} value={targetConfirm} onChange={(e) => setTargetConfirm(e.target.value)} required />
          </Field>
          <Button type="submit" size="sm" disabled={targetBusy || !targetId}>
            {targetBusy ? "Changing…" : "Set Password"}
          </Button>
        </div>
      </form>
    </div>
  );
}
