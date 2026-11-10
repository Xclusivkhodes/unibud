"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, ConfirmDialog, Empty, Field, Loading, NavyOwl, PageHeader, Status, Unavailable } from "../Bits.js";
import { api, browserOffline, clientToken, errorCode } from "../http.js";
import { gaps, listField, record, text } from "../present.js";
import { groups, searchDestinations } from "../../nav.js";
import { useSearchParams } from "next/navigation";
import { useWorkspace } from "../workspace.js";

export function TwinScreen() {
  const { memory } = useWorkspace();
  const [topicId, setTopicId] = useState(memory.topics[0]?.id ?? "");
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const row = record(await api(`/api/topics/${topicId}/evidence`));
      if (!row) { setError("internal"); return; }
      const evidence = record(row.evidence);
      const evidenceText = row.evidence === null ? "No submitted answers for this topic." : evidence ? `${evidence.correct} correct of ${evidence.total}.` : "Evidence was not the expected shape.";
      setBody(`Self-reported level: ${text(row.selfReportedLevel) || "blank"}. ${row.selfReportIsNotMeasuredAbility === true ? "That level is not measured ability." : "The self-report flag was not returned as true."} ${evidenceText} Mastery: ${row.mastery === null ? "null" : "not returned as null"}. Demographics used: ${row.usesDemographics === false ? "no" : "not returned as false"}. Game results ignored: ${typeof row.gameResultsIgnored === "number" ? row.gameResultsIgnored : "not returned"}.`);
    } catch (caught) {
      setError(errorCode(caught));
      setBody("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Plan" title="Learning Twin" lede="Evidence is correct answers over submitted answers for one topic. Mastery stays null. Game scores are ignored." />
      <form className="ivory stack" onSubmit={(event) => void load(event)}>
        <label className="field stack">Topic saved in this tab
          <select value={topicId} onChange={(event) => setTopicId(event.target.value)}>
            <option value="">Select</option>
            {memory.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
          </select>
        </label>
        <Field label="Or paste a topic id" name="topicId" value={topicId} onChange={setTopicId} />
        <button className="btn amber" type="submit" disabled={busy || !topicId}>Load evidence</button>
      </form>
      <Alert code={error} />
      {body ? <Status>{body}</Status> : null}
    </>
  );
}

export function RadarScreen() {
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [hypotheses, setHypotheses] = useState<Array<{ id: string; questionId: string; evidence: string }>>([]);
  const [singles, setSingles] = useState<Array<{ questionId: string; count: number }>>([]);
  const [diagnosis, setDiagnosis] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const body = record(await api("/api/misconceptions"));
      setHypotheses(Array.isArray(body?.hypotheses) ? body.hypotheses.flatMap((item) => {
        const row = record(item);
        if (!row || typeof row.id !== "string") return [];
        return [{ id: row.id, questionId: text(row.question_id), evidence: text(row.evidence_json) }];
      }) : []);
      setSingles(Array.isArray(body?.singleErrorsAreNotHypotheses) ? body.singleErrorsAreNotHypotheses.flatMap((item) => {
        const row = record(item);
        if (!row || typeof row.question_id !== "string") return [];
        return [{ questionId: row.question_id, count: typeof row.n === "number" ? row.n : Number(row.n) }];
      }) : []);
      setDiagnosis(body?.diagnosis === false ? false : body?.diagnosis === true ? true : null);
      setLoaded(true);
      setError("");
    } catch (caught) {
      setError(errorCode(caught));
    }
  }

  useEffect(() => { void load(); }, []);

  async function correct(id: string) {
    setBusy(true);
    try {
      await api(`/api/misconceptions/${id}/correct`, { method: "POST", body: {} });
      await load();
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Plan" title="Misconception Radar" lede="A hypothesis is repeated missed attempts, not a diagnosis. A single miss is listed separately." />
      <Alert code={error} />
      {!loaded && !error ? <Loading label="Loading evidence…" /> : null}
      <p>Diagnosis flag: {diagnosis === false ? "false" : diagnosis === true ? "true" : "not returned"}.</p>
      {loaded && hypotheses.length === 0 ? <Empty title="No hypotheses">Repeated misses have not been recorded. That is empty evidence, not a clean bill of mastery.</Empty> : null}
      <ul className="plain">
        {hypotheses.map((item) => (
          <li key={item.id}>
            Question {item.questionId || "unknown"} · {item.evidence || "No evidence JSON"}
            <button className="btn quiet" type="button" disabled={busy} onClick={() => void correct(item.id)}>Mark this episode corrected</button>
          </li>
        ))}
      </ul>
      <h2>Single misses</h2>
      {loaded && singles.length === 0 ? <p>No single-miss rows.</p> : null}
      <ul className="plain">{singles.map((item) => <li key={item.questionId}>Question {item.questionId} · count {Number.isFinite(item.count) ? item.count : "not a number"} · not a hypothesis</li>)}</ul>
    </>
  );
}

