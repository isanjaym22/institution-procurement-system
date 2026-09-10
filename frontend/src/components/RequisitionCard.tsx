import { useState } from "react";
import {
  Bank,
  Check,
  ClockCounterClockwise,
  DownloadSimple,
  FileText,
  ListChecks,
  PaperPlaneTilt,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import {
  bursarRecord,
  completeAcceptance,
  downloadPaymentDoc,
  downloadPdf,
  downloadWorkOrder,
  fetchAudit,
  fetchHistory,
  financeForward,
  hodDecision,
  principalDecision,
  purchaseMethod,
  submitReq,
  uploadWorkOrder,
  type AuditEvent,
  type HistoryEvent,
  type Req,
  type User,
} from "../lib/api";
import {
  amountGateHint,
  canAct,
  estimateTotal,
  formatINR,
  statusLabel,
  statusTone,
} from "../lib/workflow";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { Textarea } from "./ui/textarea";

export interface CardProps {
  req: Req;
  user: User;
  token: string;
  onChanged: (r: Req) => void;
}

function fmtDate(s?: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function amcText(v?: boolean | string | null): string {
  if (v === true || v === "true" || v === "YES") return "Yes";
  if (v === false || v === "false" || v === "NO") return "No";
  return "—";
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="truncate text-sm font-medium text-zinc-900">{value}</p>
    </div>
  );
}

function mustRemarks(remarks: string): string | null {
  return remarks.trim() ? null : "Remarks are required.";
}

// Shared runner: busy flag + inline server error + push updated Req up.
function useRunner(onChanged: (r: Req) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<Req>) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

function RemarksBox({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-zinc-700">
        Remarks <span className="text-danger">*</span>
      </label>
      <Textarea
        id={id}
        rows={2}
        placeholder="Decision remarks (mandatory)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function SubmitForm({ req, token, onChanged }: CardProps) {
  const { busy, error, run } = useRunner(onChanged);
  const direct = (req.origin ?? "DEPARTMENT") !== "DEPARTMENT";
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600">
        {direct
          ? "Submitting routes this request straight to Principal review (HOD step skipped for HOD/Office-originated requests)."
          : "Submitting routes this request to HOD review."}
      </p>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button disabled={busy} onClick={() => void run(() => submitReq(token, req.id))}>
        <PaperPlaneTilt size={16} /> {busy ? "Submitting…" : "Submit"}
      </Button>
    </div>
  );
}

function HodForm({ req, token, onChanged, user }: CardProps) {
  const { busy, error, setError, run } = useRunner(onChanged);
  const [remarks, setRemarks] = useState("");
  void user;
  function decide(approve: boolean) {
    const err = mustRemarks(remarks);
    if (err) {
      setError(err);
      return;
    }
    void run(() => hodDecision(token, req.id, approve, remarks.trim()));
  }
  return (
    <div className="space-y-3">
      <RemarksBox id={`hod-rm-${req.id}`} value={remarks} onChange={setRemarks} />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => decide(true)}>
          <Check size={16} /> {busy ? "…" : "Approve"}
        </Button>
        <Button variant="destructive" disabled={busy} onClick={() => decide(false)}>
          <X size={16} /> {busy ? "…" : "Reject"}
        </Button>
      </div>
    </div>
  );
}

function PrincipalForm({ req, token, onChanged }: CardProps) {
  const { busy, error, setError, run } = useRunner(onChanged);
  const [remarks, setRemarks] = useState("");
  function decide(approve: boolean) {
    const err = mustRemarks(remarks);
    if (err) {
      setError(err);
      return;
    }
    void run(() => principalDecision(token, req.id, approve, remarks.trim()));
  }
  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
        {amountGateHint(estimateTotal(req))}
      </p>
      <RemarksBox id={`pr-rm-${req.id}`} value={remarks} onChange={setRemarks} />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => decide(true)}>
          <Check size={16} /> {busy ? "…" : "Approve"}
        </Button>
        <Button variant="destructive" disabled={busy} onClick={() => decide(false)}>
          <X size={16} /> {busy ? "…" : "Reject"}
        </Button>
      </div>
    </div>
  );
}

