import { useCallback, useEffect, useState } from "react";
import {
  ArrowClockwise,
  CheckCircle,
  Circle,
  LockKey,
  MagnifyingGlass,
  Package,
  SignOut,
} from "@phosphor-icons/react";
import {
  fetchMe,
  friendlyError,
  getToken,
  listReqs,
  login,
  REPORT_VIEW_ROLES,
  setToken,
  trackProcurement,
  type Req,
  type TrackResult,
  type User,
} from "./lib/api";
import {
  canAct,
  canCreate,
  canSeeAdminPanel,
  roleLabel,
  statusLabel,
  statusTone,
} from "./lib/workflow";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import { Input } from "./components/ui/input";
// Mount points for feature screens (workflow agent owns NewRequisition/RequisitionCard;
// admin+reports agent owns AdminPanel/Reports — do not create those files here).
import AdminPanel from "./components/AdminPanel";
import Reports from "./components/Reports";
import NewRequisition from "./components/NewRequisition";
import RequisitionCard from "./components/RequisitionCard";

type View = "queue" | "admin" | "reports";

function ChecklistIcon({ state }: { state: string }) {
  if (state === "done") return <CheckCircle size={16} className="shrink-0 text-success" />;
  if (state === "current")
    return <Circle size={16} weight="fill" className="shrink-0 text-accent" />;
  return <Circle size={16} className="shrink-0 text-zinc-300" />;
}

