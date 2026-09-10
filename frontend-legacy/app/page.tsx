"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BellRinging,
  Funnel,
  Tray,
} from "@phosphor-icons/react";
import {
  fetchMe,
  listDepartments,
  listRequisitions,
  runAction,
  type Department,
  type Req,
  type User,
} from "@/lib/api";
import { canAct, roleLabel, statusLabel } from "@/lib/workflow";
import { SiteHeader } from "@/components/site-header";
import { LoginCard } from "@/components/login-card";
import { TrackHint, TrackPanel } from "@/components/track-panel";
import { RequisitionCard } from "@/components/requisition-card";
import { NewRequisition } from "@/components/new-requisition";
import { AdminPanel } from "@/components/admin-panel";
import { Card, CardBody } from "@/components/ui/card";
import { Notice } from "@/components/ui/feedback";
import { Field, Select } from "@/components/ui/field";

export default function Home() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [filter, setFilter] = useState("ALL");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (t?: string, u?: User | null) => {
      const tk = t || token || localStorage.getItem("token") || "";
      const cu = u || user;
      if (!tk || !cu) return;
      try {
        setReqs(await listRequisitions(tk, cu.role));
        if (cu.role === "PRINCIPAL") {
          setDepartments(await listDepartments(tk));
        }
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Could not load requisitions");
      }
    },
    [token, user]
  );

  useEffect(() => {
    const tk = localStorage.getItem("token");
    if (!tk) {
      setLoading(false);
      return;
    }
    fetchMe(tk)
      .then((u) => {
        setToken(tk);
        setUser(u);
        return load(tk, u);
      })
      .catch(() => localStorage.removeItem("token"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function logout() {
    localStorage.removeItem("token");
    location.reload();
  }

  async function act(id: string, path: string, body: Record<string, unknown>) {
    await runAction(token, id, path, body);
    setMsg("Action completed");
    await load();
  }

  if (loading) {
    return (
      <div className="min-h-screen">
        <SiteHeader user={null} />
        <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <p className="text-sm text-slate-500" role="status">Loading…</p>
        </main>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen">
        <SiteHeader user={null} />
        <main className="mx-auto max-w-6xl space-y-5 px-4 py-8 sm:px-6">
          <div className="max-w-2xl">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Paperless procurement, from request to closure
            </h1>
            <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">
              Raise requisitions, route them through HOD, Principal and
              committee approvals, and follow every file to payment and
              closure — with a written remark on each step.
            </p>
          </div>
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
            <LoginCard
              onLoggedIn={(t, u) => {
                setToken(t);
                setUser(u);
                setMsg("");
                load(t, u);
              }}
            />
            <div className="space-y-5">
              <TrackPanel />
              <TrackHint />
            </div>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const visible = reqs.filter(
    (r) => user.role !== "PRINCIPAL" || filter === "ALL" || r.department_id === filter
  );
  const actionable = visible.filter((r) => canAct(user, r)).length;
  const queueTitle =
    user.role === "PRINCIPAL"
      ? "Principal Review Queue"
      : visible.length > 0
        ? `${statusLabel(visible[0].status)} Queue`
        : "Procurement Queue";

  return (
    <div className="min-h-screen">
      <SiteHeader user={user} onLogout={logout} />
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        {msg && (
          <Notice tone={msg === "Action completed" ? "success" : "info"} aria-live="polite">
            {msg}
          </Notice>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[13px] font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
            <Tray size={15} className="text-slate-500" aria-hidden="true" />
            {visible.length} in queue
          </span>
          {actionable > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-[13px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
              <BellRinging size={15} aria-hidden="true" />
              {actionable} need{actionable === 1 ? "s" : ""} your action
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[13px] text-slate-500 ring-1 ring-inset ring-slate-200">
            Signed in as {roleLabel(user.role)}
          </span>
        </div>

        {user.role === "DEPARTMENT_USER" && (
          <NewRequisition token={token} user={user} onCreated={() => load()} />
        )}
        {user.role === "ADMIN" && <AdminPanel token={token} />}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              {queueTitle}
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {user.role === "HOD"
                ? "Requests from your department awaiting your decision."
                : user.role === "PRINCIPAL"
                  ? "Requests escalated for principal approval."
                  : "Requisitions at your stage of the workflow."}
            </p>
          </div>
          {user.role === "PRINCIPAL" && (
            <Field label="Department" id="dept-filter" className="w-full sm:w-64">
              <Select
                id="dept-filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="ALL">All Departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} — {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        {visible.length === 0 ? (
          <Card>
            <CardBody className="flex flex-col items-center py-12 text-center">
              <Funnel size={28} className="text-slate-300" aria-hidden="true" />
              <p className="mt-2 font-medium text-slate-800">Nothing here right now</p>
              <p className="mt-0.5 max-w-sm text-sm text-slate-500">
                There are no requisitions currently in this queue. New requests
                will appear here when they reach your stage.
              </p>
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-4">
            {visible.map((r) => (
              <RequisitionCard
                key={r.id}
                r={r}
                user={user}
                token={token}
                onAction={act}
              />
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-5 text-[13px] text-slate-500 sm:px-6">
        Institution Procurement Management — internal administrative system.
      </div>
    </footer>
  );
}