function FinanceForm({ req, token, onChanged }: CardProps) {
  const { busy, error, setError, run } = useRunner(onChanged);
  const [head, setHead] = useState("RECURRING");
  const [headOther, setHeadOther] = useState("");
  const [subHead, setSubHead] = useState("");
  const [amount, setAmount] = useState("");
  const [amountRemark, setAmountRemark] = useState("");
  const [amcRec, setAmcRec] = useState("");
  const [remarks, setRemarks] = useState("");
  function forward() {
    if (!subHead.trim()) {
      setError("Sub-head is required.");
      return;
    }
    if (head === "OTHER" && !headOther.trim()) {
      setError("Custom head text is required when head is Other.");
      return;
    }
    if (!amcRec) {
      setError("AMC recommendation (Yes/No) is required.");
      return;
    }
    const err = mustRemarks(remarks);
    if (err) {
      setError(err);
      return;
    }
    void run(() =>
      financeForward(token, req.id, {
        budget_head: head,
        head_other_text: head === "OTHER" ? headOther.trim() : undefined,
        sub_head: subHead.trim(),
        approved_amount: amount.trim() ? Number(amount) : undefined,
        amount_remark: amountRemark.trim() || undefined,
        amc_recommendation: amcRec === "yes",
        remarks: remarks.trim(),
      }),
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`fin-head-${req.id}`} className="text-sm font-medium text-zinc-700">Budget head <span className="text-danger">*</span></label>
          <Select id={`fin-head-${req.id}`} value={head} onChange={(e) => setHead(e.target.value)}>
            <option value="RECURRING">Recurring</option>
            <option value="FIXED_ASSET">Fixed Asset</option>
            <option value="OTHER">Other</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`fin-sub-${req.id}`} className="text-sm font-medium text-zinc-700">Sub-head <span className="text-danger">*</span></label>
          <Input id={`fin-sub-${req.id}`} placeholder="e.g. Lab consumables" value={subHead} onChange={(e) => setSubHead(e.target.value)} />
        </div>
      </div>
      {head === "OTHER" && (
        <div className="space-y-1.5">
          <label htmlFor={`fin-hother-${req.id}`} className="text-sm font-medium text-zinc-700">Custom head <span className="text-danger">*</span></label>
          <Input id={`fin-hother-${req.id}`} value={headOther} onChange={(e) => setHeadOther(e.target.value)} />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`fin-amt-${req.id}`} className="text-sm font-medium text-zinc-700">Indicative amount (₹, optional)</label>
          <Input id={`fin-amt-${req.id}`} type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`fin-amtrm-${req.id}`} className="text-sm font-medium text-zinc-700">Amount remark (optional)</label>
          <Input id={`fin-amtrm-${req.id}`} value={amountRemark} onChange={(e) => setAmountRemark(e.target.value)} />
        </div>
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium text-zinc-700">AMC recommendation <span className="text-danger">*</span></legend>
        <div className="flex gap-4">
          {(["yes", "no"] as const).map((v) => (
            <label key={v} className="inline-flex items-center gap-1.5 text-sm text-zinc-700">
              <input type="radio" name={`fin-amc-${req.id}`} checked={amcRec === v} onChange={() => setAmcRec(v)} className="accent-[#1e3a5f]" />
              {v === "yes" ? "Yes" : "No"}
            </label>
          ))}
        </div>
      </fieldset>
      <RemarksBox id={`fin-rm-${req.id}`} value={remarks} onChange={setRemarks} />
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button disabled={busy} onClick={forward}>
        <Check size={16} /> {busy ? "Forwarding…" : "Forward to purchase"}
      </Button>
    </div>
  );
}

