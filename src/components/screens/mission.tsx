"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Empty, Field, Loading, Status } from "../Bits.js";
import { api, ApiClientError } from "../http.js";
import { calendarBucketLabel, gaps, readTask, type TaskView } from "../present.js";
import { useWorkspace } from "../workspace.js";

export function TodayScreen() {
  const { courses, courseId, refreshCourses, memory, updateMemory, online } = useWorkspace();
  const [tasks, setTasks] = useState<TaskView[] | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionNote, setSessionNote] = useState("");
  const selected = courses.find((course) => course.id === courseId) ?? courses[0];

  async function loadTasks() {
    setError("");
    try {
      const body = await api("/api/tasks");
      const rows = body && typeof body === "object" && "tasks" in body ? (body as { tasks: unknown }).tasks : [];
      setTasks(Array.isArray(rows) ? rows.flatMap((item) => { const task = readTask(item); return task ? [task] : []; }) : []);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.code : "internal");
    }
  }

  useEffect(() => { void loadTasks(); }, []);

  async function saveCourse(event: React.FormEvent) {
    event.preventDefault();
    if (!online) { setError("offline"); return; }
    setBusy(true);
    setError("");
    try {
      await api("/api/courses", { method: "POST", body: { name, goal } });
      setName("");
      setGoal("");
      await refreshCourses();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.code : "internal");
    } finally {
      setBusy(false);
    }
  }

  async function startSession() {
    if (!online) { setSessionNote("offline"); return; }
    setBusy(true);
    try {
      const body = await api("/api/sessions", { method: "POST", body: { courseId: selected?.id, kind: "study" } }) as { id?: string };
      if (typeof body.id === "string") {
        updateMemory((current) => ({ ...current, sessionId: body.id ?? "" }));
        setSessionNote("A study session is open. Minutes are recorded only after you complete it.");
      }
    } catch (caught) {
      setSessionNote(caught instanceof ApiClientError ? caught.code : "internal");
    } finally {
      setBusy(false);
    }
  }

  async function completeSession() {
    if (!memory.sessionId) return;
    setBusy(true);
    try {
      const body = await api(`/api/sessions/${memory.sessionId}/complete`, { method: "POST", body: {} }) as { minutes?: unknown; mastery?: unknown };
      const minutes = typeof body.minutes === "number" ? body.minutes : null;
      setSessionNote(minutes === null ? "The session completed without a minute count." : `Recorded ${minutes} minutes for this session. Not a streak, and not mastery.`);
      updateMemory((current) => ({ ...current, sessionId: "" }));
    } catch (caught) {
      setSessionNote(caught instanceof ApiClientError ? caught.code : "internal");
    } finally {
      setBusy(false);
    }
  }

  const agenda = (tasks ?? []).filter((task) => task.status === "open");
  const next = agenda.find((task) => task.dueAt) ?? null;

  return (
    <>
      <p className="kicker">Mission Control</p>
      <h1 className="hero">A little clearer.<br />A little further.</h1>
      {tasks === null && !error ? <Loading label="Loading tasks…" /> : null}
      <Alert code={error} />
      <div className="grid">
        <section className="reading stack">
          <p className="kicker">Continue learning</p>
          {selected ? (
            <>
              <h2>Continue {selected.name}</h2>
              <p>This name is a course on your account. {gaps.streak}</p>
              <Link className="btn amber" href={`/courses/${selected.id}`}>Open course</Link>
            </>
          ) : (
            <>
              <h2>Add a course</h2>
              <p>The resume panel stays empty until you save a course.</p>
              <form className="stack" onSubmit={(event) => void saveCourse(event)}>
                <Field label="Course name" name="name" required value={name} onChange={setName} />
                <Field label="Goal, optional" name="goal" value={goal} onChange={setGoal} />
                <button className="btn amber" type="submit" disabled={busy}>{busy ? "Saving…" : "Save course"}</button>
              </form>
            </>
          )}
          <p>{gaps.attempts}</p>
        </section>
        <aside className="stack">
          <section className="glass">
            <h2>Next up</h2>
            {next ? <p>{next.title}. {calendarBucketLabel(next.dueAt)}. This is a task, not an exam record.</p> : <p>{gaps.exams}</p>}
            <Link href="/cram">Review an exam proposal</Link>
          </section>
          <section className="glass ask stack">
            <h2>Ask a question</h2>
            <p>Lessons, notes, and practice stay on this account. A model reply appears only when a provider actually returns one.</p>
            <Link className="btn amber" href="/companion">Open Study Companion</Link>
          </section>
        </aside>
      </div>
      <div className="row spread">
        <h2>Learning agenda</h2>
        <Link href="/planner">View plan</Link>
      </div>
      {agenda.length === 0 ? <Empty>No open tasks yet.</Empty> : (
        <ol className="agenda">
          {agenda.map((task, index) => (
            <li key={task.id}>
              <span className="num">{String(index + 1).padStart(2, "0")}</span>
              <span><strong>{task.title}</strong><br />{calendarBucketLabel(task.dueAt)} · {task.confirmed ? "Confirmed" : "Not confirmed"}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="row">
        <button className="btn quiet" type="button" disabled={busy} onClick={() => void startSession()}>Start a study session</button>
        {memory.sessionId ? <button className="btn quiet" type="button" disabled={busy} onClick={() => void completeSession()}>Complete session</button> : null}
      </div>
      {sessionNote ? <Status>{sessionNote.startsWith("Recorded") || sessionNote.startsWith("A study") || sessionNote.startsWith("The session") ? sessionNote : `Session: ${sessionNote}`}</Status> : null}
    </>
  );
}
