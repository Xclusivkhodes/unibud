"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Empty, Field, Loading, PageHeader, Status } from "../Bits.js";
import { api, browserOffline, clientToken, errorCode } from "../http.js";
import { gaps, listField, readTask, record, type TaskView } from "../present.js";
import { useWorkspace } from "../workspace.js";

type CardRow = { id: string; deckId: string; front: string; back: string; dueAt: string | null };

function readCard(value: unknown): CardRow | null {
  const row = record(value);
  if (!row || typeof row.id !== "string" || typeof row.front !== "string") return null;
  return {
    id: row.id,
    deckId: typeof row.deck_id === "string" ? row.deck_id : "",
    front: row.front,
    back: typeof row.back === "string" ? row.back : "",
    dueAt: typeof row.due_at === "string" ? row.due_at : null,
  };
}

export function PracticeScreen() {
  const { courses, courseId, memory, updateMemory, online } = useWorkspace();
  const [prompt, setPrompt] = useState("");
  const [choiceA, setChoiceA] = useState("");
  const [choiceB, setChoiceB] = useState("");
  const [correctIndex, setCorrectIndex] = useState("0");
  const [topicId, setTopicId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const topics = memory.topics.filter((topic) => topic.courseId === courseId);
  const questions = memory.questions.filter((question) => !courseId || question.courseId === courseId);

  async function saveQuestion(event: React.FormEvent) {
    event.preventDefault();
    if (!online || browserOffline()) { setError("offline"); return; }
    setBusy(true);
    setError("");
    try {
      const body = record(await api("/api/questions", { method: "POST", body: { courseId, topicId: topicId || undefined, prompt, choices: [choiceA, choiceB], correctIndex: Number(correctIndex), label: "learner_authored" } }));
      if (!body || typeof body.id !== "string") { setError("internal"); return; }
      const saved = { id: body.id, courseId, topicId, prompt, choices: [choiceA, choiceB] };
      updateMemory((current) => ({ ...current, questions: [...current.questions.filter((item) => item.id !== saved.id), saved] }));
      setPrompt("");
      setChoiceA("");
      setChoiceB("");
      setResult("Question saved. The server returned an id only. The prompt below is the text you typed.");
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  async function answer(questionId: string, selectedIndex: number) {
    const question = questions.find((item) => item.id === questionId);
    if (!question) return;
    if (!online || browserOffline()) { setError("offline"); return; }
    setBusy(true);
    setError("");
    try {
      const opened = record(await api("/api/attempts", { method: "POST", body: { courseId: question.courseId, topicId: question.topicId || undefined, kind: "practice", timingMode: "untimed", clientToken: clientToken() } }));
      const attemptId = typeof opened?.id === "string" ? opened.id : "";
      if (!attemptId) { setError("internal"); return; }
      const marked = record(await api(`/api/attempts/${attemptId}/answers`, { method: "POST", body: { questionId, selectedIndex } }));
      const submitted = record(await api(`/api/attempts/${attemptId}/submit`, { method: "POST", body: {} }));
      const attempt = record(submitted?.attempt);
      const correct = marked?.correct === true;
      if (!correct) {
        updateMemory((current) => ({
          ...current,
          missed: [...current.missed.filter((item) => item.questionId !== questionId), { questionId, prompt: question.prompt, courseId: question.courseId, topicId: question.topicId }],
        }));
      }
      setResult(`Objective key: ${correct ? "matched" : "did not match"}. Submitted score ${typeof attempt?.score_correct === "number" ? attempt.score_correct : "not returned"} / ${typeof attempt?.score_total === "number" ? attempt.score_total : "not returned"}. ${gaps.attempts}`);
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Practice" title="Practice and Quiz" lede="One question at a time. The mark uses the answer key you stored. It is not a self-rating and it is not mastery." />
      <p className="meta">{gaps.questions}</p>
      <Alert code={error} />
      {!courseId ? <Empty title="Select a course">Choose a course in the header before saving a question.</Empty> : null}
      <form className="ivory stack" onSubmit={(event) => void saveQuestion(event)}>
        <h2>Write a question</h2>
        <label className="field stack">Topic, optional
          <select value={topicId} onChange={(event) => setTopicId(event.target.value)}>
            <option value="">No topic</option>
            {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
          </select>
        </label>
        <Field label="Prompt" name="prompt" type="area" required value={prompt} onChange={setPrompt} />
        <Field label="Choice A" name="choiceA" required value={choiceA} onChange={setChoiceA} />
        <Field label="Choice B" name="choiceB" required value={choiceB} onChange={setChoiceB} />
        <label className="field stack">Correct choice
          <select value={correctIndex} onChange={(event) => setCorrectIndex(event.target.value)}>
            <option value="0">Choice A</option>
            <option value="1">Choice B</option>
          </select>
        </label>
        <button className="btn amber" type="submit" disabled={busy || !courseId}>Save question</button>
      </form>
      {questions.length === 0 ? <Empty title="No questions in this tab">Questions you save during this visit can be answered here. They are not loaded from a list.</Empty> : (
        <div className="stack">
          {questions.map((question) => (
            <form key={question.id} className="reading stack" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void answer(question.id, Number(data.get("selected"))); }}>
              <h2>{question.prompt}</h2>
              <p className="meta">Text you entered with id {question.id}.</p>
              {question.choices.map((choice, index) => (
                <label key={`${question.id}-${index}`}><input type="radio" name="selected" value={index} required /> {choice}</label>
              ))}
              <button className="btn amber" type="submit" disabled={busy}>Submit answer</button>
            </form>
          ))}
        </div>
      )}
      {result ? <Status>{result}</Status> : null}
    </>
  );
}

export function CardsScreen() {
  const { courseId, memory, updateMemory, online } = useWorkspace();
  const [title, setTitle] = useState("");
  const [deckId, setDeckId] = useState(memory.decks[0]?.id ?? "");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setCards(listField(await api("/api/cards"), "cards").flatMap((item) => { const card = readCard(item); return card ? [card] : []; }));
      setError("");
    } catch (caught) {
      setError(errorCode(caught));
    }
  }

  useEffect(() => { void load(); }, []);

  async function createDeck(event: React.FormEvent) {
    event.preventDefault();
    if (!online || browserOffline()) { setError("offline"); return; }
    setBusy(true);
    try {
      const deck = record(record(await api("/api/decks", { method: "POST", body: { title, courseId: courseId || undefined, idempotencyKey: clientToken() } }))?.deck);
      if (deck && typeof deck.id === "string") {
        const saved = { id: deck.id, title: typeof deck.title === "string" ? deck.title : title };
        updateMemory((current) => ({ ...current, decks: [...current.decks.filter((item) => item.id !== saved.id), saved] }));
        setDeckId(saved.id);
        setTitle("");
        setNote("Deck saved. Decks are not listed by the server, so this title stays in this browser tab.");
      }
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  async function addCard(event: React.FormEvent) {
    event.preventDefault();
    if (!online || browserOffline()) { setError("offline"); return; }
    setBusy(true);
    try {
      await api(`/api/decks/${deckId}/cards`, { method: "POST", body: { front, back, idempotencyKey: clientToken() } });
      setFront("");
      setBack("");
      await load();
      setNote("Card saved.");
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  async function review(cardId: string, quality: string) {
    if (!online || browserOffline()) { setError("offline"); return; }
    setBusy(true);
    try {
      const body = record(await api(`/api/cards/${cardId}/reviews`, { method: "POST", body: { quality: Number(quality), revealed: true, scoringMethod: "self_rated", idempotencyKey: clientToken() } }));
      setNote(`Self-rated recall. Scheduler ${typeof body?.scheduler === "string" ? body.scheduler : "not returned"}. Next due ${typeof body?.dueAt === "string" ? body.dueAt : "not returned"}. Mastery ${body?.mastery === null ? "null" : "not returned as null"}.`);
      await load();
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Practice" title="Flashcard Studio" lede="Show the answer before you rate it. The rating is self-rated recall, not an objective mark." />
      <Alert code={error} />
      <form className="ivory stack" onSubmit={(event) => void createDeck(event)}>
        <h2>New deck</h2>
        <Field label="Deck title" name="title" required value={title} onChange={setTitle} />
        <button className="btn quiet" type="submit" disabled={busy}>Save deck</button>
      </form>
      <form className="stack ivory" onSubmit={(event) => void addCard(event)}>
        <h2>Add a card</h2>
        <label className="field stack">Deck
          <select required value={deckId} onChange={(event) => setDeckId(event.target.value)}>
            <option value="">Select a deck saved in this tab</option>
            {memory.decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.title}</option>)}
          </select>
        </label>
        <Field label="Front" name="front" required value={front} onChange={setFront} />
        <Field label="Back" name="back" type="area" required value={back} onChange={setBack} />
        <button className="btn amber" type="submit" disabled={busy || !deckId}>Save card</button>
      </form>
      {cards === null ? <Loading label="Loading cards…" /> : null}
      {cards && cards.length === 0 ? <Empty title="No cards">Cards you save are listed from this account.</Empty> : null}
      {cards?.map((card) => (
        <form key={card.id} className="reading stack" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void review(card.id, String(data.get("quality") ?? "")); }}>
          <p>{card.front}</p>
          {revealed[card.id] ? <p>{card.back}</p> : <button className="btn quiet" type="button" onClick={() => setRevealed((current) => ({ ...current, [card.id]: true }))}>Show answer</button>}
          <label>Self-rating 0–5<input name="quality" type="number" min="0" max="5" required disabled={!revealed[card.id]} /></label>
          <button className="btn amber" type="submit" disabled={busy || !revealed[card.id]}>Record review</button>
        </form>
      ))}
      {note ? <Status>{note}</Status> : null}
      <Link href="/memory">Open Memory Studio</Link>
    </>
  );
}

export function MemoryScreen() {
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/api/cards").then((body) => {
      setCards(listField(body, "cards").flatMap((item) => { const card = readCard(item); return card ? [card] : []; }));
    }).catch((caught: unknown) => setError(errorCode(caught)));
  }, []);
  const now = Date.now();
  const due = (cards ?? []).filter((card) => !card.dueAt || Date.parse(card.dueAt) <= now);
  return (
    <>
      <PageHeader kicker="Practice" title="Memory Studio" lede="Due cards use the same review log as Flashcard Studio. A missing due time is treated as due." />
      <Alert code={error} />
      {cards === null && !error ? <Loading label="Loading cards…" /> : null}
      {cards && due.length === 0 ? <Empty title="Nothing due">No card is due. That is an empty queue, not a fetch failure.</Empty> : null}
      <ul className="plain">{due.map((card) => <li key={card.id}>{card.front} · due {card.dueAt ?? "now"}</li>)}</ul>
      <Link href="/cards">Review in Flashcard Studio</Link>
    </>
  );
}

