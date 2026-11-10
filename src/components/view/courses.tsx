"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Empty, Field, Loading, PageHeader, Status } from "../Bits.js";
import { api, browserOffline, errorCode } from "../http.js";
import { gaps, listField, readCourse, readSource, readTopic, record, type SourceView } from "../present.js";
import { useWorkspace } from "../workspace.js";

export function CoursesScreen() {
  const { courses, coursesStatus, coursesError, refreshCourses, setCourseId, online } = useWorkspace();
  const [name, setName] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [goal, setGoal] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!online || browserOffline()) { setError("offline"); return; }
    setBusy(true);
    setError("");
    try {
      const body = await api("/api/courses", { method: "POST", body: { name, subjectName, goal } });
      const course = readCourse(record(body)?.course);
      setName("");
      setSubjectName("");
      setGoal("");
      await refreshCourses();
      if (course) setCourseId(course.id);
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Workspace" title="Courses" lede="A course is the context for topics, sources, and practice. This list is your account, not a sample catalogue." />
      {coursesStatus === "loading" ? <Loading label="Loading courses…" /> : null}
      {coursesStatus === "error" ? <Alert code={coursesError || "internal"} /> : null}
      <Alert code={error} />
      {coursesStatus === "ready" && courses.length === 0 ? <Empty title="No courses yet">Add a course to open a workspace. Empty is not an error.</Empty> : null}
      {courses.length > 0 ? (
        <ul className="agenda">
          {courses.map((course, index) => (
            <li key={course.id}>
              <Link href={`/courses/${course.id}`} onClick={() => setCourseId(course.id)}>
                <span className="num">{String(index + 1).padStart(2, "0")}</span>
                <span><strong>{course.name}</strong><small>{course.subject || "No subject name"}{course.goal ? ` · ${course.goal}` : ""}</small></span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="ivory stack" onSubmit={(event) => void save(event)}>
        <h2>Add a course</h2>
        <Field label="Course name" name="name" required value={name} onChange={setName} />
        <Field label="Subject name, optional" name="subjectName" value={subjectName} onChange={setSubjectName} />
        <Field label="Goal, optional" name="goal" value={goal} onChange={setGoal} />
        <button className="btn amber" type="submit" disabled={busy}>{busy ? "Saving…" : "Save course"}</button>
      </form>
    </>
  );
}

export function CourseScreen({ courseId }: { courseId: string }) {
  const { memory, updateMemory, online, setCourseId } = useWorkspace();
  const [courseName, setCourseName] = useState("");
  const [subject, setSubject] = useState("");
  const [goal, setGoal] = useState("");
  const [phase, setPhase] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [error, setError] = useState("");
  const [sources, setSources] = useState<SourceView[] | null>(null);
  const [topicName, setTopicName] = useState("");
  const [level, setLevel] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceBody, setSourceBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const topics = memory.topics.filter((topic) => topic.courseId === courseId);

  async function load() {
    setError("");
    try {
      const body = await api(`/api/courses/${courseId}`);
      const course = readCourse(record(body)?.course);
      if (!course) { setPhase("missing"); return; }
      setCourseName(course.name);
      setSubject(course.subject);
      setGoal(course.goal);
      setCourseId(course.id);
      setPhase("ready");
      const listed = await api(`/api/sources?courseId=${encodeURIComponent(course.id)}`);
      setSources(listField(listed, "sources").flatMap((item) => { const source = readSource(item); return source ? [source] : []; }));
    } catch (caught) {
      const code = errorCode(caught);
      if (code === "not_found") setPhase("missing");
      else { setError(code); setPhase("error"); }
    }
  }

  useEffect(() => { void load(); }, [courseId]);

  async function addTopic(event: React.FormEvent) {
    event.preventDefault();
    if (!online || browserOffline()) { setError("offline"); return; }
    setBusy(true);
    setError("");
    try {
      const body = await api(`/api/courses/${courseId}/topics`, { method: "POST", body: { name: topicName, selfReportedLevel: level } });
      const topic = readTopic(record(body)?.topic);
      if (topic) updateMemory((current) => ({ ...current, topics: [...current.topics.filter((item) => item.id !== topic.id), topic] }));
      setTopicName("");
      setLevel("");
      setNote(topic ? "Topic saved. It stays on this page for this visit." : "The topic wasn't saved.");
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  async function addSource(event: React.FormEvent) {
    event.preventDefault();
    if (!online || browserOffline()) { setError("offline"); return; }
    setBusy(true);
    setError("");
    try {
      await api("/api/sources", { method: "POST", body: { courseId, title: sourceTitle, body: sourceBody } });
      setSourceTitle("");
      setSourceBody("");
      const listed = await api(`/api/sources?courseId=${encodeURIComponent(courseId)}`);
      setSources(listField(listed, "sources").flatMap((item) => { const source = readSource(item); return source ? [source] : []; }));
      setNote("Note saved. The list shows the title.");
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Course workspace" title={courseName || "Course"} lede={phase === "ready" ? `${subject || "No subject name"}${goal ? `. Goal: ${goal}` : ""}` : "Loading the course on this account."} />
      {phase === "loading" ? <Loading label="Loading course…" /> : null}
      {phase === "missing" ? <Empty title="Course not available">That course is not on this account.</Empty> : null}
      <Alert code={error} />
      {phase === "ready" ? (
        <>
          <p className="meta">{gaps.topics}</p>
          {topics.length === 0 ? <Empty title="No topics in this tab">Add a topic to attach later practice. The level you type is self-reported, not a measured score.</Empty> : (
            <ul className="plain">{topics.map((topic) => <li key={topic.id}><strong>{topic.name}</strong> · self-reported level {topic.selfReportedLevel || "not set"} · id {topic.id}</li>)}</ul>
          )}
          <form className="ivory stack" onSubmit={(event) => void addTopic(event)}>
            <h2>Add a topic</h2>
            <Field label="Topic name" name="topicName" required value={topicName} onChange={setTopicName} />
            <Field label="Self-reported level, optional" name="level" value={level} onChange={setLevel} />
            <button className="btn amber" type="submit" disabled={busy}>Save topic</button>
          </form>
          <h2>Sources</h2>
          <p className="meta">{gaps.sourceBody}</p>
          {sources && sources.length === 0 ? <Empty title="No sources">Notes you save for this course show their titles here.</Empty> : null}
          {sources && sources.length > 0 ? <ul className="plain">{sources.map((source) => <li key={source.id}>{source.title}</li>)}</ul> : null}
          <form className="stack ivory" onSubmit={(event) => void addSource(event)}>
            <h2>Add a note</h2>
            <Field label="Title" name="sourceTitle" required value={sourceTitle} onChange={setSourceTitle} />
            <Field label="Note" name="sourceBody" type="area" required value={sourceBody} onChange={setSourceBody} />
            <button className="btn quiet" type="submit" disabled={busy}>Save note</button>
          </form>
          {note ? <Status>{note}</Status> : null}
          <Link href="/studio">Open Learning Studio</Link>
        </>
      ) : null}
    </>
  );
}
