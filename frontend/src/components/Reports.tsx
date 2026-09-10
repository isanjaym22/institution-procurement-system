import { useEffect, useState } from "react";
import {
  ChartBar,
  CircleNotch,
  DownloadSimple,
  Funnel,
} from "@phosphor-icons/react";
import {
  DEPT_SCOPED_REPORT_ROLES,
  downloadPurchaseReportPdf,
  fetchPurchaseReport,
  listActiveDepartments,
  type Department,
  type PurchaseReportRow,
} from "../lib/api";
import { roleLabel, statusLabel } from "../lib/workflow";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Select } from "./ui/select";

function fyDefaults(): { from: string; to: string } {
  const now = new Date();
  const y = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: `${y}-04-01`, to: now.toISOString().slice(0, 10) };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      {children}
    </label>
  );
}

function formatINR(total?: string | null): string {
  if (total == null || total === "") return "—";
  const n = Number(total);
  return Number.isFinite(n)
    ? `INR ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `INR ${total}`;
}

export default function Reports({ token, role }: { token: string; role: string }) {
  const defaults = fyDefaults();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [deptId, setDeptId] = useState("");
  const [procId, setProcId] = useState("");
  const [category, setCategory] = useState("");
  const [head, setHead] = useState("");
  const [method, setMethod] = useState("");
  const [amc, setAmc] = useState("");
  const [depts, setDepts] = useState<Department[]>([]);
  const [rows, setRows] = useState<PurchaseReportRow[] | null>(null);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deptScoped = DEPT_SCOPED_REPORT_ROLES.includes(role);

  useEffect(() => {
    if (deptScoped) return;
    listActiveDepartments(token).then(setDepts).catch(() => setDepts([]));
  }, [token, deptScoped]);

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    if (!from || !to) {
      setError("Both from and to dates are required.");
      return;
    }
    if (from > to) {
      setError("From date must be on or before the to date.");
      return;
    }
    setLoading(true);
    try {
      const data = await fetchPurchaseReport(token, {
        from_date: from,
        to_date: to,
        department_id: !deptScoped && deptId ? deptId : undefined,
        procurement_id: procId || undefined,
        category: category || undefined,
        head: head || undefined,
        method: method || undefined,
        amc: amc || undefined,
      });
      setRows(data.rows);
      setCount(data.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report failed");
    } finally {
      setLoading(false);
    }
  }

  async function exportPdf() {
    if (!from || !to || from > to) {
      setError("Pick a valid from/to range before exporting.");
      return;
    }
    setExporting(true);
    setError(null);
    try {
      await downloadPurchaseReportPdf(token, {
        from_date: from,
        to_date: to,
        department_id: !deptScoped && deptId ? deptId : undefined,
        procurement_id: procId || undefined,
        category: category || undefined,
        head: head || undefined,
        method: method || undefined,
        amc: amc || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            <ChartBar size={18} /> Purchase report
          </span>
        </CardTitle>
        <CardDescription>
          Date-wise completed purchases by requisition creation date. Terminal rejects are excluded.
          {deptScoped ? ` Showing your department (${roleLabel(role)}).` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={run} className="grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 md:grid-cols-4">
          <Field label="From date *">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
          </Field>
          <Field label="To date *">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
          </Field>
          {!deptScoped && (
            <Field label="Department">
              <Select value={deptId} onChange={(e) => setDeptId(e.target.value)}>
                <option value="">All departments</option>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Procurement ID">
            <Input value={procId} onChange={(e) => setProcId(e.target.value)} placeholder="Contains…" />
          </Field>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All</option>
              <option value="LAB">LAB</option>
              <option value="NON_LAB">NON_LAB</option>
            </Select>
          </Field>
          <Field label="Budget head">
            <Select value={head} onChange={(e) => setHead(e.target.value)}>
              <option value="">All</option>
              <option value="RECURRING">RECURRING</option>
              <option value="FIXED_ASSET">FIXED_ASSET</option>
              <option value="OTHER">OTHER</option>
            </Select>
          </Field>
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">All</option>
              <option value="DIRECT">DIRECT</option>
              <option value="QUOTATION">QUOTATION</option>
              <option value="TENDER">TENDER</option>
              <option value="E_TENDER">E_TENDER</option>
              <option value="OTHER">OTHER</option>
            </Select>
          </Field>
          <Field label="AMC">
            <Select value={amc} onChange={(e) => setAmc(e.target.value)}>
              <option value="">All</option>
              <option value="true">AMC yes</option>
              <option value="false">AMC no</option>
            </Select>
          </Field>
          <div className="flex items-end gap-2 md:col-span-4">
            <Button type="submit" size="sm" disabled={loading}>
              <Funnel size={15} /> {loading ? "Running…" : "Run report"}
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={exporting || rows === null} onClick={exportPdf}>
              <DownloadSimple size={15} /> {exporting ? "Exporting…" : "Export PDF"}
            </Button>
          </div>
        </form>

        {error && <p className="text-sm text-danger">{error}</p>}

        {loading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-zinc-500">
            <CircleNotch size={16} className="animate-spin" /> Running report…
          </p>
        ) : rows === null ? (
          <p className="py-6 text-center text-sm text-zinc-500">
            Pick a date range and run the report to see purchases.
          </p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">
            No purchases found for this range and filters.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-zinc-600">
              {count} purchase{count === 1 ? "" : "s"} from {from} to {to}.
            </p>
            <div className="overflow-x-auto rounded-lg border border-zinc-200">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead>
                  <tr>
                    {["Procurement ID", "Date", "Department", "Requester", "Category", "Head", "Method", "AMC", "Total", "Status"].map((h) => (
                      <th key={h} className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.procurement_id}>
                      <td className="border-b border-zinc-100 px-3 py-2 font-medium">{r.procurement_id}</td>
                      <td className="whitespace-nowrap border-b border-zinc-100 px-3 py-2">{r.date ?? "—"}</td>
                      <td className="border-b border-zinc-100 px-3 py-2">
                        {r.department ?? "—"}
                        {r.department_code ? <span className="text-xs text-zinc-500"> ({r.department_code})</span> : null}
                      </td>
                      <td className="border-b border-zinc-100 px-3 py-2">{r.faculty ?? "—"}</td>
                      <td className="border-b border-zinc-100 px-3 py-2">{r.category ?? "—"}</td>
                      <td className="border-b border-zinc-100 px-3 py-2">{r.head ?? "—"}</td>
                      <td className="border-b border-zinc-100 px-3 py-2">{r.method ?? "—"}</td>
                      <td className="border-b border-zinc-100 px-3 py-2">{r.amc == null ? "—" : r.amc ? "Yes" : "No"}</td>
                      <td className="whitespace-nowrap border-b border-zinc-100 px-3 py-2">{formatINR(r.total)}</td>
                      <td className="border-b border-zinc-100 px-3 py-2">
                        <Badge tone="neutral">{statusLabel(r.status)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
