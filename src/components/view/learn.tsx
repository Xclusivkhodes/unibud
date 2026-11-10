"use client";

import { useState } from "react";
import { Alert, Empty, Field, PageHeader, Status, Unavailable } from "../Bits.js";
import { api, browserOffline, clientToken, errorCode } from "../http.js";
import { gaps, listField, record } from "../present.js";
import { useWorkspace } from "../workspace.js";

type ChatMessage = { id: string; role: string; content: string; status: string };

function readMessage(value: unknown): ChatMessage | null {
  const row = record(value);
  if (!row || typeof row.id !== "string") return null;
  return { id: row.id, role: typeof row.role === "string" ? row.role : "status", content: typeof row.content === "string" ? row.content : "", status: typeof row.status === "string" ? row.status : "" };
}

export function CompanionScreen() {
  const { courseId, memory, updateMemory, online } = useWorkspace();
  const [chatId, setChatId] = useState(memory.chats[0]?.id ?? "");
  const [title, setTitle] = useState("Study question");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(id: string) {
    try {
      setMessages(listField(await api(`/api/chats/${id}/messages`), "messages").flatMap((item) => { const message = readMessage(item); return message ? [message] : []; }));
      setError("");
    } catch (caught) {
      setError(errorCode(caught));
    }
  }

  async function openChat(event: React.FormEvent) {
    event.preventDefault();
    if (!online || browserOffline()) { setError("offline"); return; }
    setBusy(true);
    try {
      const body = record(await api("/api/chats", { method: "POST", body: { title, courseId: courseId || undefined, idempotencyKey: clientToken() } }));
      if (!body || typeof body.id !== "string") { setError("internal"); return; }
      const saved = { id: body.id, title };
      updateMemory((current) => ({ ...current, chats: [...current.chats.filter((item) => item.id !== saved.id), saved] }));
      setChatId(saved.id);
      setMessages([]);
      setNote("Chat opened. It is not in a server list, so it stays in this browser tab.");
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!chatId) return;
    if (!online || browserOffline()) { setError("offline"); return; }
    setBusy(true);
    setError("");
    try {
      const body = record(await api(`/api/chats/${chatId}/messages`, { method: "POST", body: { question, idempotencyKey: clientToken() } }));
      const turn = record(body?.providerTurn);
      const plan = record(body?.plan);
      setNote(`Provider turn ${typeof turn?.status === "string" ? turn.status : "not returned"}. Executed ${turn?.executed === true ? "yes" : "no"}. Assistant messages stored: ${typeof body?.assistantMessages === "number" ? body.assistantMessages : "not returned"}. ${typeof plan?.reason === "string" ? plan.reason : ""}`);
      setQuestion("");
      await load(chatId);
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  async function rename(event: React.FormEvent) {
    event.preventDefault();
    if (!chatId || !online || browserOffline()) { setError("offline"); return; }
    setBusy(true);
    try {
      await api(`/api/chats/${chatId}`, { method: "PATCH", body: { title } });
      updateMemory((current) => ({ ...current, chats: current.chats.map((chat) => chat.id === chatId ? { ...chat, title } : chat) }));
      setNote("Title saved with PATCH.");
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Learn" title="Study Companion" lede="A readable transcript is one work surface. A model reply is shown only when the server stores one. Gemma Study Companion is a search alias, not a separate tool." />
      <p className="meta">{gaps.chats}</p>
      <Alert code={error} />
      <form className="ivory stack" onSubmit={(event) => void openChat(event)}>
        <Field label="Conversation title" name="title" required value={title} onChange={setTitle} />
        <button className="btn amber" type="submit" disabled={busy}>Open a conversation</button>
      </form>
      {memory.chats.length > 0 ? (
        <label className="field stack">Conversation in this tab
          <select value={chatId} onChange={(event) => { setChatId(event.target.value); setMessages(null); }}>
            <option value="">Select</option>
            {memory.chats.map((chat) => <option key={chat.id} value={chat.id}>{chat.title || chat.id}</option>)}
          </select>
        </label>
      ) : <Empty title="No conversation in this tab">Open one to store a question. Nothing is invented.</Empty>}
      {chatId ? (
        <>
          <form className="row" onSubmit={(event) => void rename(event)}>
            <button className="btn quiet" type="submit" disabled={busy}>Rename with the title above</button>
            <button className="btn quiet" type="button" onClick={() => void load(chatId)}>Reload messages</button>
          </form>
          <form className="reading stack" onSubmit={(event) => void ask(event)}>
            <Field label="Question" name="question" type="area" required value={question} onChange={setQuestion} />
            <button className="btn amber" type="submit" disabled={busy}>Store question</button>
          </form>
          {messages && messages.length === 0 ? <Empty title="No messages stored">Ask a question to store one. An empty transcript is not a model answer.</Empty> : null}
          {messages && messages.length > 0 ? (
            <ol className="plain">
              {messages.map((message) => (
                <li key={message.id}><strong>{message.role}</strong>{message.status ? ` · ${message.status}` : ""}<br />{message.content || "No content returned."}</li>
              ))}
            </ol>
          ) : null}
        </>
      ) : null}
      {note ? <Status>{note}</Status> : null}
    </>
  );
}

export function StudioScreen() {
  const { courseId, online } = useWorkspace();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveNote(event: React.FormEvent) {
    event.preventDefault();
    if (!courseId) { setError("not_found"); return; }
    if (!online || browserOffline()) { setError("offline"); return; }
    setBusy(true);
    setError("");
    try {
      await api("/api/sources", { method: "POST", body: { courseId, title, body } });
      setTitle("");
      setBody("");
      setNote("Note saved on the course. The source list shows the title, not the body.");
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!courseId) { setError("not_found"); return; }
    if (!online || browserOffline()) { setError("offline"); return; }
    const file = new FormData(event.currentTarget).get("file");
    if (!(file instanceof File)) { setError("empty_upload"); return; }
    setBusy(true);
    setError("");
    setNote("Upload queued.");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const declaredMime = file.type || "text/plain";
      const result = record(await api("/api/uploads", { method: "POST", body: { dataBase64: btoa(binary), declaredMime, filename: file.name, courseId, idempotencyKey: clientToken() } }));
      setNote(`Upload ${typeof result?.id === "string" ? result.id : "did not return an id"}. MIME ${typeof result?.mime === "string" ? result.mime : declaredMime}. Storage ${typeof result?.storage === "string" ? result.storage : "not returned"}. Text uploads also become a source title. Images are stored without a generated lesson.`);
    } catch (caught) {
      setError(errorCode(caught));
      setNote("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Learn" title="Learning Studio" lede="Eligible files are plain text, Markdown, JPEG, PNG, or WebP. The server reports queued-as-sent, then the completed upload or a recoverable error. There is no generated outline route." />
      {!courseId ? <Empty title="Select a course">A source is saved against the course in the header.</Empty> : null}
      <Alert code={error} />
      <form className="ivory stack" onSubmit={(event) => void saveNote(event)}>
        <h2>Write a note</h2>
        <Field label="Title" name="title" required value={title} onChange={setTitle} />
        <Field label="Note" name="body" type="area" required value={body} onChange={setBody} />
        <button className="btn amber" type="submit" disabled={busy || !courseId}>Save note</button>
      </form>
      <form className="stack ivory" onSubmit={(event) => void upload(event)}>
        <h2>Upload a file</h2>
        <label className="field stack">File<input name="file" type="file" required accept="text/plain,text/markdown,.md,.txt,image/jpeg,image/png,image/webp" /></label>
        <button className="btn quiet" type="submit" disabled={busy || !courseId}>{busy ? "Uploading…" : "Upload"}</button>
      </form>
      {note ? <Status>{note}</Status> : null}
    </>
  );
}

export function ExplainerScreen() {
  return (
    <>
      <PageHeader kicker="Learn" title="Explainer Studio" lede="Adjustable explanations would keep their source and depth. That save route is not in the API." />
      <Unavailable title="Explanations are not stored" detail={gaps.explanations} />
    </>
  );
}

export function CompilerScreen() {
  return (
    <>
      <PageHeader kicker="Learn" title="Academic Compiler" lede="A study pack would keep source links and editable contents. That route is not in the API." />
      <Unavailable title="Study packs are not composed" detail={gaps.packs} />
    </>
  );
}