function MethodForm({ req, token, onChanged }: CardProps) {
  const { busy, error, setError, run } = useRunner(onChanged);
  const [method, setMethod] = useState("DIRECT");
  const [methodOther, setMethodOther] = useState("");
  const [meetingNo, setMeetingNo] = useState("");
  const [ruleRef, setRuleRef] = useState("");
  const [remarks, setRemarks] = useState("");
  function decide() {
    if (method === "OTHER" && !methodOther.trim()) {
      setError("Custom method text is required when method is Other.");
      return;
    }
    const err = mustRemarks(remarks);
    if (err) {
      setError(err);
      return;
    }
    void run(() =>
      purchaseMethod(token, req.id, {
        method,
        method_other_text: method === "OTHER" ? methodOther.trim() : undefined,
        meeting_no: meetingNo.trim() || undefined,
        rule_reference: ruleRef.trim() || undefined,
        remarks: remarks.trim(),
      }),
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`mtd-m-${req.id}`} className="text-sm font-medium text-zinc-700">Procurement method <span className="text-danger">*</span></label>
          <Select id={`mtd-m-${req.id}`} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="DIRECT">Direct</option>
            <option value="QUOTATION">Quotation</option>
            <option value="TENDER">Tender</option>
            <option value="E_TENDER">E-Tender</option>
            <option value="OTHER">Other</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`mtd-mt-${req.id}`} className="text-sm font-medium text-zinc-700">Meeting no. (optional)</label>
          <Input id={`mtd-mt-${req.id}`} value={meetingNo} onChange={(e) => setMeetingNo(e.target.value)} />
        </div>
      </div>
      {method === "OTHER" && (
        <div className="space-y-1.5">
          <label htmlFor={`mtd-mo-${req.id}`} className="text-sm font-medium text-zinc-700">Custom method <span className="text-danger">*</span></label>
          <Input id={`mtd-mo-${req.id}`} value={methodOther} onChange={(e) => setMethodOther(e.target.value)} />
        </div>
      )}
      <div className="space-y-1.5">
        <label htmlFor={`mtd-rr-${req.id}`} className="text-sm font-medium text-zinc-700">Rule reference (optional)</label>
        <Input id={`mtd-rr-${req.id}`} value={ruleRef} onChange={(e) => setRuleRef(e.target.value)} />
      </div>
      <RemarksBox id={`mtd-rm-${req.id}`} value={remarks} onChange={setRemarks} />
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button disabled={busy} onClick={decide}>
        <Check size={16} /> {busy ? "Saving…" : "Decide method"}
      </Button>
    </div>
  );
}

function WoForm({ req, token, onChanged }: CardProps) {
  const { busy, error, setError, run } = useRunner(onChanged);
  const [file, setFile] = useState<File | null>(null);
  function upload() {
    if (!file) {
      setError("Select a PDF file to upload.");
      return;
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are accepted.");
      return;
    }
    void run(() => uploadWorkOrder(token, req.id, file));
  }
  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
        Work Order upload is a second step after the method decision — complete it in this or a later
        Purchase Committee / ADMIN session. PDF only, max 10 MB (enforced server-side).
      </p>
      <div className="space-y-1.5">
        <label htmlFor={`wo-f-${req.id}`} className="text-sm font-medium text-zinc-700">Work Order PDF <span className="text-danger">*</span></label>
        <Input id={`wo-f-${req.id}`} type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button disabled={busy} onClick={upload}>
        <UploadSimple size={16} /> {busy ? "Uploading…" : "Upload Work Order"}
      </Button>
    </div>
  );
}