function TrackPanel() {
  const [trackId, setTrackId] = useState("");
  const [result, setResult] = useState<TrackResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);

  async function handleTrack(e: React.FormEvent) {
    e.preventDefault();
    if (!trackId.trim()) return;
    setTracking(true);
    setError(null);
    setResult(null);
    try {
      setResult(await trackProcurement(trackId));
    } catch {
      setError("Invalid Procurement ID");
    } finally {
      setTracking(false);
    }
  }

  return (
    <div>
      <form onSubmit={handleTrack} className="flex gap-2">
        <Input
          placeholder="e.g. PROC/2026-27/CS/00001"
          value={trackId}
          onChange={(e) => setTrackId(e.target.value)}
        />
        <Button type="submit" disabled={tracking}>
          {tracking ? "…" : "Track"}
        </Button>
      </form>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {result && (
        <div className="mt-4 space-y-3 rounded-lg bg-zinc-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-zinc-900">{result.procurement_id}</p>
            <Badge tone={statusTone(result.status)}>{statusLabel(result.status)}</Badge>
          </div>
          <p className="text-xs text-zinc-500">
            {result.stage_label}
            {result.owner_role ? ` · With ${result.owner_role}` : ""}
            {result.last_updated
              ? ` · Updated ${new Date(result.last_updated).toLocaleDateString("en-IN", { dateStyle: "medium" })}`
              : ""}
          </p>
          {result.checklist.length > 0 && (
            <ol className="space-y-1.5 border-t border-zinc-200 pt-3">
              {result.checklist.map((c) => (
                <li key={c.key} className="flex items-center gap-2 text-xs text-zinc-700">
                  <ChecklistIcon state={c.state} />
                  {c.label}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>("queue");
  const [authLoading, setAuthLoading] = useState(!!getToken());

  // Login form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  // Queue shell
  const [queue, setQueue] = useState<Req[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);

  // Restore session from persisted token.
  useEffect(() => {
    const t = getToken();
    if (!t) {
      setAuthLoading(false);
      return;
    }
    fetchMe(t)
      .then(setUser)
      .catch(() => {
        setToken(null);
        setTokenState(null);
      })
      .finally(() => setAuthLoading(false));
  }, []);

  const loadQueue = useCallback(async (t: string, u: User) => {
    setQueueLoading(true);
    try {
      setQueueError(null);
      const reqs = await listReqs(t, u.role);
      reqs.sort((a, b) => {
        const act = Number(canAct(u, b)) - Number(canAct(u, a));
        if (act !== 0) return act;
        return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      });
      setQueue(reqs);
    } catch (e) {
      setQueueError(friendlyError(e, "Could not load queue"));
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token && user) void loadQueue(token, user);
  }, [token, user, loadQueue]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError(null);
    try {
      const { access_token, user: u } = await login(email.trim(), password);
      setToken(access_token);
      setTokenState(access_token);
      setUser(u);
    } catch (err) {
      setLoginError(friendlyError(err, "Login failed"));
    } finally {
      setLoggingIn(false);
    }
  }

  function handleLogout() {
    setToken(null);
    setTokenState(null);
    setUser(null);
    setQueue([]);
  }

  function handleChanged(updated: Req) {
    setQueue((prev) => {
      if (!prev.some((r) => r.id === updated.id)) return [updated, ...prev];
      return prev.map((r) => (r.id === updated.id ? updated : r));
    });
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-zinc-500">Restoring session…</p>
      </div>
    );
  }

  // ---- Authenticated shell ----
  if (token && user) {
    const actionable = queue.filter((r) => canAct(user, r));
    const showAdmin = canSeeAdminPanel(user);
    const showReports = REPORT_VIEW_ROLES.includes(user.role);
    return (
      <div className="min-h-screen">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-white">
                <Package size={20} />
              </span>
              <div>
                <h1 className="text-base font-semibold text-zinc-900">
                  Institution Procurement System
                </h1>
                <p className="text-xs text-zinc-500">
                  {user.name} · {roleLabel(user.role)}
                  {canSeeAdminPanel(user) ? " · Admin panel access" : ""}
                </p>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={handleLogout}>
              <SignOut size={16} /> Logout
            </Button>
          </div>
        </header>

        <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
          {/* View tabs: queue (shared) + admin/reports mount points.
              Workflow agent: extend the queue view; leave admin/reports blocks alone. */}
          <nav className="flex flex-wrap gap-2" aria-label="Views">
            <Button
              size="sm"
              variant={view === "queue" ? "primary" : "secondary"}
              onClick={() => setView("queue")}
            >
              My queue
            </Button>
            {showAdmin && (
              <Button
                size="sm"
                variant={view === "admin" ? "primary" : "secondary"}
                onClick={() => setView("admin")}
              >
                Admin panel
              </Button>
            )}
            {showReports && (
              <Button
                size="sm"
                variant={view === "reports" ? "primary" : "secondary"}
                onClick={() => setView("reports")}
              >
                Reports
              </Button>
            )}
          </nav>

          {view === "reports" && showReports && (
            <Reports token={token} role={user.role} />
          )}
          {view === "admin" && showAdmin && <AdminPanel token={token} />}
          {view === "queue" && (
            <>
              {canCreate(user) && (
                <NewRequisition
                  token={token}
                  onCreated={(r) => setQueue((prev) => [r, ...prev])}
                />
              )}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <CardTitle>My queue</CardTitle>
                      <CardDescription>
                        {actionable.length} of {queue.length} awaiting your action.
                      </CardDescription>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={queueLoading}
                      onClick={() => void loadQueue(token, user)}
                    >
                      <ArrowClockwise size={16} /> {queueLoading ? "…" : "Refresh"}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {queueError ? (
                    <div className="space-y-2 py-4 text-center">
                      <p className="text-sm text-danger">{queueError}</p>
                      <Button variant="secondary" size="sm" onClick={() => void loadQueue(token, user)}>
                        Try again
                      </Button>
                    </div>
                  ) : queueLoading && queue.length === 0 ? (
                    <p className="py-6 text-center text-sm text-zinc-500">Loading queue…</p>
                  ) : queue.length === 0 ? (
                    <p className="py-6 text-center text-sm text-zinc-500">
                      No requisitions yet.
                      {canCreate(user) ? " Create one above to get started." : ""}
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {queue.map((r) => (
                        <RequisitionCard
                          key={r.id}
                          req={r}
                          user={user}
                          token={token}
                          onChanged={handleChanged}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>
                    <span className="inline-flex items-center gap-2">
                      <MagnifyingGlass size={18} /> Track procurement
                    </span>
                  </CardTitle>
                  <CardDescription>
                    Public status check — works without signing in too.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <TrackPanel />
                </CardContent>
              </Card>
            </>
          )}
        </main>
      </div>
    );
  }

  // ---- Public landing: login + tracking ----
  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-white">
            <Package size={20} />
          </span>
          <h1 className="text-base font-semibold text-zinc-900">
            Institution Procurement System
          </h1>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-6 py-10 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2">
                <LockKey size={18} /> Sign in
              </span>
            </CardTitle>
            <CardDescription>
              Use your institutional email and password.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="email"
                  className="text-sm font-medium text-zinc-700"
                >
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="password"
                  className="text-sm font-medium text-zinc-700"
                >
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {loginError && (
                <p className="text-sm text-danger">{loginError}</p>
              )}
              <Button type="submit" disabled={loggingIn} className="w-full">
                {loggingIn ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2">
                <MagnifyingGlass size={18} /> Track procurement
              </span>
            </CardTitle>
            <CardDescription>
              Public status check — no sign-in needed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TrackPanel />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
