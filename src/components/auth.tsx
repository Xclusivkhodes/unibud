"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Field, Logo } from "./Bits.js";
import { api, ApiClientError } from "./http.js";

export function LoginForm({ initialError = "" }: { initialError?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", { method: "POST", body: { email, password } });
      window.location.assign("/today");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.code : "internal");
      setBusy(false);
    }
  }

  return (
    <main className="auth stack">
      <Logo />
      <h1 className="hero">Sign in</h1>
      <Alert code={error} />
      <form className="stack ivory" onSubmit={(event) => void submit(event)}>
        <Field label="Email" name="email" type="email" required value={email} onChange={setEmail} />
        <Field label="Password" name="password" type="password" required value={password} onChange={setPassword} />
        <button className="btn amber" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <Link href="/register">Create an account</Link>
    </main>
  );
}

export function RegisterForm({ deleted = false, initialError = "" }: { deleted?: boolean; initialError?: string }) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/register", { method: "POST", body: { email, password, ...(displayName.trim() ? { displayName: displayName.trim() } : {}) } });
      window.location.assign("/today");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.code : "internal");
      setBusy(false);
    }
  }

  return (
    <main className="auth stack">
      <Logo />
      <h1 className="hero">Create your workspace</h1>
      <p className="lede">A preferred name is optional. If you send one, it is stored, but the session response does not return it. The workspace shows your email.</p>
      {deleted ? <p role="status">The account and its derived records were deleted.</p> : null}
      <Alert code={error} />
      <form className="stack ivory" onSubmit={(event) => void submit(event)}>
        <Field label="Preferred name, optional" name="displayName" value={displayName} onChange={setDisplayName} />
        <Field label="Email" name="email" type="email" required value={email} onChange={setEmail} />
        <Field label="Password" name="password" type="password" required value={password} onChange={setPassword} />
        <button className="btn amber" type="submit" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
      </form>
      <Link href="/login">Already registered</Link>
    </main>
  );
}