export function StressScreen() {
  const { memory } = useWorkspace();
  return (
    <>
      <PageHeader kicker="Practice" title="Knowledge Stress Test" lede="This is not a validated psychometric measure. Missed prompts are not listed by the server." />
      <p className="meta">A question you answered incorrectly in this browser tab can be retried from Practice. Hypotheses with repeated misses are on Misconception Radar.</p>
      {memory.missed.length === 0 ? <Empty title="No missed questions in this tab">Answer a practice question first. A wrong mark is kept only in this browser, beside the prompt you typed.</Empty> : (
        <ul className="plain">{memory.missed.map((item) => <li key={item.questionId}>{item.prompt}</li>)}</ul>
      )}
      <Link href="/practice">Open Practice and Quiz</Link>
      <Link href="/radar">Open Misconception Radar</Link>
    </>
  );
}

export function PlannerScreen() {
  const { courses, courseId, online } = useWorkspace();
  const [tasks, setTasks] = useState<TaskView[] | null>(null);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setTasks(listField(await api("/api/tasks"), "tasks").flatMap((item) => { const task = readTask(item); return task ? [task] : []; }));
      setError("");
    } catch (caught) {
      setError(errorCode(caught));
    }
  }

  useEffect(() => { void load(); }, []);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!online || browserOffline()) { setError("offline"); return; }
    setBusy(true);
    try {
      await api("/api/tasks", { method: "POST", body: { title, courseId: courseId || undefined, dueAt: due ? new Date(due).toISOString() : undefined, confirmed: true } });
      setTitle("");
      setDue("");
      await load();
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Plan" title="Study Planner" lede="The agenda is the list the server returns. There is no drag-and-drop, and completion is not an HTTP route." />
      <Alert code={error} />
      <p className="meta">{gaps.taskComplete}</p>
      <form className="ivory stack" onSubmit={(event) => void add(event)}>
        <p className="meta">Course context: {courses.find((course) => course.id === courseId)?.name ?? "none selected"}.</p>
        <Field label="Task" name="title" required value={title} onChange={setTitle} />
        <Field label="Due, optional" name="due" type="datetime-local" value={due} onChange={setDue} />
        <button className="btn amber" type="submit" disabled={busy}>Add confirmed task</button>
      </form>
      {tasks === null && !error ? <Loading label="Loading tasks…" /> : null}
      {tasks && tasks.length === 0 ? <Empty title="No tasks">Confirmed tasks you add, including cram revisions, show up here.</Empty> : null}
      {tasks && tasks.length > 0 ? (
        <ol className="agenda">
          {tasks.map((task, index) => (
            <li key={task.id}>
              <span className="num">{String(index + 1).padStart(2, "0")}</span>
              <span><strong>{task.title}</strong><small>{task.status} · {task.confirmed ? "Confirmed" : "Not confirmed"} · {task.dueAt ?? "No due time"}</small></span>
            </li>
          ))}
        </ol>
      ) : null}
    </>
  );
}
