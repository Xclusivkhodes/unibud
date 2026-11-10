"use client";

import { useEffect, useState } from "react";
import { Alert, Empty, Field, Loading, PageHeader, Status } from "../Bits.js";
import { api, browserOffline, clientToken, errorCode } from "../http.js";
import { gaps, listField, providerStudentStatus, record, text } from "../present.js";
import type { ProviderPublicStatus, YoutubePublicStatus } from "../../contract/types.js";
import { useWorkspace } from "../workspace.js";

export function LabScreen() {
  const { courseId, online } = useWorkspace();
  const [speed, setSpeed] = useState("10");
  const [degrees, setDegrees] = useState("45");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [runs, setRuns] = useState<Array<{ id: string; lab: string; assumptions: string }> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/labs").then((body) => {
      setRuns(listField(body, "runs").flatMap((item) => {
        const row = record(item);
        if (!row || typeof row.id !== "string") return [];
        return [{ id: row.id, lab: text(row.lab), assumptions: text(row.assumptions) }];
      }));
    }).catch((caught: unknown) => setError(errorCode(caught)));
  }, []);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (!online || browserOffline()) { setError("offline"); return; }
    setBusy(true);
    setError("");
    try {
      const body = record(await api("/api/labs/projectile", { method: "POST", body: { speed: Number(speed), degrees: Number(degrees), courseId: courseId || undefined, idempotencyKey: clientToken() } }));
      const range = record(body?.result);
      setResult(typeof range?.rangeMeters === "number" ? `Range ${range.rangeMeters} m. ${text(body?.assumptions)}` : "The run didn't return a range.");
      const listed = await api("/api/labs");
      setRuns(listField(listed, "runs").flatMap((item) => {
        const row = record(item);
        if (!row || typeof row.id !== "string") return [];
        return [{ id: row.id, lab: text(row.lab), assumptions: text(row.assumptions) }];
      }));
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Explore" title="Reality Lab" lede="Projectile motion uses the speed and angle you enter. Reset by changing the inputs and running again. The numeric result is for the run you just calculated." />
      <p className="meta">{gaps.otherLabs}</p>
      <Alert code={error} />
      <form className="ivory stack" onSubmit={(event) => void run(event)}>
        <Field label="Speed (m/s)" name="speed" type="number" min="0" step="any" required value={speed} onChange={setSpeed} />
        <Field label="Angle (degrees)" name="degrees" type="number" min="0" max="90" step="any" required value={degrees} onChange={setDegrees} />
        <button className="btn amber" type="submit" disabled={busy}>Run projectile</button>
      </form>
      {result ? (
        <table>
          <caption>Latest projectile result</caption>
          <tbody><tr><th scope="row">Result</th><td>{result}</td></tr></tbody>
        </table>
      ) : null}
      {runs === null && !error ? <Loading label="Loading saved runs…" /> : null}
      {runs && runs.length === 0 ? <Empty title="No saved runs">A run shows up here after you calculate one. Older runs list the lab and its assumptions.</Empty> : null}
      {runs && runs.length > 0 ? <ul className="plain">{runs.map((runItem) => <li key={runItem.id}>{runItem.lab || "Unnamed lab"} · {runItem.assumptions || "No assumptions returned"}</li>)}</ul> : null}
    </>
  );
}

export function LensScreen() {
  const [mode, setMode] = useState<"text" | "image">("text");
  const [consent, setConsent] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = record(await api("/api/lens", { method: "POST", body: { mode, consent } }));
      const status = text(body?.status) || "not returned";
      setNote(status === "denied" ? "Image exploration isn't available. You can still describe the idea in text." : status === "text_only" ? "Text was accepted. This is not an image analysis." : "No image reading was produced.");
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Explore" title="Reality Lens" lede="Image exploration stays unavailable unless a capability is actually returned. Text input does not become an image analysis." />
      <form className="ivory stack" onSubmit={(event) => void submit(event)}>
        <fieldset className="stack">
          <legend>Mode</legend>
          <label><input type="radio" name="mode" checked={mode === "text"} onChange={() => setMode("text")} /> Text</label>
          <label><input type="radio" name="mode" checked={mode === "image"} onChange={() => setMode("image")} /> Image</label>
        </fieldset>
        <label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> I consent to an image check if one is available</label>
        <button className="btn amber" type="submit" disabled={busy}>Ask for a decision</button>
      </form>
      <Alert code={error} />
      {note ? <Status>{note}</Status> : null}
    </>
  );
}