export function ArenaScreen() {
  const { memory, updateMemory, online } = useWorkspace();
  const [questionId, setQuestionId] = useState(memory.questions[0]?.id ?? "");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const question = memory.questions.find((item) => item.id === questionId);

  async function submit(interrupt: boolean, selectedIndex: number) {
    if (!question) return;
    if (!online || browserOffline()) { setError("offline"); return; }
    setBusy(true);
    setError("");
    try {
      const opened = record(await api("/api/attempts", { method: "POST", body: { courseId: question.courseId, topicId: question.topicId || undefined, kind: "arena", timingMode: "timed", clientToken: clientToken() } }));
      const attemptId = typeof opened?.id === "string" ? opened.id : "";
      if (!attemptId) { setError("internal"); return; }
      if (interrupt) {
        const stopped = record(await api(`/api/attempts/${attemptId}/interrupt`, { method: "POST", body: {} }));
        const attempt = record(stopped?.attempt);
        setNote(`Interrupted. Status ${text(attempt?.status) || "not returned"}. Score ${attempt?.score_correct === null ? "null" : "not returned as null"}.`);
        return;
      }
      const marked = record(await api(`/api/attempts/${attemptId}/answers`, { method: "POST", body: { questionId: question.id, selectedIndex } }));
      await api(`/api/attempts/${attemptId}/submit`, { method: "POST", body: {} });
      if (marked?.correct === false) {
        updateMemory((current) => ({ ...current, missed: [...current.missed.filter((item) => item.questionId !== question.id), { questionId: question.id, prompt: question.prompt, courseId: question.courseId, topicId: question.topicId }] }));
      }
      setNote(`Submitted. Objective key ${marked?.correct === true ? "matched" : "did not match"}. ${gaps.attempts}`);
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Exams" title="Exam Arena" lede="Interrupting an attempt stores no score. Questions are the ones you saved in this browser, because the server does not list them." />
      <Alert code={error} />
      {memory.questions.length === 0 ? <Empty title="No question to sit">Add a practice question before an arena attempt.</Empty> : (
        <form className="reading stack" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void submit(false, Number(data.get("selected"))); }}>
          <label className="field stack">Question
            <select value={questionId} onChange={(event) => setQuestionId(event.target.value)}>
              {memory.questions.map((item) => <option key={item.id} value={item.id}>{item.prompt}</option>)}
            </select>
          </label>
          {question?.choices.map((choice, index) => <label key={`${question.id}-${index}`}><input type="radio" name="selected" value={index} required /> {choice}</label>)}
          <div className="row">
            <button className="btn amber" type="submit" disabled={busy}>Submit timed answer</button>
            <button className="btn quiet" type="button" disabled={busy} onClick={() => void submit(true, 0)}>Interrupt without a score</button>
          </div>
        </form>
      )}
      {note ? <Status>{note}</Status> : null}
    </>
  );
}