function AcceptanceForm({ req, token, onChanged }: CardProps) {
  const { busy, error, run } = useRunner(onChanged);
  const [f, setF] = useState({
    brand_name: "",
    specification: "",
    manufacturing_date: "",
    expiry_date: "",
    quantity_received: "",
    item_asset_id: "",
    acceptance_date: "",
    accepted_by: "",
    remarks: "",
  });
  function set(k: keyof typeof f, v: string) {
    setF((prev) => ({ ...prev, [k]: v }));
  }
  function complete() {
    const body: Record<string, unknown> = {};
    if (f.brand_name.trim()) body.brand_name = f.brand_name.trim();
    if (f.specification.trim()) body.specification = f.specification.trim();
    if (f.manufacturing_date) body.manufacturing_date = f.manufacturing_date;
    if (f.expiry_date) body.expiry_date = f.expiry_date;
    if (f.quantity_received.trim()) body.quantity_received = Number(f.quantity_received);
    if (f.item_asset_id.trim()) body.item_asset_id = f.item_asset_id.trim();
    if (f.acceptance_date) body.acceptance_date = f.acceptance_date;
    if (f.accepted_by.trim()) body.accepted_by = f.accepted_by.trim();
    if (f.remarks.trim()) body.remarks = f.remarks.trim();
    void run(() => completeAcceptance(token, req.id, body));
  }
  const input = (k: keyof typeof f, label: string, type = "text", span = false) => (
    <div className={`space-y-1.5${span ? " sm:col-span-2" : ""}`}>
      <label htmlFor={`acc-${k}-${req.id}`} className="text-sm font-medium text-zinc-700">{label}</label>
      <Input id={`acc-${k}-${req.id}`} type={type} min={type === "number" ? 1 : undefined} step={type === "number" ? 1 : undefined} value={f[k]} onChange={(e) => set(k, e.target.value)} />
    </div>
  );
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">All fields optional — whatever is recorded appears on the requisition PDF.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {input("brand_name", "Brand name")}
        {input("specification", "Specification")}
        {input("manufacturing_date", "Manufacturing date", "date")}
        {input("expiry_date", "Expiry date", "date")}
        {input("quantity_received", "Quantity received", "number")}
        {input("item_asset_id", "Item / asset ID")}
        {input("acceptance_date", "Acceptance date", "date")}
        {input("accepted_by", "Accepted by")}
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`acc-remarks-${req.id}`} className="text-sm font-medium text-zinc-700">Remarks (optional)</label>
        <Textarea id={`acc-remarks-${req.id}`} rows={2} value={f.remarks} onChange={(e) => set("remarks", e.target.value)} />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button disabled={busy} onClick={complete}>
        <Check size={16} /> {busy ? "Completing…" : "Complete acceptance"}
      </Button>
    </div>
  );
}

