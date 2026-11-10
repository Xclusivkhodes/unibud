"use client";

import { useEffect, useId, useRef } from "react";
import { markedScoreLine, messageFor, previewFault, stateKind, type PreviewFault } from "./present.js";

export function PageHeader({ kicker, title, lede }: { kicker: string; title: string; lede?: string }) {
  return (
    <header className="page-head">
      <p className="kicker">{kicker}</p>
      <h1>{title}</h1>
      {lede ? <p className="lede">{lede}</p> : null}
    </header>
  );
}

export function Alert({ code }: { code?: string }) {
  if (!code || previewFault(code)) return null;
  return <p className="alert" role="alert">{messageFor(code)}</p>;
}

export function Status({ children }: { children: React.ReactNode }) {
  return <p className="status" role="status">{children}</p>;
}

export function Loading({ label }: { label: string }) {
  return <p className="status" role="status" aria-busy="true">{label}</p>;
}

const faultCopy: Record<PreviewFault, { http: string; title: string; body: string }> = {
  preview_required: {
    http: "400",
    title: "Preview identifier required",
    body: "Confirmation needs the preview identifier from the proposal on this page. No dates were written.",
  },
  preview_not_found: {
    http: "404",
    title: "Preview was not found",
    body: "That preview is not on this account. Nothing was applied.",
  },
  preview_consumed: {
    http: "409",
    title: "Preview already used",
    body: "That preview was already confirmed. Request a new proposal. Nothing new was applied.",
  },
  stale_preview: {
    http: "409",
    title: "This preview is stale",
    body: "Your courses changed after this proposal. Nothing was saved. Ask for a new proposal and read it before confirming.",
  },
};

export function PreviewFaultNote({ code }: { code: string }) {
  const fault = previewFault(code);
  if (!fault) return null;
  const copy = faultCopy[fault];
  return (
    <section className={`state state-${fault}`} role="alert">
      <p className="kicker">{fault} · {copy.http}</p>
      <h2>{copy.title}</h2>
      <p>{copy.body}</p>
    </section>
  );
}

export function StateNote({ code, title, children }: { code: string; title?: string; children?: React.ReactNode }) {
  const kind = stateKind(code);
  return (
    <section className={`state state-${kind}`} role={kind === "offline" ? "status" : "alert"}>
      <p className="kicker">{kind}</p>
      <h2>{title ?? messageFor(code)}</h2>
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="state state-empty">
      <p className="kicker">Nothing here</p>
      <h2>{title}</h2>
      <p>{children}</p>
    </section>
  );
}

export function Unavailable({ title, detail }: { title: string; detail: string }) {
  return (
    <section className="state state-unavailable">
      <p className="kicker">Unavailable</p>
      <h2>{title}</h2>
      <p>{detail}</p>
    </section>
  );
}

export function Field({ label, name, type = "text", required = false, defaultValue = "", value, onChange, min, max, step, autoComplete }: { label: string; name: string; type?: string; required?: boolean; defaultValue?: string; value?: string; onChange?: (value: string) => void; min?: string; max?: string; step?: string; autoComplete?: string }) {
  const id = useId();
  const controlled = value !== undefined;
  return (
    <label className="field stack" htmlFor={id}>
      {label}
      {type === "area" ? (
        <textarea id={id} name={name} required={required} rows={4} autoComplete={autoComplete} {...(controlled ? { value, onChange: (event) => onChange?.(event.target.value) } : { defaultValue })} />
      ) : (
        <input id={id} name={name} type={type} required={required} min={min} max={max} step={step} autoComplete={autoComplete} {...(controlled ? { value, onChange: (event) => onChange?.(event.target.value) } : { defaultValue })} />
      )}
    </label>
  );
}

export function GameScore({ score, total, claim }: { score?: unknown; total?: unknown; claim?: string }) {
  const line = markedScoreLine(score, total);
  if (!line) return null;
  return <p className="status" role="status">{line}{claim ? ` Claim: ${claim}.` : ""}</p>;
}

export function ConfirmDialog({ title, body, confirmLabel, busy, onConfirm, onClose }: { title: string; body: string; confirmLabel: string; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      previous.current?.focus();
    };
  }, []);
  return (
    <dialog ref={dialog} className="dialog" aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <h2 id="dialog-title">{title}</h2>
      <p>{body}</p>
      <div className="row">
        <button className="btn quiet" type="button" onClick={onClose}>Cancel</button>
        <button className="btn amber" type="button" disabled={busy} onClick={onConfirm}>{busy ? "Working…" : confirmLabel}</button>
      </div>
    </dialog>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "logo-plate compact" : "logo-plate"}>
      <img src="/brand/unibud-primary-logo-reference.png" width={1028} height={442} alt="UniBud" />
    </div>
  );
}

export function NavyOwl({ alt = "" }: { alt?: string }) {
  return <img className="owl-mark" src="/brand/unibud-navy-owl-reference.png" width={198} height={233} alt={alt} />;
}