export function UniverseScreen() {
  const { memory, online } = useWorkspace();
  const [label, setLabel] = useState("");
  const [topicId, setTopicId] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [origin, setOrigin] = useState<"learner" | "inferred">("learner");
  const [nodes, setNodes] = useState<Array<{ id: string; label: string; topicId: string }>>([]);
  const [edges, setEdges] = useState<Array<{ id: string; from: string; to: string; origin: string; verification: string }>>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try {
      const body = await api("/api/graph");
      setNodes(listField(body, "nodes").flatMap((item) => {
        const row = record(item);
        if (!row || typeof row.id !== "string") return [];
        return [{ id: row.id, label: text(row.label), topicId: text(row.topic_id) }];
      }));
      setEdges(listField(body, "edges").flatMap((item) => {
        const row = record(item);
        if (!row || typeof row.id !== "string") return [];
        return [{ id: row.id, from: text(row.from_id), to: text(row.to_id), origin: text(row.origin), verification: text(row.academic_verification) }];
      }));
      setLoaded(true);
      setError("");
    } catch (caught) {
      setError(errorCode(caught));
    }
  }

  useEffect(() => { void load(); }, []);

  async function addNode(event: React.FormEvent) {
    event.preventDefault();
    if (!online || browserOffline()) { setError("offline"); return; }
    try {
      await api("/api/graph/nodes", { method: "POST", body: { label, topicId: topicId || undefined, idempotencyKey: clientToken() } });
      setLabel("");
      await load();
    } catch (caught) {
      setError(errorCode(caught));
    }
  }

  async function addEdge(event: React.FormEvent) {
    event.preventDefault();
    if (!online || browserOffline()) { setError("offline"); return; }
    try {
      await api("/api/graph/edges", { method: "POST", body: { fromId, toId, origin, idempotencyKey: clientToken() } });
      await load();
    } catch (caught) {
      setError(errorCode(caught));
    }
  }

  return (
    <>
      <PageHeader kicker="Explore" title="Knowledge Universe" lede="Concepts are a list you can edit. An inferred edge is not an academically verified prerequisite." />
      <Alert code={error} />
      {loaded && nodes.length === 0 ? <Empty title="No concepts yet">Add a name to start your list.</Empty> : null}
      <ul className="plain">{nodes.map((node) => <li key={node.id}>{node.label || "Untitled"} · {node.id}{node.topicId ? ` · topic ${node.topicId}` : ""}</li>)}</ul>
      <ul className="plain">{edges.map((edge) => <li key={edge.id}>{edge.from} → {edge.to} · {edge.origin === "inferred" ? "Suggested by you as a guess" : "Added by you"} · {edge.verification === "not_verified" || !edge.verification ? "Not an academically checked link" : edge.verification}</li>)}</ul>
      <form className="ivory stack" onSubmit={(event) => void addNode(event)}>
        <h2>Add a concept</h2>
        <Field label="Label" name="label" required value={label} onChange={setLabel} />
        <label className="field stack">Topic in this tab, optional
          <select value={topicId} onChange={(event) => setTopicId(event.target.value)}>
            <option value="">None</option>
            {memory.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
          </select>
        </label>
        <button className="btn amber" type="submit">Save concept</button>
      </form>
      <form className="stack ivory" onSubmit={(event) => void addEdge(event)}>
        <h2>Link two concepts</h2>
        <Field label="From id" name="fromId" required value={fromId} onChange={setFromId} />
        <Field label="To id" name="toId" required value={toId} onChange={setToId} />
        <label className="field stack">Origin
          <select value={origin} onChange={(event) => setOrigin(event.target.value === "inferred" ? "inferred" : "learner")}>
            <option value="learner">Learner</option>
            <option value="inferred">Inferred, not academically verified</option>
          </select>
        </label>
        <button className="btn quiet" type="submit">Save link</button>
      </form>
    </>
  );
}

export function ResourcesScreen() {
  const [youtube, setYoutube] = useState<YoutubePublicStatus | null>(null);
  const [providers, setProviders] = useState<ProviderPublicStatus[] | null>(null);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    Promise.all([api("/api/youtube/status"), api("/api/providers")]).then(([videoBody, providerBody]) => {
      const video = record(videoBody);
      if (video && (video.search === "unconfigured" || video.search === "not_executed") && video.captionDownload === false) {
        setYoutube({ configured: video.configured === true, search: video.search, captionDownload: false, captionReason: text(video.captionReason) });
      }
      setChecked(true);
      setProviders(listField(providerBody, "providers").flatMap((item) => {
        const row = record(item);
        if (!row || typeof row.provider !== "string" || typeof row.model !== "string") return [];
        return [{ provider: row.provider, model: row.model, configured: row.configured === true, eligible: false, liveVerified: false, operational: false, blockReason: typeof row.blockReason === "string" ? row.blockReason : null }];
      }));
    }).catch((caught: unknown) => setError(errorCode(caught)));
  }, []);

  return (
    <>
      <PageHeader kicker="Explore" title="Resource Discovery" lede="No video titles are shown until a search actually returns them." />
      <Alert code={error} />
      {!checked && !error ? <Loading label="Checking video search…" /> : null}
      {checked && !youtube && !error ? <section className="state state-unconfigured"><p className="kicker">Not set up</p><h2>Video search isn't set up yet</h2><p>{gaps.bookmarks}</p></section> : null}
      {youtube ? (
        <section className="state state-unconfigured">
          <p className="kicker">Not set up</p>
          <h2>{youtube.search === "unconfigured" ? "Video search isn't set up yet" : "Video search isn't available yet"}</h2>
          <p>{gaps.bookmarks}</p>
          <details>
            <summary>AI info</summary>
            <p>{youtube.captionReason || "Captions aren't available."}</p>
          </details>
        </section>
      ) : null}
      <section className="state state-unconfigured">
        <p className="kicker">Not set up</p>
        <h2>Video creation isn't set up</h2>
        <p>{gaps.videoCreation}</p>
      </section>
      <h2>Models</h2>
      {providers && providers.length === 0 ? <Empty title="No models yet">Nothing is listed to choose from.</Empty> : null}
      {providers && providers.length > 0 ? (
        <ul className="plain">
          {providers.map((provider) => (
            <li key={`${provider.provider}:${provider.model}`}>
              <p><strong>{provider.provider}</strong> · {provider.model}</p>
              <p>{providerStudentStatus(provider.provider, provider.configured)}</p>
              <details>
                <summary>AI info</summary>
                <p>{provider.blockReason || (provider.configured ? "A key is present, and this model still isn't available." : "No key is set.")}</p>
              </details>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
