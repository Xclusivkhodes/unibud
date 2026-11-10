"use client";

import { useEffect, useId, useRef } from "react";
import { markedScoreLine, messageFor } from "./present.js";

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
  if (!code) return null;
  return <p className="alert" role="alert">{messageFor(code)}</p>;
}

export function Status({ children }: { children: React.ReactNode }) {
  return <p className="status" role="status">{children}</p>;
}

export function Unavailable({ title, detail }: { title: string; detail: string }) {
  return (
    <section className="notice unavailable">
      <p className="kicker">Unavailable</p>
      <h2>{title}</h2>
      <p>{detail}</p>
    </section>
  );
}

export function Loading({ label }: { label: string }) {
  return <p className="status" role="status" aria-busy="true">{label}</p>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Field({ label, name, type = "text", required = false, defaultValue = "", value, onChange, min, max, step }: { label: string; name: string; type?: string; required?: boolean; defaultValue?: string; value?: string; onChange?: (value: string) => void; min?: string; max?: string; step?: string }) {
  const id = useId();
  const controlled = value !== undefined;
  return (
    <label className="field stack" htmlFor={id}>
      {label}
      {type === "area" ? (
        <textarea id={id} name={name} required={required} rows={4} {...(controlled ? { value, onChange: (event) => onChange?.(event.target.value) } : { defaultValue })} />
      ) : (
        <input id={id} name={name} type={type} required={required} min={min} max={max} step={step} {...(controlled ? { value, onChange: (event) => onChange?.(event.target.value) } : { defaultValue })} />
      )}
    </label>
  );
}

export function GameScore({ score, total, claim }: { score?: unknown; total?: unknown; claim?: string }) {
  const line = markedScoreLine(score, total);
  if (!line) return null;
  return <p className="status" role="status">{line}{claim ? ` ${claim}.` : ""}</p>;
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
