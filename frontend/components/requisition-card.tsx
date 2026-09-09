import { useState } from "react";
import {
  ArrowUUpLeft,
  Check,
  Checks,
  DownloadSimple,
  FileText,
  ListBullets,
  ShieldCheck,
  X,
} from "@phosphor-icons/react";
import {
  downloadPdf,
  fetchAudit,
  fetchHistory,
  requisitionTotal,
  type AuditEvent,
  type HistoryEvent,
  type Req,
  type User,
} from "@/lib/api";
import { cn, formatDateTime, formatINR } from "@/lib/utils";
import {
  STAGE_GROUP,
  STATUS_TONE,
  statusLabel,
} from "@/lib/workflow";
import { Badge } from "./ui/feedback";
import { Button } from "./ui/button";
import { Field, Input, Textarea } from "./ui/field";
import { Notice } from "./ui/feedback";

export function RequisitionCard({
  r,
  user,
  token,
  onAction,
}: {
  r: Req;
  user: User;
  token: string;
  onAction: (id: string, path: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const [remark, setRemark] = useState("");
  const [head, setHead] = useState("DEMO-BUDGET");
  const [sub, setSub] = useState("");
  const [vendor, setVendor] = useState("");
  const [poNum, setPoNum] = useState("");
  const [invoice, setInvoice] = useState("");
  const [challan, setChallan] = useState("");
  const [serial, setSerial] = useState("");
  const [hist, setHist] = useState<HistoryEvent[] | null>(null);
  const [showHist, setShowHist] = useState(false);
  const [histBusy, setHistBusy] = useState(false);
  const [audit, setAudit] = useState<AuditEvent[] | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [auditBusy, setAuditBusy] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const total = requisitionTotal(r);
  const role = user.role;
  const s = r.status;

  async function run(path: string, body: Record<string, unknown>, needsRemark: boolean) {
    setErr("");
    if (needsRemark && !remark.trim()) {
      setErr("A remark is required to accept, reject, return, approve or forward.");
      return;
    }
    setBusy(true);
    try {
      await onAction(
        r.id,
        path,
        needsRemark ? { ...body, remarks: remark.trim() } : body
      );
      setRemark("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleHist() {
    if (!showHist && !hist) {
      setHistBusy(true);
      try {
        setHist(await fetchHistory(token, r.id));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not load history");
        setHistBusy(false);
        return;
      }
      setHistBusy(false);
    }
    setShowHist(!showHist);
  }

  async function toggleAudit() {
    if (!showAudit && !audit) {
      setAuditBusy(true);
      try {
        setAudit(await fetchAudit(token, r.id));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not load audit trail");
        setAuditBusy(false);
        return;
      }
      setAuditBusy(false);
    }
    setShowAudit(!showAudit);
  }

  async function pdf() {
    setErr("");
    try {
      await downloadPdf(token, r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Download failed");
    }
  }

  const btn = (
    label: string,
    path: string,
    body: Record<string, unknown> = {},
    opts: { variant?: "primary" | "outline" | "danger"; icon?: React.ReactNode; title?: string } = {}
  ) => (
    <Button
      key={label}
      size="sm"
      variant={opts.variant ?? "primary"}
      disabled={busy}
      title={opts.title}
      onClick={() => run(path, body, true)}
    >
      {opts.icon}
      {label}
    </Button>
  );

  return (
    <article className="rise-in rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
        <p className="font-mono text-sm font-semibold text-slate-900">
          {r.procurement_id}
        </p>
        <Badge tone={STATUS_TONE[s] ?? "neutral"}>{statusLabel(s)}</Badge>
      </div>

      <div className="space-y-4 px-5 py-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-slate-500">Department</dt>
            <dd className="font-medium text-slate-900">
              {r.department_name_snapshot} ({r.department_code_snapshot})
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-slate-500">Requester</dt>
            <dd className="text-slate-800">
              {r.faculty_name_snapshot}
              {[r.faculty_employee_id_snapshot, r.faculty_designation_snapshot]
                .filter(Boolean)
                .join(" · ")}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-slate-500">Category</dt>
            <dd className="text-slate-800">
              {r.category === "LAB" ? "Lab" : "Non-Lab"}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-slate-500">Est. total</dt>
            <dd className="font-semibold text-slate-900 tabular-nums">
              {formatINR(total)}
            </dd>
          </div>
        </dl>

        <p className="rounded-lg bg-slate-50 px-3.5 py-2.5 text-sm leading-relaxed text-slate-700">
          {r.justification}
        </p>

        <div className="overflow-x-auto rounded-lg border border-slate-200 nice-scroll">
          <table className="w-full min-w-105 text-left text-[13px]">
            <caption className="sr-only">Requested items</caption>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <th scope="col" className="px-3 py-2 font-medium">Item</th>
                <th scope="col" className="px-3 py-2 font-medium">Specification</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Qty</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Unit price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.items.map((i) => (
                <tr key={i.line_no}>
                  <td className="px-3 py-2 font-medium text-slate-900">{i.item_name}</td>
                  <td className="max-w-60 px-3 py-2 text-slate-600">{i.specification}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{i.quantity}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatINR(Number(i.tentative_unit_price))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(r.hod_remarks || r.principal_remarks) && (
          <div className="space-y-1.5 text-[13px]">
            {r.hod_remarks && (
              <p className="border-l-2 border-brand-300 pl-2.5 text-slate-700">
                <span className="font-semibold text-slate-900">HOD:</span> {r.hod_remarks}
              </p>
            )}
            {r.principal_remarks && (
              <p className="border-l-2 border-brand-300 pl-2.5 text-slate-700">
                <span className="font-semibold text-slate-900">Principal:</span>{" "}
                {r.principal_remarks}
              </p>
            )}
          </div>
        )}

        <ActionBox
          r={r} user={user} busy={busy}
          remark={remark} setRemark={setRemark}
          head={head} setHead={setHead} sub={sub} setSub={setSub}
          vendor={vendor} setVendor={setVendor} poNum={poNum} setPoNum={setPoNum}
          invoice={invoice} setInvoice={setInvoice} challan={challan} setChallan={setChallan}
          serial={serial} setSerial={setSerial}
          run={run} btn={btn} total={total}
        />

        {err && <Notice tone="error">{err}</Notice>}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={toggleHist} disabled={histBusy}>
            <ListBullets size={15} aria-hidden="true" />
            {histBusy ? "Loading…" : showHist ? "Hide remarks history" : "Show remarks history"}
          </Button>
          <Button variant="outline" size="sm" onClick={toggleAudit} disabled={auditBusy}>
            <ShieldCheck size={15} aria-hidden="true" />
            {auditBusy ? "Loading…" : showAudit ? "Hide audit trail" : "Show audit trail"}
          </Button>
          <Button variant="outline" size="sm" onClick={pdf}>
            <DownloadSimple size={15} aria-hidden="true" />
            Download PDF
          </Button>
        </div>

        {showHist && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Remarks history</h3>
            {!hist || hist.length === 0 ? (
              <p className="mt-1 text-[13px] text-slate-500">No history yet.</p>
            ) : (
              <ol className="mt-3 space-y-0">
                {hist.map((h, i) => (
                  <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                    <span aria-hidden="true" className="flex flex-col items-center">
                      <span
                        className={cn(
                          "mt-1 h-2.5 w-2.5 rounded-full ring-4",
                          i === hist.length - 1
                            ? "bg-brand-600 ring-brand-100"
                            : "bg-slate-300 ring-slate-100"
                        )}
                      />
                      {i !== hist.length - 1 && (
                        <span className="w-px flex-1 bg-slate-200" />
                      )}
                    </span>
                    <div className="min-w-0 pb-1">
                      <p className="text-[13px] font-semibold text-slate-900">
                        {h.action}{" "}
                        <span className="font-mono font-normal text-slate-500">
                          {h.from_status || ""}→{h.to_status}
                        </span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {h.actor_role} · {formatDateTime(h.created_at)}
                      </p>
                      {h.remarks && (
                        <p className="mt-1 text-[13px] leading-relaxed text-slate-700">
                          {h.remarks}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
        {showAudit && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Audit trail</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Complete technical record — every action with actor and recorded state change.
            </p>
            {!audit || audit.length === 0 ? (
              <p className="mt-1 text-[13px] text-slate-500">No audit entries yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th scope="col" className="py-1.5 pr-3 font-semibold">Date &amp; time</th>
                      <th scope="col" className="py-1.5 pr-3 font-semibold">Action</th>
                      <th scope="col" className="py-1.5 pr-3 font-semibold">Actor</th>
                      <th scope="col" className="py-1.5 pr-3 font-semibold">State change</th>
                      <th scope="col" className="py-1.5 font-semibold">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((a, i) => (
                      <tr key={i} className="border-b border-slate-100 align-top last:border-0">
                        <td className="whitespace-nowrap py-1.5 pr-3 text-slate-500">
                          {formatDateTime(a.created_at)}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-xs text-slate-700">{a.action}</td>
                        <td className="py-1.5 pr-3 text-slate-700">
                          {a.actor_name || "—"}
                          {a.actor_role && (
                            <span className="block text-xs text-slate-500">{a.actor_role}</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-xs text-slate-500">
                          {String(a.before_data?.status ?? "—")}→{String(a.after_data?.status ?? "—")}
                        </td>
                        <td className="py-1.5 text-slate-700">{a.remarks || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function ActionBox(props: {
  r: Req;
  user: User;
  busy: boolean;
  remark: string;
  setRemark: (v: string) => void;
  head: string; setHead: (v: string) => void;
  sub: string; setSub: (v: string) => void;
  vendor: string; setVendor: (v: string) => void;
  poNum: string; setPoNum: (v: string) => void;
  invoice: string; setInvoice: (v: string) => void;
  challan: string; setChallan: (v: string) => void;
  serial: string; setSerial: (v: string) => void;
  run: (path: string, body: Record<string, unknown>, needsRemark: boolean) => void;
  btn: (label: string, path: string, body?: Record<string, unknown>, opts?: { variant?: "primary" | "outline" | "danger"; icon?: React.ReactNode; title?: string }) => React.ReactNode;
  total: number;
}) {
  const { r, user, busy, remark, setRemark, run, btn, total } = props;
  const role = user.role;
  const s = r.status;

  const submit = role === "DEPARTMENT_USER" && s === "DRAFT";

  const buttons: React.ReactNode[] = [];
  let inputs: React.ReactNode = null;

  if (submit) {
    buttons.push(
      <Button key="submit" size="sm" disabled={busy} onClick={() => run("submit", {}, false)}>
        <Check size={15} aria-hidden="true" /> Submit to HOD
      </Button>
    );
  }
  if (role === "HOD" && s === "SUBMITTED") {
    buttons.push(
      btn("Approve → Principal", "hod/approve", {}, { icon: <Check size={15} aria-hidden="true" /> }),
      btn("Return", "hod/return", {}, { variant: "outline", icon: <ArrowUUpLeft size={15} aria-hidden="true" /> }),
      btn("Reject", "hod/reject", {}, { variant: "danger", icon: <X size={15} aria-hidden="true" /> })
    );
  }
  if (role === "PRINCIPAL" && s === "PRINCIPAL_REVIEW") {
    buttons.push(
      btn("Approve", "principal/approve", {}, {
        icon: <Check size={15} aria-hidden="true" />,
        title: "Below ₹10,000 the department purchases directly; ₹10,000+ goes to the Finance Committee",
      }),
      btn("Return", "principal/return", {}, { variant: "outline", icon: <ArrowUUpLeft size={15} aria-hidden="true" /> }),
      btn("Reject", "principal/reject", {}, { variant: "danger", icon: <X size={15} aria-hidden="true" /> })
    );
  }
  if (role === "FINANCE" && s === "FINANCE_REVIEW") {
    inputs = (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Budget head" id={`head-${r.id}`} required>
          <Input id={`head-${r.id}`} value={props.head} onChange={(e) => props.setHead(e.target.value)} />
        </Field>
        <Field label="Sub-head" id={`sub-${r.id}`} required>
          <Input id={`sub-${r.id}`} value={props.sub} onChange={(e) => props.setSub(e.target.value)} placeholder="e.g. Lab equipment" />
        </Field>
      </div>
    );
    buttons.push(
      btn("Approve Budget", "finance/review", {
        decision: "APPROVE",
        approved_amount: total,
        budget_head: props.head,
        sub_head: props.sub,
      }, { icon: <Checks size={15} aria-hidden="true" /> })
    );
  }
  if (role === "PURCHASE_COMMITTEE" && s === "BUDGET_ALLOCATED") {
    buttons.push(btn("Select Quotation", "procurement/method", {
      method: "QUOTATION", meeting_no: "DEMO-1", rule_reference: "Institution procurement rules",
    }));
  }
  if (role === "PURCHASE_COMMITTEE" && s === "PROCUREMENT_IN_PROGRESS") {
    buttons.push(btn("Select Vendor", "procurement/vendor", {
      vendor_name: "Demo Vendor", contact: "0000000000",
    }));
  }
  if (role === "PURCHASE_COMMITTEE" && s === "VENDOR_SELECTED") {
    buttons.push(btn("Issue PO", "procurement/po", {
      po_number: `PO-${Date.now()}`, total_amount: total,
      warranty_months: 12, amc_required: false, delivery_terms: "30 days",
    }));
  }
  if ((role === "DEPARTMENT_USER" || role === "HOD") && s === "DIRECT_PURCHASE") {
    inputs = (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Vendor name" id={`vendor-${r.id}`} required>
          <Input id={`vendor-${r.id}`} value={props.vendor} onChange={(e) => props.setVendor(e.target.value)} />
        </Field>
        <Field label="PO number" id={`po-${r.id}`} required>
          <Input id={`po-${r.id}`} value={props.poNum} onChange={(e) => props.setPoNum(e.target.value)} />
        </Field>
      </div>
    );
    buttons.push(btn("Record Direct Purchase", "direct-purchase", {
      vendor_name: props.vendor, po_number: props.poNum, total_amount: total,
    }));
  }
  if (role === "STORE_OFFICER" && s === "PO_ISSUED") {
    inputs = (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Invoice number" hint="Optional" id={`inv-${r.id}`}>
          <Input id={`inv-${r.id}`} value={props.invoice} onChange={(e) => props.setInvoice(e.target.value)} />
        </Field>
        <Field label="Challan number" hint="Optional" id={`challan-${r.id}`}>
          <Input id={`challan-${r.id}`} value={props.challan} onChange={(e) => props.setChallan(e.target.value)} />
        </Field>
      </div>
    );
    buttons.push(btn("Record Delivery", "delivery", {
      ...(props.invoice.trim() ? { invoice_number: props.invoice.trim() } : {}),
      ...(props.challan.trim() ? { challan_number: props.challan.trim() } : {}),
    }));
  }
  if ((role === "DEPARTMENT_USER" || role === "HOD") && s === "DELIVERED") {
    buttons.push(btn("Accept Delivery", "acceptance", { decision: "ACCEPT" }, { icon: <Check size={15} aria-hidden="true" /> }));
  }
  if (role === "STORE_OFFICER" && (s === "ACCEPTED" || s === "PARTIALLY_ACCEPTED")) {
    inputs = (
      <Field label="Serial number" hint="Optional" id={`serial-${r.id}`}>
        <Input id={`serial-${r.id}`} value={props.serial} onChange={(e) => props.setSerial(e.target.value)} />
      </Field>
    );
    buttons.push(btn("Update Asset Register", "stock", {
      register_type: "ASSET", asset_id: `AST-${Date.now()}`,
      ...(props.serial.trim() ? { serial_no: props.serial.trim() } : {}),
    }));
  }
  if (role === "BURSAR" && s === "STOCK_UPDATED") {
    buttons.push(btn("Submit Bill", "bill", { invoice_number: `INV-${Date.now()}`, amount: total }));
  }
  if (role === "BURSAR" && s === "BILL_SUBMITTED") {
    buttons.push(btn("Verify Bill", "bill/verify"));
  }
  if (role === "BURSAR" && s === "BILL_VERIFIED") {
    buttons.push(btn("Complete Payment", "payment", {
      payment_reference: `PAY-${Date.now()}`, amount: total,
    }));
  }
  if (role === "BURSAR" && s === "PAYMENT_COMPLETED") {
    buttons.push(btn("Generate UC", "uc", { certificate_no: `UC-${Date.now()}` }));
  }
  if ((role === "PRINCIPAL" || role === "BURSAR") && s === "UC_GENERATED") {
    buttons.push(btn("Close Procurement File", "close"));
  }

  if (buttons.length === 0) return null;

  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold tracking-wide text-brand-800 uppercase">
        <FileText size={14} aria-hidden="true" />
        Your action — {STAGE_GROUP[s] ?? statusLabel(s)}
      </h3>
      <div className="mt-3 space-y-3">
        {inputs}
        {!submit && (
          <Field
            label="Remark"
            hint="Required — it stays on the record and is visible to everyone downstream."
            id={`remark-${r.id}`}
            required
          >
            <Textarea
              id={`remark-${r.id}`}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="Write why you are approving, returning or rejecting…"
            />
          </Field>
        )}
        <div className="flex flex-wrap gap-2">{buttons}</div>
      </div>
    </div>
  );
}
