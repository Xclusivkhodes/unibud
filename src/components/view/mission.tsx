"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Empty, Field, Loading, Status } from "../Bits.js";
import { api, browserOffline, errorCode } from "../http.js";
import { calendarBucketLabel, gaps, listField, readCourse, readTask, record, type TaskView } from "../present.js";
import { useWorkspace } from "../workspace.js";

export function TodayScreen() {
  const { courses, coursesStatus, courseId, refreshCourses, memory, updateMemory, online, setCourseId } = useWorkspace();
  const [tasks, setTasks] = useState<TaskView[] | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionNote, setSessionNote] = useState("");
  const selected = courses.find((course) => course.id === courseId) ?? courses[0];

  useEffect(() => {
    let live = true;
    api("/api/tasks").then((body) => {
      if (!live) return;
      setTasks(listField(body, "tasks").flatMap((item) => {
        const task = readTask(item);
        return task ? [task] : [];
      }));
    }).catch((caught: unknown) => {
      if (!live) return;
      setError(errorCode(caught));
    });
    return () => { live = false; };
  }, []);

  async function saveCourse(event: React.FormEvent) {
    event.preventDefault();
    if (!online || browserOffline()) { setError("offline"); return; }
    setBusy(true);
    setError("");
    try {
      const body = await api("/api/courses", { method: "POST", body: { name, goal } });
      const course = readCourse(record(body)?.course);
      setName("");
      setGoal("");
      await refreshCourses();
      if (course) setCourseId(course.id);
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  async function startSession() {
    if (!online || browserOffline()) { setSessionNote("offline"); return; }
    setBusy(true);
    try {
      const body = record(await api("/api/sessions", { method: "POST", body: { courseId: selected?.id, kind: "study" } }));
      if (body && typeof body.id === "string") {
        const id = body.id;
        updateMemory((current) => ({ ...current, sessionId: id }));
        setSessionNote("A study session is open. Minutes are recorded only after you complete it.");
      } else setSessionNote("The session didn't start.");
    } catch (caught) {
      setSessionNote(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  async function completeSession() {
    if (!memory.sessionId) return;
    if (!online || browserOffline()) { setSessionNote("offline"); return; }
    setBusy(true);
    try {
      const body = record(await api(`/api/sessions/${memory.sessionId}/complete`, { method: "POST", body: {} }));
      const minutes = body && typeof body.minutes === "number" ? body.minutes : null;
      setSessionNote(minutes === null ? "The session completed without a minute count." : `Recorded ${minutes} minutes for this session. Not a streak, and not mastery.`);
      updateMemory((current) => ({ ...current, sessionId: "" }));
    } catch (caught) {
      setSessionNote(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  const agenda = (tasks ?? []).filter((task) => task.status === "open");
  const next = agenda.find((task) => task.dueAt) ?? agenda[0] ?? null;

  return (
    <div className="today">
      <p className="kicker">Mission Control</p>
      <p className="meta">Today · Your workspace</p>
      <h1 className="hero">A little clearer.<br />A little further.</h1>
      {coursesStatus === "loading" || (tasks === null && !error) ? <Loading label="Loading your workspace…" /> : null}
      <Alert code={error} />
      {sessionNote === "offline" ? <Alert code="offline" /> : null}
      <div className="grid">
        <section className="reading stack continue-card">
          <p className="kicker">Continue learning</p>
          {selected ? (
            <>
              <h2>Continue {selected.name}</h2>
              <p>{selected.goal || "No goal saved yet."} {gaps.streak}</p>
              <div className="row">
                <span className="chip">{selected.name}</span>
                <Link className="btn amber" href={`/courses/${selected.id}`}>Open course</Link>
              </div>
            </>
          ) : coursesStatus === "ready" ? (
            <>
              <h2>Add a course</h2>
              <p>Add a course to pick up where you left off.</p>
              <form className="stack" onSubmit={(event) => void saveCourse(event)}>
                <Field label="Course name" name="name" required value={name} onChange={setName} />
                <Field label="Goal, optional" name="goal" value={goal} onChange={setGoal} />
                <button className="btn amber" type="submit" disabled={busy}>{busy ? "Saving…" : "Save course"}</button>
              </form>
            </>
          ) : null}
          <p className="meta">{gaps.attempts}</p>
        </section>
        <aside className="stack">
          <section className="glass stack">
            <h2>Next up</h2>
            {next ? <p>{next.title}. {calendarBucketLabel(next.dueAt)}.</p> : <p>{gaps.exams}</p>}
            <Link href="/cram">Review an exam proposal</Link>
          </section>
          <section className="glass ask stack">
            <h2>Ask a question</h2>
            <p>Ask about your course. A reply appears only when a model actually answers.</p>
            <Link className="btn amber" href="/companion">Open Study Companion</Link>
          </section>
        </aside>
      </div>
      <div className="row spread">
        <h2>Learning agenda</h2>
        <Link href="/planner">View plan</Link>
      </div>
      {tasks && agenda.length === 0 ? <Empty title="No tasks yet">Confirmed tasks show up here.</Empty> : null}
      {agenda.length > 0 ? (
        <ol className="agenda">
          {agenda.map((task, index) => (
            <li key={task.id}>
              <Link href="/planner">
                <span className="num">{String(index + 1).padStart(2, "0")}</span>
                <span><strong>{task.title}</strong><small>{calendarBucketLabel(task.dueAt)} · {task.confirmed ? "Confirmed" : "Not confirmed"}</small></span>
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="row">
        <button className="btn quiet" type="button" disabled={busy} onClick={() => void startSession()}>Start a study session</button>
        {memory.sessionId ? <button className="btn quiet" type="button" disabled={busy} onClick={() => void completeSession()}>Complete session</button> : null}
      </div>
      {sessionNote && sessionNote !== "offline" ? <Status>{sessionNote}</Status> : null}
    </div>
  );
}
