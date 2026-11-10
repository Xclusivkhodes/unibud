"use client";

import { useState } from "react";
import { Alert, Empty, Field, PageHeader, PreviewFaultNote, Status } from "../Bits.js";
import { api, browserOffline, errorCode } from "../http.js";
import { calendarBucketLabel, confirmPayload, readAutopilotPreview, readCramPreview, readTask, readTopic, record, reviewPhase, type AutopilotPreview, type CramPreview } from "../present.js";
import { useWorkspace } from "../workspace.js";

function formKeyOf(value: unknown): string {
  return JSON.stringify(value);
}

export function CramScreen() {
  const { courses, courseId, setCourseId, online, updateMemory } = useWorkspace();
  const [title, setTitle] = useState("");
  const [examDate, setExamDate] = useState("");
  const [hours, setHours] = useState("");
  const [syllabus, setSyllabus] = useState("");
  const [topicName, setTopicName] = useState("");
  const [phase, setPhase] = useState<"idle" | "pending" | "ready" | "error" | "offline" | "applied" | "conflict">("idle");
  const [preview, setPreview] = useState<CramPreview | null>(null);
  const [reviewedKey, setReviewedKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [appliedNote, setAppliedNote] = useState("");
  const [busy, setBusy] = useState(false);
  const key = formKeyOf({ courseId, title, examDate, hours, syllabus });
  const shown = reviewPhase({ phase, formKey: key, reviewedKey, empty: false });

  async function requestPreview(event: React.FormEvent) {
    event.preventDefault();
    if (!online || browserOffline()) { setPhase("offline"); setError("offline"); return; }
    setBusy(true);
    setError("");
    setAppliedNote("");
    setPhase("pending");
    try {
      const body = await api("/api/cram/preview", { method: "POST", body: { courseId, title, examDate, availableHours: Number(hours), syllabus } });
      const parsed = readCramPreview(body);
      if (!parsed) { setPhase("error"); setError("internal"); setPreview(null); return; }
      setPreview(parsed);
      setReviewedKey(key);
      setPhase("ready");
    } catch (caught) {
      setPhase("error");
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview) { setError("preview_required"); setPhase("error"); return; }
    if (!online || browserOffline()) { setPhase("offline"); setError("offline"); return; }
    setBusy(true);
    setError("");
    try {
      const body = record(await api("/api/cram/confirm", { method: "POST", body: confirmPayload(preview.previewId) }));
      const taskIds = Array.isArray(body?.taskIds) ? body.taskIds.filter((item) => typeof item === "string") : [];
      setAppliedNote(`Saved. ${taskIds.length} task${taskIds.length === 1 ? "" : "s"} added. ${body?.insufficientTime === true ? "There isn't enough time in the hours you entered. This doesn't predict the paper." : "The hours you entered cover the suggested time."}`);
      setPhase("applied");
    } catch (caught) {
      const code = errorCode(caught);
      setError(code);
      setPhase(code === "conflict" ? "conflict" : "error");
    } finally {
      setBusy(false);
    }
  }

  async function addTopic(event: React.FormEvent) {
    event.preventDefault();
    if (!courseId) { setError("not_found"); return; }
    if (!online || browserOffline()) { setError("offline"); return; }
    setBusy(true);
    setError("");
    try {
      const body = await api(`/api/courses/${courseId}/topics`, { method: "POST", body: { name: topicName, selfReportedLevel: "" } });
      const topic = readTopic(record(body)?.topic);
      if (topic) updateMemory((current) => ({ ...current, topics: [...current.topics.filter((item) => item.id !== topic.id), topic] }));
      setTopicName("");
      setAppliedNote("Topic saved. If a proposal is already on screen, confirming it should be refused and nothing is saved. Ask for a new proposal to include this topic.");
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Exams" title="Exam Cram Sprint" lede="The hours you enter are spread across the days from today to the exam. A short budget is labeled as not enough time. It doesn't predict the paper." />
      <form className="ivory stack" onSubmit={(event) => void requestPreview(event)}>
        <label className="field stack">Course
          <select name="courseId" required value={courseId} onChange={(event) => setCourseId(event.target.value)}>
            <option value="">Select a course</option>
            {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
          </select>
        </label>
        <Field label="Exam title" name="title" required value={title} onChange={setTitle} />
        <Field label="Exam date" name="date" type="date" required value={examDate} onChange={setExamDate} />
        <Field label="Available hours" name="hours" type="number" min="0" step="0.5" required value={hours} onChange={setHours} />
        <Field label="Syllabus notes" name="syllabus" type="area" value={syllabus} onChange={setSyllabus} />
        <button className="btn amber" type="submit" disabled={busy}>{busy && phase === "pending" ? "Preparing preview…" : "Preview proposal"}</button>
      </form>
      {shown === "stale" ? <section className="state state-stale"><p className="kicker">Changed</p><h2>Look at a new proposal</h2><p>You changed the form. Ask for a new proposal before confirming.</p></section> : null}
      {shown === "offline" ? <Alert code="offline" /> : null}
      <PreviewFaultNote code={error} />
      <Alert code={error} />
      {preview ? (
        <section className="glass stack" aria-live="polite">
          <h2>Proposal</h2>
          <p>{preview.title || "Untitled exam"} · {preview.examDate || "No exam date"}.</p>
          <p>From {preview.windowStart ?? "today"} to {preview.windowEnd ?? "the exam"}. Suggested {preview.suggestedMinutes ?? "—"} minutes. The plan uses about {preview.neededMinutes ?? "—"} minutes.</p>
          {preview.insufficientTime ? <p>Insufficient time: the stated hours are below the planner’s topic budget, or the exam day is not in the window. This is not a prediction.</p> : <p>Insufficient time was not flagged.</p>}
          {preview.impossible ? <p>Impossible: there is no calendar day from today through the exam day.</p> : null}
          <p>{preview.predictsFutureQuestions ? "This proposal guesses future questions." : "This proposal does not guess future questions."}</p>
          {preview.priorities.length === 0 ? <Empty title="No topics yet">Add a topic if you want revision tasks. Confirming still saves the exam date.</Empty> : (
            <table>
              <caption>Proposed priorities from your topics. Accuracy is recorded attempts, or blank when there are none.</caption>
              <thead><tr><th>Topic</th><th>Minutes</th><th>Day bucket</th><th>Reason</th></tr></thead>
              <tbody>
                {preview.priorities.map((item) => (
                  <tr key={`${item.topicId}-${item.dueAt ?? "none"}`}>
                    <td>{item.name}{item.accuracy === null ? "" : ` · accuracy ${item.accuracy}`}</td>
                    <td>{item.minutes}</td>
                    <td>{calendarBucketLabel(item.dueAt)}</td>
                    <td>{item.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button className="btn amber" type="button" disabled={busy || shown !== "review" && shown !== "error"} onClick={() => void confirm()}>Confirm this preview</button>
          <p className="meta">Confirm uses the proposal on screen. It does not send the form again.</p>
        </section>
      ) : null}
      {shown === "applied" && appliedNote ? <Status>{appliedNote}</Status> : null}
      {appliedNote && shown !== "applied" ? <Status>{appliedNote}</Status> : null}
      <form className="stack" onSubmit={(event) => void addTopic(event)}>
        <h2>Add a topic after preview</h2>
        <p className="lede">If you add a topic after a proposal is on screen, confirming that proposal should be refused and nothing is saved. Ask for a new proposal to include the topic.</p>
        <Field label="Topic name" name="topicName" required value={topicName} onChange={setTopicName} />
        <button className="btn quiet" type="submit" disabled={busy || !courseId}>Save topic</button>
      </form>
    </>
  );
}

export function AutopilotScreen() {
  const { courses, courseId, setCourseId, online } = useWorkspace();
  const [taskTitle, setTaskTitle] = useState("");
  const [phase, setPhase] = useState<"idle" | "pending" | "ready" | "error" | "offline" | "applied" | "conflict">("idle");
  const [preview, setPreview] = useState<AutopilotPreview | null>(null);
  const [reviewedKey, setReviewedKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const key = formKeyOf({ courseId });
  const shown = reviewPhase({ phase, formKey: key, reviewedKey, empty: false });

  async function requestPreview() {
    if (!courseId) { setError("not_found"); return; }
    if (!online || browserOffline()) { setPhase("offline"); setError("offline"); return; }
    setBusy(true);
    setError("");
    setNote("");
    setPhase("pending");
    try {
      const parsed = readAutopilotPreview(await api("/api/autopilot/preview", { method: "POST", body: { courseId } }));
      if (!parsed) { setPhase("error"); setError("internal"); setPreview(null); return; }
      setPreview(parsed);
      setReviewedKey(key);
      setPhase("ready");
    } catch (caught) {
      setPhase("error");
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview) { setError("preview_required"); setPhase("error"); return; }
    if (!online || browserOffline()) { setError("offline"); setPhase("offline"); return; }
    setBusy(true);
    setError("");
    try {
      const body = record(await api("/api/autopilot/confirm", { method: "POST", body: confirmPayload(preview.previewId) }));
      if (body?.applied === false || body?.status === "conflict") {
        setPhase("conflict");
        setError("conflict");
        return;
      }
      setPhase("applied");
      setNote(`Saved. ${typeof body?.updated === "number" ? body.updated : "Some"} dates updated. Each date is a whole day, not a clock time.`);
    } catch (caught) {
      const code = errorCode(caught);
      setError(code);
      setPhase(code === "conflict" ? "conflict" : "error");
    } finally {
      setBusy(false);
    }
  }

  async function addTask(event: React.FormEvent) {
    event.preventDefault();
    if (!online || browserOffline()) { setError("offline"); return; }
    setBusy(true);
    setError("");
    try {
      const task = readTask(record(await api("/api/tasks", { method: "POST", body: { title: taskTitle, courseId, confirmed: true } }))?.task);
      setTaskTitle("");
      setNote(task ? "Task saved. Confirming a proposal from before this task should be refused, and the dates stay as they are." : "The task was not saved.");
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Plan" title="Academic Autopilot" lede="You'll see your tasks before and after. Nothing moves until you confirm. A task that doesn't fit stays undated, and it won't be placed after the exam." />
      <label className="field stack">Course
        <select name="courseId" required value={courseId} onChange={(event) => setCourseId(event.target.value)}>
          <option value="">Select a course</option>
          {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
        </select>
      </label>
      <button className="btn amber" type="button" disabled={busy || !courseId} onClick={() => void requestPreview()}>{busy && phase === "pending" ? "Preparing preview…" : "Preview proposal"}</button>
      {shown === "stale" ? <section className="state state-stale"><p className="kicker">Changed</p><h2>The course changed</h2><p>Ask for a proposal for the course you selected now.</p></section> : null}
      {shown === "offline" ? <Alert code="offline" /> : null}
      {shown === "conflict" ? <section className="state state-denied" role="alert"><p className="kicker">Needs another look</p><h2>Dates were not changed</h2><p>A newer copy of a task exists. Ask for a new proposal.</p></section> : null}
      <PreviewFaultNote code={error} />
      <Alert code={error === "conflict" ? "" : error} />
      {preview ? (
        <section className="glass stack">
          <h2>Proposal</h2>
          <p>Dates are whole days, not clock times. From {preview.windowStart ?? "today"} to {preview.windowEnd ?? "the exam"}.</p>
          {preview.impossible ? <p>At least one open task could not be placed inside the window.</p> : <p>Every returned row was placed, or there were no open tasks.</p>}
          {preview.conflicts.length > 0 ? <p>Outside the previous window: {preview.conflicts.join(", ")}.</p> : <p>No outside-window conflicts were returned.</p>}
          {preview.after.length === 0 ? <Empty title="No open tasks">Add a confirmed task, then ask for a new proposal.</Empty> : (
            <table>
              <caption>Before and after. Nothing moves until you confirm.</caption>
              <thead><tr><th>Task</th><th>Before</th><th>After</th><th>Placed</th></tr></thead>
              <tbody>
                {preview.after.map((row) => {
                  const prior = preview.before.find((item) => item.id === row.id);
                  return (
                    <tr key={row.id}>
                      <td>{row.title || prior?.title || row.id}</td>
                      <td>{calendarBucketLabel(prior?.dueAt ?? null)}</td>
                      <td>{calendarBucketLabel(row.dueAt)}{row.changed ? " · would change" : ""}</td>
                      <td>{row.placed === false ? "Not placed" : row.placed === true ? "Placed" : "Not returned"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <button className="btn amber" type="button" disabled={busy || (shown !== "review" && shown !== "error")} onClick={() => void confirm()}>Confirm this preview</button>
        </section>
      ) : null}
      {note ? <Status>{note}</Status> : null}
      <form className="ivory stack" onSubmit={(event) => void addTask(event)}>
        <h2>Add a task after preview</h2>
        <Field label="Task" name="taskTitle" required value={taskTitle} onChange={setTaskTitle} />
        <button className="btn quiet" type="submit" disabled={busy || !courseId}>Save confirmed task</button>
      </form>
    </>
  );
}