export function CircleScreen() {
  const { memory, updateMemory, online } = useWorkspace();
  const [name, setName] = useState("");
  const [circleId, setCircleId] = useState(memory.circles[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [post, setPost] = useState("");
  const [posts, setPosts] = useState<Array<{ id: string; body: string; ack: string }>>([]);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!online || browserOffline()) { setError("offline"); return; }
    setBusy(true);
    try {
      const body = record(await api("/api/circles", { method: "POST", body: { name } }));
      if (!body || typeof body.id !== "string") { setError("internal"); return; }
      const saved = { id: body.id, name };
      updateMemory((current) => ({ ...current, circles: [...current.circles.filter((item) => item.id !== saved.id), saved] }));
      setCircleId(saved.id);
      setName("");
      setNote("Circle created. Membership is not listed. You are the owner on the server.");
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    if (!circleId || !online) { setError("offline"); return; }
    setBusy(true);
    try {
      const body = record(await api(`/api/circles/${circleId}/invites`, { method: "POST", body: { email } }));
      setNote(body?.invited === true ? `Invite pending for a real account. Status ${text(body.status)}.` : "No UniBud account uses that email, so nobody was invited.");
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  async function accept(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api(`/api/circles/${circleId}/accept`, { method: "POST", body: {} });
      setNote("Invite accepted.");
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = record(await api(`/api/circles/${circleId}/posts`, { method: "POST", body: { body: post } }));
      const audience = Array.isArray(body?.audience) ? body.audience.length : 0;
      setNote(`Posted. Ack ${body?.ack === true ? "true" : "not returned"}. Active audience count ${audience}.`);
      setPost("");
      await refresh();
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (!circleId) return;
    try {
      setPosts(listField(await api(`/api/circles/${circleId}/posts`), "posts").flatMap((item) => {
        const row = record(item);
        if (!row || typeof row.id !== "string") return [];
        return [{ id: row.id, body: text(row.body), ack: text(row.ack_status) }];
      }));
      setError("");
    } catch (caught) {
      setError(errorCode(caught));
    }
  }

  return (
    <>
      <PageHeader kicker="Collaborate" title="Study Circle" lede="A post is visible to active members. An invite is sent only when the email belongs to an account. A click is not treated as a successful invite." />
      <p className="meta">{gaps.circles}</p>
      <Alert code={error} />
      <form className="ivory stack" onSubmit={(event) => void create(event)}>
        <Field label="Circle name" name="name" required value={name} onChange={setName} />
        <button className="btn amber" type="submit" disabled={busy}>Create circle</button>
      </form>
      <label className="field stack">Circle in this tab
        <select value={circleId} onChange={(event) => setCircleId(event.target.value)}>
          <option value="">Select</option>
          {memory.circles.map((circle) => <option key={circle.id} value={circle.id}>{circle.name}</option>)}
        </select>
      </label>
      <form className="stack" onSubmit={(event) => void invite(event)}>
        <Field label="Invite email" name="email" type="email" required value={email} onChange={setEmail} />
        <button className="btn quiet" type="submit" disabled={busy || !circleId}>Send invite</button>
      </form>
      <form onSubmit={(event) => void accept(event)}><button className="btn quiet" type="submit" disabled={busy || !circleId}>Accept invite for this account</button></form>
      <form className="reading stack" onSubmit={(event) => void publish(event)}>
        <Field label="Post" name="post" type="area" required value={post} onChange={setPost} />
        <button className="btn amber" type="submit" disabled={busy || !circleId}>Post to active members</button>
      </form>
      <button className="btn quiet" type="button" disabled={!circleId} onClick={() => void refresh()}>Load posts</button>
      {posts.length === 0 ? <p className="meta">No posts loaded.</p> : <ul className="plain">{posts.map((item) => <li key={item.id}>{item.body} · ack {item.ack || "not returned"}</li>)}</ul>}
      {note ? <Status>{note}</Status> : null}
    </>
  );
}

export function ActivityScreen() {
  return (
    <>
      <PageHeader kicker="Utilities" title="Notifications and Activity" lede="Activity would list real account events. This server does not expose that list." />
      <Unavailable title="No activity feed" detail={gaps.notifications} />
    </>
  );
}

export function SettingsScreen() {
  const { me } = useWorkspace();
  const [providers, setProviders] = useState<string>("");
  const [error, setError] = useState("");
  const [exportText, setExportText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/providers").then((body) => {
      const lines = listField(body, "providers").flatMap((item) => {
        const row = record(item);
        if (!row || typeof row.provider !== "string") return [];
        return [`${row.provider} ${text(row.model)}: ${row.configured === true ? "configured" : "unconfigured"}, eligible false, operational false, live verified false${typeof row.blockReason === "string" ? `, ${row.blockReason}` : ""}`];
      });
      setProviders(lines.join("\n"));
    }).catch((caught: unknown) => setError(errorCode(caught)));
  }, []);

  async function download() {
    setBusy(true);
    try {
      const body = await api("/api/export");
      setExportText(JSON.stringify(body, null, 2));
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api("/api/account", { method: "DELETE" });
      window.location.assign("/register?deleted=1");
    } catch (caught) {
      setError(errorCode(caught));
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Utilities" title="Profile and settings" lede="AI intelligence settings show the provider registry. None are marked ready." />
      <NavyOwl alt="UniBud navy owl" />
      <p className="meta">{gaps.profile}</p>
      <dl className="facts">
        <div><dt>Email</dt><dd>{me.email}</dd></div>
        <div><dt>Account id</dt><dd>{me.id}</dd></div>
        <div><dt>Data class</dt><dd>{me.dataClass || "unknown"}</dd></div>
      </dl>
      <h2>AI intelligence settings</h2>
      <Alert code={error} />
      {providers ? <pre className="export">{providers}</pre> : <Loading label="Loading providers…" />}
      <div className="row">
        <button className="btn quiet" type="button" disabled={busy} onClick={() => void download()}>Download account export</button>
        <button className="btn quiet" type="button" onClick={() => setConfirming(true)}>Delete account</button>
      </div>
      {exportText ? <pre className="export">{exportText}</pre> : null}
      {confirming ? <ConfirmDialog title="Delete this account?" body="This deletes the account and its derived records. The action cannot be undone from this page." confirmLabel="Delete account" busy={busy} onClose={() => setConfirming(false)} onConfirm={() => void remove()} /> : null}
    </>
  );
}

export function ToolsScreen() {
  return (
    <>
      <PageHeader kicker="Utilities" title="All tools" lede="Every module keeps its name. Courses are the workspace around them, not another copy of each tool." />
      {groups.map((group) => (
        <section key={group.id} className="stack">
          <h2>{group.label}</h2>
          {group.href ? <Link href={group.href}>Mission Control</Link> : (
            <ul className="plain">{group.items.map((item) => <li key={item.href}><Link href={item.href}>{item.label}</Link></li>)}</ul>
          )}
        </section>
      ))}
      <h2>Workspace</h2>
      <Link href="/courses">Courses</Link>
    </>
  );
}

export function SearchScreen() {
  const params = useSearchParams();
  const query = params.get("q") ?? "";
  const matches = searchDestinations(query);
  return (
    <>
      <PageHeader kicker="Search" title={query ? `Results for “${query}”` : "Search tools"} lede="Search matches tool names. It does not search notes, because note bodies are not listed." />
      <form className="search" action="/search" role="search">
        <label className="sr" htmlFor="search-q">Search tools</label>
        <input id="search-q" name="q" defaultValue={query} />
        <button className="btn amber" type="submit">Search</button>
      </form>
      {query && matches.length === 0 ? <Empty title="No matching tools">Try Study Companion, or the alias Gemma Study Companion.</Empty> : null}
      <ul className="plain">{matches.map((item) => <li key={item.href}><Link href={item.href}>{item.label}</Link></li>)}</ul>
    </>
  );
}