function BursarForm({ req, token, onChanged }: CardProps) {
  const { busy, error, run } = useRunner(onChanged);
  const [f, setF] = useState({
    cheque_number: "",
    transaction_number: "",
    payment_reference: "",
    amount: "",
    payment_date: "",
    amc_final: "",
    remarks: "",
  });
  const [file, setFile] = useState<File | null>(null);
  function set(k: keyof typeof f, v: string) {
    setF((prev) => ({ ...prev, [k]: v }));
  }
  function record() {
    if (file && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      // Reuse runner error path via a rejected promise.
      void run(() => Promise.reject(new Error("Only PDF files are accepted.")));
      return;
    }
    void run(() => bursarRecord(token, req.id, { ...f }, file));
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">All fields optional — this is the final step and completes the requisition.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`bur-ch-${req.id}`} className="text-sm font-medium text-zinc-700">Cheque number</label>
          <Input id={`bur-ch-${req.id}`} value={f.cheque_number} onChange={(e) => set("cheque_number", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`bur-tn-${req.id}`} className="text-sm font-medium text-zinc-700">Transaction number</label>
          <Input id={`bur-tn-${req.id}`} value={f.transaction_number} onChange={(e) => set("transaction_number", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`bur-pr-${req.id}`} className="text-sm font-medium text-zinc-700">Payment reference</label>
          <Input id={`bur-pr-${req.id}`} value={f.payment_reference} onChange={(e) => set("payment_reference", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`bur-am-${req.id}`} className="text-sm font-medium text-zinc-700">Amount (₹)</label>
          <Input id={`bur-am-${req.id}`} type="number" min={0} step="0.01" value={f.amount} onChange={(e) => set("amount", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`bur-pd-${req.id}`} className="text-sm font-medium text-zinc-700">Payment date</label>
          <Input id={`bur-pd-${req.id}`} type="date" value={f.payment_date} onChange={(e) => set("payment_date", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`bur-af-${req.id}`} className="text-sm font-medium text-zinc-700">AMC final</label>
          <Select id={`bur-af-${req.id}`} value={f.amc_final} onChange={(e) => set("amc_final", e.target.value)}>
            <option value="">Unspecified</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`bur-rm-${req.id}`} className="text-sm font-medium text-zinc-700">Remarks (optional)</label>
        <Textarea id={`bur-rm-${req.id}`} rows={2} value={f.remarks} onChange={(e) => set("remarks", e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`bur-f-${req.id}`} className="text-sm font-medium text-zinc-700">Supporting document (PDF, optional)</label>
        <Input id={`bur-f-${req.id}`} type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button disabled={busy} onClick={record}>
        <Bank size={16} /> {busy ? "Recording…" : "Record payment"}
      </Button>
    </div>
  );
}

export function ActionBox(props: CardProps) {
  const { req, user } = props;
  if (!canAct(user, req)) return null;
  let title = "";
  let body: React.ReactNode = null;
  switch (req.status) {
    case "DRAFT":
      title = "Submit requisition";
      body = <SubmitForm {...props} />;
      break;
    case "SUBMITTED":
      title = "HOD decision";
      body = <HodForm {...props} />;
      break;
    case "PRINCIPAL_REVIEW":
      title = "Principal decision";
      body = <PrincipalForm {...props} />;
      break;
    case "FINANCE_REVIEW":
      title = "Finance forward";
      body = <FinanceForm {...props} />;
      break;
    case "METHOD_PENDING":
      title = "Purchase method";
      body = <MethodForm {...props} />;
      break;
    case "WO_PENDING":
      title = "Work Order upload";
      body = <WoForm {...props} />;
      break;
    case "ACCEPTANCE":
      title = "Acceptance & stock";
      body = <AcceptanceForm {...props} />;
      break;
    case "BURSAR_REVIEW":
      title = "Payment recording";
      body = <BursarForm {...props} />;
      break;
    default:
      return null;
  }
  return (
    <div className="rounded-lg border border-accent/20 bg-accent/[0.03] p-4">
      <p className="mb-3 text-sm font-semibold text-zinc-900">{title}</p>
      {body}
    </div>
  );
}

const WO_VISIBLE = new Set(["ACCEPTANCE", "BURSAR_REVIEW", "COMPLETED"]);
const PAY_VISIBLE = new Set(["BURSAR_REVIEW", "COMPLETED"]);

export default function RequisitionCard({ req, user, token, onChanged }: CardProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEvent[] | null>(null);
  const [histBusy, setHistBusy] = useState(false);
  const [histError, setHistError] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [audit, setAudit] = useState<AuditEvent[] | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [dlBusy, setDlBusy] = useState<string | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);

  async function toggleHistory() {
    setShowHistory((v) => !v);
    if (history || histBusy) return;
    setHistBusy(true);
    setHistError(null);
    try {
      setHistory(await fetchHistory(token, req.id));
    } catch (e) {
      setHistError(e instanceof Error ? e.message : "Could not load history");
    } finally {
      setHistBusy(false);
    }
  }

  async function toggleAudit() {
    setShowAudit((v) => !v);
    if (audit || auditBusy) return;
    setAuditBusy(true);
    setAuditError(null);
    try {
      setAudit(await fetchAudit(token, req.id));
    } catch (e) {
      setAuditError(e instanceof Error ? e.message : "Could not load audit trail");
    } finally {
      setAuditBusy(false);
    }
  }

  async function download(kind: "pdf" | "wo" | "pay") {
    setDlBusy(kind);
    setDlError(null);
    try {
      if (kind === "pdf") await downloadPdf(token, req.id, req.procurement_id);
      else if (kind === "wo") await downloadWorkOrder(token, req.id, req.procurement_id);
      else await downloadPaymentDoc(token, req.id, req.procurement_id);
    } catch {
      setDlError(kind === "pdf" ? "Requisition PDF is not available yet." : kind === "wo" ? "Work Order is not available yet." : "Payment document was not attached.");
    } finally {
      setDlBusy(null);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-900">{req.procurement_id}</p>
            <p className="text-xs text-zinc-500">
              {(req.department_name_snapshot ?? req.department_code_snapshot ?? "—")}{" · "}
              {req.category}{" · "}
              {fmtDate(req.created_at)}
            </p>
          </div>
          <Badge tone={statusTone(req.status)}>{statusLabel(req.status)}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Meta label="Requester" value={req.faculty_name_snapshot ?? "—"} />
          <Meta label="Designation" value={req.faculty_designation_snapshot ?? "—"} />
          <Meta label="AMC preference" value={amcText(req.amc_preference)} />
          <Meta label="Est. total" value={formatINR(estimateTotal(req))} />
        </div>

        <p className="text-sm text-zinc-700">{req.justification}</p>

        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr className="bg-zinc-50 text-xs text-zinc-500">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Specification</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Unit price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {req.items.map((it) => (
                <tr key={it.line_no}>
                  <td className="px-3 py-2 text-zinc-500">{it.line_no}</td>
                  <td className="px-3 py-2 font-medium text-zinc-900">{it.item_name}</td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-zinc-600" title={it.specification}>{it.specification}</td>
                  <td className="px-3 py-2 text-right text-zinc-700">{it.quantity}</td>
                  <td className="px-3 py-2 text-right text-zinc-700">{formatINR(it.tentative_unit_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {req.hod_remarks && (
          <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            <strong className="font-semibold">HOD remarks:</strong> {req.hod_remarks}
          </p>
        )}
        {req.principal_remarks && (
          <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            <strong className="font-semibold">Principal remarks:</strong> {req.principal_remarks}
          </p>
        )}

        <ActionBox req={req} user={user} token={token} onChanged={onChanged} />

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={dlBusy === "pdf"} onClick={() => void download("pdf")}>
            <FileText size={16} /> {dlBusy === "pdf" ? "…" : "Requisition PDF"}
          </Button>
          {WO_VISIBLE.has(req.status) && (
            <Button variant="secondary" size="sm" disabled={dlBusy === "wo"} onClick={() => void download("wo")}>
              <DownloadSimple size={16} /> {dlBusy === "wo" ? "…" : "Work Order"}
            </Button>
          )}
          {PAY_VISIBLE.has(req.status) && (
            <Button variant="secondary" size="sm" disabled={dlBusy === "pay"} onClick={() => void download("pay")}>
              <DownloadSimple size={16} /> {dlBusy === "pay" ? "…" : "Payment document"}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => void toggleHistory()}>
            <ClockCounterClockwise size={16} /> {showHistory ? "Hide history" : "History"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void toggleAudit()}>
            <ListChecks size={16} /> {showAudit ? "Hide audit" : "Audit trail"}
          </Button>
        </div>
        {dlError && <p className="text-sm text-danger">{dlError}</p>}

        {showHistory && (
          <div className="space-y-2">
            {histBusy && <p className="text-sm text-zinc-500">Loading history…</p>}
            {histError && <p className="text-sm text-danger">{histError}</p>}
            {history && history.length === 0 && <p className="text-sm text-zinc-500">No history yet.</p>}
            {history && history.length > 0 && (
              <ol className="space-y-2 border-l-2 border-zinc-200 pl-4">
                {history.map((h, i) => (
                  <li key={i} className="text-xs text-zinc-600">
                    <p className="font-medium text-zinc-900">
                      {h.action}{" "}
                      <span className="font-normal text-zinc-500">
                        {h.from_status ? `${h.from_status} → ` : ""}{h.to_status}
                      </span>
                    </p>
                    <p>{[h.actor_role, fmtDate(h.created_at)].filter((x) => x && x !== "—").join(" · ")}</p>
                    {h.remarks && <p className="italic">“{h.remarks}”</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {showAudit && (
          <div className="space-y-2">
            {auditBusy && <p className="text-sm text-zinc-500">Loading audit trail…</p>}
            {auditError && <p className="text-sm text-danger">{auditError}</p>}
            {audit && audit.length === 0 && <p className="text-sm text-zinc-500">No audit entries yet.</p>}
            {audit && audit.length > 0 && (
              <ul className="space-y-2">
                {audit.map((a, i) => (
                  <li key={i} className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                    <p className="font-medium text-zinc-900">{a.action}</p>
                    <p>{[a.actor_name, a.actor_role, fmtDate(a.created_at)].filter((x) => x && x !== "—").join(" · ")}</p>
                    {a.remarks && <p className="italic">“{a.remarks}”</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
