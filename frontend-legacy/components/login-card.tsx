import { useState, type FormEvent } from "react";
import { Key, SignIn } from "@phosphor-icons/react";
import { login, type User } from "@/lib/api";
import { Card, CardBody, CardDescription, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Field, Input } from "./ui/field";
import { Notice } from "./ui/feedback";

const DEMO_ACCOUNTS = [
  "admin",
  "department",
  "hod",
  "principal",
  "finance",
  "purchase",
  "store",
  "bursar",
  "amc",
];

export function LoginCard({
  onLoggedIn,
}: {
  onLoggedIn: (token: string, user: User) => void;
}) {
  const [email, setEmail] = useState("department@example.com");
  const [password, setPassword] = useState("password");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const x = await login(email, password);
      localStorage.setItem("token", x.access_token);
      onLoggedIn(x.access_token, x.user);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="flex items-center gap-2">
          <Key size={20} className="text-brand-700" aria-hidden="true" />
          <CardTitle>Staff Login</CardTitle>
        </div>
        <CardDescription>
          Sign in with your institutional account to work on requisitions.
        </CardDescription>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <Field label="Email" id="login-email" required>
            <Input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </Field>
          <Field label="Password" id="login-password" required>
            <Input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          {err && <Notice tone="error">{err}</Notice>}
          <Button type="submit" disabled={busy} className="w-full">
            <SignIn size={16} aria-hidden="true" />
            {busy ? "Signing in…" : "Login"}
          </Button>
        </form>
        <details className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          <summary className="cursor-pointer font-medium text-slate-600">
            Demo accounts (password: password)
          </summary>
          <p className="mt-1.5 leading-relaxed">
            {DEMO_ACCOUNTS.map((a) => `${a}@example.com`).join(" · ")}
          </p>
        </details>
      </CardBody>
    </Card>
  );
}
