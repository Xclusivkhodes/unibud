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
      setAppliedNote(`Confirmed. Exam id ${typeof body?.examId === "string" ? body.examId : "was not returned"}. Tasks created: ${taskIds.length}. ${body?.insufficientTime === true ? "The budget was labeled insufficient. This does not predict the paper." : "Insufficient time was not flagged."}`);
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
      setAppliedNote("Topic saved. If a preview is already on screen, confirming it should return stale_preview because the topic list changed. Request a new preview to include it.");
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Exams" title="Exam Cram Sprint" lede="Minutes come from the hours you enter and are dated between today and the exam as calendar-day buckets, not appointments. A short budget is labeled insufficient. It does not predict the paper." />
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
      {shown === "stale" ? <section className="state state-stale"><p className="kicker">Form changed</p><h2>Review a new preview</h2><p>The form changed after this proposal. Confirmation stays off until you request a preview of the current form. This is not the server stale_preview response.</p></section> : null}
      {shown === "offline" ? <Alert code="offline" /> : null}
      <PreviewFaultNote code={error} />
      <Alert code={error} />
      {preview ? (
        <section className="glass stack" aria-live="polite">
          <h2>Proposal</h2>
          <p>{preview.title || "Untitled exam"} · {preview.examDate || "No exam date returned"} · due semantics {preview.dueSemantics || "not returned"}.</p>
          <p>Window {preview.windowStart ?? "none"} to {preview.windowEnd ?? "none"}. Suggested minutes {preview.suggestedMinutes ?? "not returned"}. Needed minutes {preview.neededMinutes ?? "not returned"}.</p>
          {preview.insufficientTime ? <p>Insufficient time: the stated hours are below the planner’s topic budget, or the exam day is not in the window. This is not a prediction.</p> : <p>Insufficient time was not flagged.</p>}
          {preview.impossible ? <p>Impossible: there is no calendar day from today through the exam day.</p> : null}
          <p>Predicts future questions: {preview.predictsFutureQuestions === null ? "not returned" : preview.predictsFutureQuestions ? "yes" : "no"}.</p>
          {preview.priorities.length === 0 ? <Empty title="No topic priorities">This course has no topics, so the proposal schedules nothing. Confirming still saves the exam and creates no revision tasks.</Empty> : (
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
          <p className="meta">Confirm sends only the preview id. It does not resend the form.</p>
        </section>
      ) : null}
      {shown === "applied" && appliedNote ? <Status>{appliedNote}</Status> : null}
      {appliedNote && shown !== "applied" ? <Status>{appliedNote}</Status> : null}
      <form className="stack" onSubmit={(event) => void addTopic(event)}>
        <h2>Add a topic after preview</h2>
        <p className="lede">Adding a topic changes the records a cram preview was based on. Confirming the preview already on screen then returns stale_preview and writes nothing.</p>
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
      setNote(`Applied. Updated rows: ${typeof body?.updated === "number" ? body.updated : "not returned"}. Due semantics ${typeof body?.dueSemantics === "string" ? body.dueSemantics : "not returned"}.`);
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
      setNote(task ? "Task saved. Confirming a preview issued before this task should return stale_preview and leave dates unchanged." : "The server did not return a task row.");
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Plan" title="Academic Autopilot" lede="A proposal shows the open tasks before and after. Nothing moves until you confirm that preview. Tasks that cannot fit stay unplaced and are not given a date after the exam." />
      <label className="field stack">Course
        <select name="courseId" required value={courseId} onChange={(event) => setCourseId(event.target.value)}>
          <option value="">Select a course</option>
          {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
        </select>
      </label>
      <button className="btn amber" type="button" disabled={busy || !courseId} onClick={() => void requestPreview()}>{busy && phase === "pending" ? "Preparing preview…" : "Preview proposal"}</button>
      {shown === "stale" ? <section className="state state-stale"><p className="kicker">Form changed</p><h2>The course changed</h2><p>Request a preview for the course now selected. Confirmation of the previous proposal stays off.</p></section> : null}
      {shown === "offline" ? <Alert code="offline" /> : null}
      {shown === "conflict" ? <section className="state state-denied" role="alert"><p className="kicker">conflict · 409</p><h2>Dates were not changed</h2><p>The server found a revision conflict and did not overwrite the newer task. Request a new preview.</p></section> : null}
      <PreviewFaultNote code={error} />
      <Alert code={error === "conflict" ? "" : error} />
      {preview ? (
        <section className="glass stack">
          <h2>Proposal</h2>
          <p>Due semantics {preview.dueSemantics || "not returned"}. Window {preview.windowStart ?? "none"} to {preview.windowEnd ?? "none"}.</p>
          {preview.impossible ? <p>At least one open task could not be placed inside the window.</p> : <p>Every returned row was placed, or there were no open tasks.</p>}
          {preview.conflicts.length > 0 ? <p>Outside the previous window: {preview.conflicts.join(", ")}.</p> : <p>No outside-window conflicts were returned.</p>}
          {preview.after.length === 0 ? <Empty title="No open tasks">Autopilot has nothing to date for this course. Add a confirmed task, then request a new preview.</Empty> : (
            <table>
              <caption>Before and after day buckets. Changed rows are proposals until you confirm.</caption>
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
