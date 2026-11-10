"use client";

import { useState } from "react";
import { Alert, GameScore, PageHeader, Status } from "../Bits.js";
import { api, ApiClientError } from "../http.js";
import { BUILT_IN_PROMPTS, markedScoreLine, record } from "../present.js";

export function Games({ score, total }: { score?: unknown; total?: unknown }) {
  const line = markedScoreLine(score, total);
  const [one, setOne] = useState("");
  const [two, setTwo] = useState("");
  const [result, setResult] = useState<{ score?: unknown; total?: unknown; claim?: string } | null>(null);
  const [history, setHistory] = useState<string>("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = await api("/api/games/built-in", { method: "POST", body: { answers: [one, two] } });
      const row = record(body);
      setResult(row ? { score: row.score, total: row.total, claim: typeof row.learningClaim === "string" ? row.learningClaim : undefined } : null);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.code : "internal");
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    setError("");
    try {
      const body = await api("/api/games");
      const rows = record(body)?.results;
      if (!Array.isArray(rows) || rows.length === 0) {
        setHistory("No saved game results.");
        return;
      }
      setHistory(rows.map((item) => {
        const row = record(item);
        const text = markedScoreLine(row?.score, row?.total);
        return text ? `${text} ${typeof row?.learning_claim === "string" ? row.learning_claim : ""}`.trim() : "A result was returned without both score and total, so it is not shown as a score.";
      }).join(" "));
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.code : "internal");
    }
  }

  return (
    <section className="stack">
      <PageHeader kicker="Practice" title="GameVerse" lede="This built-in pair is practice, not a record of your courses. The score is not mastery." />
      {line ? <Status>{line}</Status> : null}
      <GameScore score={result?.score} total={result?.total} claim={result?.claim} />
      <Alert code={error} />
      <form className="ivory stack" onSubmit={(event) => void submit(event)}>
        <label className="field stack">{BUILT_IN_PROMPTS[0]}<input name="one" required value={one} onChange={(event) => setOne(event.target.value)} /></label>
        <label className="field stack">{BUILT_IN_PROMPTS[1]}<input name="two" required value={two} onChange={(event) => setTwo(event.target.value)} /></label>
        <button className="btn amber" type="submit" disabled={busy}>{busy ? "Scoring…" : "Score game"}</button>
      </form>
      <button className="btn quiet" type="button" onClick={() => void load()}>Load saved results</button>
      {history ? <Status>{history}</Status> : null}
    </section>
  );
}
