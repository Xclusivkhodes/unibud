"use client";

import { useState } from "react";
import { Alert, GameScore, PageHeader, Status } from "../Bits.js";
import { api, errorCode } from "../http.js";
import { BUILT_IN_PROMPTS, listField, readGameScore } from "../present.js";

export function GamesScreen() {
  const [one, setOne] = useState("");
  const [two, setTwo] = useState("");
  const [score, setScore] = useState<number | undefined>(undefined);
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [claim, setClaim] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const parsed = readGameScore(await api("/api/games/built-in", { method: "POST", body: { answers: [one, two] } }));
      if (!parsed) {
        setScore(undefined);
        setTotal(undefined);
        setClaim("");
        setError("internal");
      } else {
        setScore(parsed.score);
        setTotal(parsed.total);
        setClaim(parsed.claim);
      }
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    setError("");
    try {
      const rows = listField(await api("/api/games"), "results");
      if (rows.length === 0) {
        setHistory(["No saved game results."]);
        return;
      }
      setHistory(rows.map((item) => {
        const parsed = readGameScore(item);
        return parsed ? `${parsed.line}${parsed.claim ? ` Claim: ${parsed.claim}.` : ""}` : "A result was returned without both score and total, so it is not shown as a score.";
      }));
    } catch (caught) {
      setError(errorCode(caught));
    }
  }

  return (
    <section className="stack">
      <PageHeader kicker="Practice" title="GameVerse" lede="This built-in pair is practice, not a record of your courses. The score is not mastery." />
      <GameScore score={score} total={total} claim={claim} />
      <Alert code={error} />
      <form className="ivory stack" onSubmit={(event) => void submit(event)}>
        <label className="field stack">{BUILT_IN_PROMPTS[0]}<input name="one" required value={one} onChange={(event) => setOne(event.target.value)} /></label>
        <label className="field stack">{BUILT_IN_PROMPTS[1]}<input name="two" required value={two} onChange={(event) => setTwo(event.target.value)} /></label>
        <button className="btn amber" type="submit" disabled={busy}>{busy ? "Scoring…" : "Score game"}</button>
      </form>
      <button className="btn quiet" type="button" onClick={() => void load()}>Load saved results</button>
      {history.length > 0 ? <ul className="plain">{history.map((line) => <li key={line}><Status>{line}</Status></li>)}</ul> : null}
    </section>
  );
}
