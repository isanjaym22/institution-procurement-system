import { useState, type FormEvent } from "react";
import {
  CheckCircle,
  Circle,
  ClockCounterClockwise,
  MagnifyingGlass,
  MapPin,
  PlayCircle,
} from "@phosphor-icons/react";
import { trackProcurement, type TrackResult } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { Card, CardBody, CardDescription, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Field, Input } from "./ui/field";
import { Notice } from "./ui/feedback";
import { cn } from "@/lib/utils";

function ChecklistIcon({ state }: { state: string }) {
  if (state === "done")
    return (
      <CheckCircle size={18} weight="fill" className="shrink-0 text-emerald-600" aria-hidden="true" />
    );
  if (state === "current")
    return (
      <PlayCircle size={18} weight="fill" className="shrink-0 text-brand-700" aria-hidden="true" />
    );
  return (
    <Circle size={18} className="shrink-0 text-slate-300" aria-hidden="true" />
  );
}

export function TrackPanel() {
  const [pid, setPid] = useState("");
  const [res, setRes] = useState<TrackResult | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function search(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setRes(null);
    if (!pid.trim()) {
      setErr("Please enter a Procurement ID.");
      return;
    }
    setBusy(true);
    try {
      setRes(await trackProcurement(pid));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="flex items-center gap-2">
          <MagnifyingGlass size={20} className="text-brand-700" aria-hidden="true" />
          <CardTitle>Track Procurement</CardTitle>
        </div>
        <CardDescription>
          Enter your Procurement ID to see its current status. No login required.
        </CardDescription>
        <form onSubmit={search} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <label htmlFor="track-id" className="sr-only">
            Procurement ID
          </label>
          <Input
            id="track-id"
            value={pid}
            onChange={(e) => setPid(e.target.value)}
            placeholder="e.g. PROC/2025-26/CS/00001"
            autoComplete="off"
            className="font-mono sm:flex-1"
          />
          <Button type="submit" disabled={busy} className="sm:w-auto">
            {busy ? "Searching…" : "Search"}
          </Button>
        </form>
        {err && (
          <Notice tone="error" className="mt-3">
            {err}
          </Notice>
        )}
        {res && (
          <div
            className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
            aria-live="polite"
          >
            <p className="font-mono text-sm font-semibold text-slate-900">
              {res.procurement_id}
            </p>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-slate-500">Stage</dt>
                <dd className="font-medium text-slate-900">{res.stage_label}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-slate-500">Currently with</dt>
                <dd className="font-medium text-slate-900">{res.owner_role}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-slate-500">Last updated</dt>
                <dd className="text-slate-700">{formatDateTime(res.last_updated)}</dd>
              </div>
            </dl>
            <ol className="mt-3 space-y-1.5 border-t border-slate-200 pt-3">
              {res.checklist.map((s) => (
                <li
                  key={s.key}
                  className={cn(
                    "flex items-center gap-2 text-[13px]",
                    s.state === "current"
                      ? "font-semibold text-brand-800"
                      : s.state === "done"
                        ? "text-slate-600"
                        : "text-slate-400"
                  )}
                  aria-current={s.state === "current" ? "step" : undefined}
                >
                  <ChecklistIcon state={s.state} />
                  {s.label}
                </li>
              ))}
            </ol>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function TrackHint() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm text-brand-900">
      <MapPin size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-semibold">Looking for a requisition?</span>{" "}
        Anyone with a Procurement ID can follow its progress — sign in above
        only if you need to take action on it.
      </p>
    </div>
  );
}

export function HistoryHint() {
  return (
    <p className="flex items-center gap-1.5 text-xs text-slate-500">
      <ClockCounterClockwise size={14} aria-hidden="true" />
      Every action records who did it, when, and why.
    </p>
  );
}
