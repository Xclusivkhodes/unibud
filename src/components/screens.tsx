import Link from "next/link";
import { all, get } from "../db.js";
import {
  addSourceAction,
  askAction,
  attemptAction,
  autopilotAction,
  bookmarkAction,
  cardAction,
  circleAction,
  completeTaskAction,
  composePackAction,
  confirmTaskAction,
  cramAction,
  createCourseAction,
  createTopicAction,
  gameAction,
  graphAction,
  labAction,
  lensAction,
  questionAction,
  radarAction,
  reviewAction,
  saveExplanationAction,
  sessionAction,
  taskAction,
  uploadSourceAction,
} from "../app/actions.js";
import { audience, canPracticeFromBookmark, listMisconceptions, mission, proposeAutopilot, twin } from "../domain.js";
import { BUILT_IN_GAME } from "../learning/labs.js";
import { localDate, newId } from "../security/crypto.js";
import { searchVideos } from "../youtube/api.js";
import { allDestinations, groups } from "../nav.js";
import { ErrorNote, Field } from "./Bits.js";
import { getAppDb } from "../server/appdb.js";
import { profileOf } from "../server/session.js";

export async function Today({ userId }: { userId: string }) {
  const profile = profileOf(userId);
  const today = localDate(new Date().toISOString(), profile?.timezone || "UTC");
  const data = mission(getAppDb(), userId, today);
  const courses = all<{ id: string; name: string }>(getAppDb(), "SELECT id, name FROM courses WHERE user_id = ?", userId);
  const tasks = all<{ id: string; title: string; reason: string; due_at: string | null }>(getAppDb(), "SELECT id, title, reason, due_at FROM tasks WHERE user_id = ? AND confirmed = 1 AND status = 'open' ORDER BY due_at", userId);
  const attempts = all<{ score_correct: number; score_total: number }>(getAppDb(), "SELECT score_correct, score_total FROM attempts WHERE user_id = ? AND status = 'submitted' ORDER BY submitted_at", userId);
  const resumable = data.resumable?.record as { title?: string; id?: string } | undefined;
  return (
    <>
      <p className="kicker">Mission Control · Today</p>
      <h1 className="hero">A little clearer.<br />A little further.</h1>
      <div className="grid">
        <section className="reading">
          <p className="kicker">Continue learning</p>
          {resumable?.title ? (
            <>
              <h2>{resumable.title}</h2>
              <p>{data.resumable?.reason} Recorded from your tasks, not a sample course.</p>
              <Link className="btn amber" href="/planner">Open the task</Link>
            </>
          ) : courses[0] ? (
            <>
              <h2>Continue {courses[0].name}</h2>
              <p>This name comes from a course you saved.</p>
              <Link className="btn amber" href={`/courses/${courses[0].id}`}>Open course</Link>
            </>
          ) : (
            <>
              <h2>Add a course</h2>
              <p>The resume panel stays empty until a course is saved. No sample subject is shown.</p>
              <form className="stack" action={createCourseAction}>
                <Field label="Course name" name="name" required />
                <Field label="Goal, optional" name="goal" />
                <button className="btn amber" type="submit">Save course</button>
              </form>
            </>
          )}
          {attempts.length > 0 ? (
            <table>
              <caption>Submitted attempts. Correct answers over questions answered.</caption>
              <thead><tr><th>Attempt</th><th>Correct</th><th>Answered</th></tr></thead>
              <tbody>
                {attempts.map((attempt, index) => (
                  <tr key={index}><td>{index + 1}</td><td>{attempt.score_correct}</td><td>{attempt.score_total}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p>No chart yet. A chart appears only after a submitted attempt.</p>}
          <p>Recorded study time: {data.recordedMinutes} minutes. Streak: {data.streak.days}. {data.streak.rule}</p>
          {data.attempts ? <p>Marked answers {data.attempts.correct} / {data.attempts.total}.</p> : <p>No marked answers yet.</p>}
          {data.plan ? <p>Confirmed tasks done {data.plan.done} / {data.plan.total}.</p> : <p>No confirmed plan yet.</p>}
        </section>
        <aside className="stack">
          <section className="glass">
            <h2>Next up</h2>
            {data.exams.length > 0 ? <p>{(data.exams[0] as { title: string; exam_date: string }).title} · {(data.exams[0] as { exam_date: string }).exam_date}</p> : <p>No exam date saved.</p>}
            <Link href="/cram">Plan an exam</Link>
          </section>
          <section className="glass">
            <h2>Ask a question</h2>
            <p>Lessons, notes and practice stay on this account. A model reply appears only when a provider is eligible.</p>
            <Link className="btn amber" href="/companion">Open Study Companion</Link>
          </section>
        </aside>
      </div>
      <h2>Learning agenda</h2>
      {tasks.length === 0 ? <p>No confirmed tasks yet.</p> : (
        <ol className="agenda">
          {tasks.map((task, index) => (
            <li key={task.id}><span className="num">{String(index + 1).padStart(2, "0")}</span><span><strong>{task.title}</strong><br />{task.reason} {task.due_at ? `Due ${task.due_at}` : ""}</span></li>
          ))}
        </ol>
      )}
      <form action={sessionAction}><button className="btn quiet" type="submit">Start a study session</button></form>
    </>
  );
}

export async function Courses({ userId }: { userId: string }) {
  const courses = all<{ id: string; name: string; goal_text: string }>(getAppDb(), "SELECT id, name, goal_text FROM courses WHERE user_id = ?", userId);
  return (
    <section className="stack">
      <h1>Courses</h1>
      <form className="ivory stack" action={createCourseAction}>
        <Field label="Course name" name="name" required />
        <Field label="Subject label" name="subject" />
        <Field label="Goal" name="goal" />
        <button className="btn amber" type="submit">Save course</button>
      </form>
      <ul className="agenda">{courses.map((course) => <li key={course.id}><Link href={`/courses/${course.id}`}>{course.name}</Link><span>{course.goal_text}</span></li>)}</ul>
    </section>
  );
}

export async function CourseDetail({ userId, courseId }: { userId: string; courseId: string }) {
  const course = get<{ id: string; name: string }>(getAppDb(), "SELECT id, name FROM courses WHERE id = ? AND user_id = ?", courseId, userId);
  if (!course) return <p role="alert">That course is not on this account.</p>;
  const topics = all<{ id: string; name: string; self_reported_level: string }>(getAppDb(), "SELECT id, name, self_reported_level FROM topics WHERE course_id = ? AND user_id = ?", courseId, userId);
  const sources = all<{ id: string; title: string }>(getAppDb(), "SELECT id, title FROM sources WHERE course_id = ? AND user_id = ?", courseId, userId);
  return (
    <section className="stack">
      <h1>{course.name}</h1>
      <p>Self-reported levels are not measured ability.</p>
      <form className="ivory stack" action={createTopicAction}>
        <input type="hidden" name="courseId" value={courseId} />
        <Field label="Topic" name="name" required />
        <Field label="Self-reported starting point" name="level" />
        <button className="btn amber" type="submit">Add topic</button>
      </form>
      <ul>{topics.map((topic) => <li key={topic.id}>{topic.name} {topic.self_reported_level ? `· stated ${topic.self_reported_level}` : ""}</li>)}</ul>
      <ul>{sources.map((source) => <li key={source.id}>{source.title}</li>)}</ul>
      <p><Link href={`/studio?course=${courseId}`}>Add a source in Learning Studio</Link></p>
    </section>
  );
}

export async function Companion({ userId, chatId }: { userId: string; chatId?: string }) {
  const chats = all<{ id: string; title: string }>(getAppDb(), "SELECT id, title FROM chats WHERE user_id = ? ORDER BY updated_at DESC", userId);
  const messages = chatId ? all<{ role: string; content: string; status: string }>(getAppDb(), "SELECT role, content, status FROM messages WHERE chat_id = ? AND user_id = ? ORDER BY created_at", chatId, userId) : [];
  return (
    <section className="stack">
      <p className="kicker">Study Companion</p>
      <h1>Ask about the work in front of you</h1>
      <p className="lede">Gemma Study Companion is a search alias. The reply names a provider only when one is actually selected. No key is configured in this runtime, so the companion stores your question and does not invent a lesson.</p>
      <form className="ivory stack" action={askAction}>
        <Field label="Question" name="question" required />
        <button className="btn amber" type="submit">Save question</button>
      </form>
      <ul>{chats.map((chat) => <li key={chat.id}><Link href={`/companion?chat=${chat.id}`}>{chat.title}</Link></li>)}</ul>
      <ol className="reading">{messages.map((message, index) => <li key={index}><strong>{message.role}</strong> · {message.status}<br />{message.content}</li>)}</ol>
    </section>
  );
}

export async function Studio({ userId, courseId, sync }: { userId: string; courseId?: string; sync?: string }) {
  const courses = all<{ id: string; name: string }>(getAppDb(), "SELECT id, name FROM courses WHERE user_id = ?", userId);
  const sources = all<{ id: string; title: string; body: string }>(getAppDb(), "SELECT id, title, body FROM sources WHERE user_id = ? AND (? = '' OR course_id = ?)", userId, courseId ?? "", courseId ?? "");
  return (
    <section className="stack">
      <h1>Learning Studio</h1>
      {sync ? <p role="status">Sync result: {sync}. Synced is used only after the server acknowledges the write.</p> : null}
      <form className="ivory stack" action={addSourceAction}>
        <label>Course<select name="courseId" required>{courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
        <Field label="Title" name="title" required />
        <Field label="Source text" name="body" type="area" required />
        <button className="btn amber" type="submit">Save source</button>
      </form>
      <form className="stack" action={uploadSourceAction}>
        <label>Course<select name="courseId" required>{courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
        <label>Text file<input name="file" type="file" accept="text/plain,text/markdown,.txt,.md" required /></label>
        <button className="btn quiet" type="submit">Upload text</button>
      </form>
      {sources.map((source) => <article className="reading" key={source.id}><h2>{source.title}</h2><p>{source.body}</p></article>)}
    </section>
  );
}

export async function Explainer({ userId }: { userId: string }) {
  const courses = all<{ id: string; name: string }>(getAppDb(), "SELECT id, name FROM courses WHERE user_id = ?", userId);
  const notes = all<{ title: string; depth: string | null; label: string; body: string }>(getAppDb(), "SELECT title, depth, label, body FROM artifacts WHERE user_id = ? AND kind = 'explanation' ORDER BY created_at DESC", userId);
  return (
    <section className="stack">
      <h1>Explainer Studio</h1>
      <p>Save the level and whether the text is yours or generated. This form stores learner-authored text. It does not call a model.</p>
      <form className="ivory stack" action={saveExplanationAction}>
        <label>Course<select name="courseId" required>{courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
        <Field label="Title" name="title" required />
        <label>Level<select name="depth" defaultValue="intermediate"><option>beginner</option><option>intermediate</option><option>advanced</option></select></label>
        <input type="hidden" name="label" value="learner_authored" />
        <Field label="Explanation" name="body" type="area" required />
        <button className="btn amber" type="submit">Save explanation</button>
      </form>
      {notes.map((note, index) => <article className="reading" key={index}><h2>{note.title}</h2><p>{note.depth} · {note.label}</p><p>{note.body}</p></article>)}
    </section>
  );
}

export async function Compiler({ userId }: { userId: string }) {
  const courses = all<{ id: string; name: string }>(getAppDb(), "SELECT id, name FROM courses WHERE user_id = ?", userId);
  const sources = all<{ id: string; title: string }>(getAppDb(), "SELECT id, title FROM sources WHERE user_id = ?", userId);
  const packs = all<{ title: string; body: string }>(getAppDb(), "SELECT title, body FROM artifacts WHERE user_id = ? AND kind = 'study_pack'", userId);
  return (
    <section className="stack">
      <h1>Academic Compiler</h1>
      <p>A pack quotes your sources and keeps their ids. It does not add unsourced claims.</p>
      <form className="ivory stack" action={composePackAction}>
        <label>Course<select name="courseId" required>{courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
        {sources.map((source) => <label key={source.id}><input type="checkbox" name="sourceId" value={source.id} /> {source.title}</label>)}
        <button className="btn amber" type="submit">Compose pack</button>
      </form>
      {packs.map((pack, index) => <pre className="reading" key={index}>{pack.body}</pre>)}
    </section>
  );
}

export function Lab() {
  return (
    <section className="stack">
      <h1>Reality Lab</h1>
      <p>Projectile motion on flat ground with no drag. Range uses v² sin(2θ) / g, with g = 9.81 m/s². The table is the text alternative to any later drawing.</p>
      <form className="ivory stack" action={labAction}>
        <Field label="Speed (m/s)" name="speed" required />
        <Field label="Angle (degrees)" name="degrees" required />
        <button className="btn amber" type="submit">Calculate and save</button>
      </form>
    </section>
  );
}

export function Lens({ status, reason }: { status?: string; reason?: string }) {
  return (
    <section className="stack">
      <h1>Reality Lens</h1>
      <p>Image analysis is denied unless a configured multimodal provider passes age, privacy, and cost checks. Text mode is not image analysis and returns no interpretation.</p>
      {status ? <p role="status">{status}: {reason}. No interpretation was fabricated.</p> : null}
      <form className="ivory stack" action={lensAction}>
        <label><input type="radio" name="mode" value="text" defaultChecked /> Text only</label>
        <label><input type="radio" name="mode" value="image" /> Image, with consent</label>
        <label><input type="checkbox" name="consent" /> I consent to send this image to an eligible provider</label>
        <button className="btn amber" type="submit">Check capability</button>
      </form>
    </section>
  );
}

export async function Universe({ userId }: { userId: string }) {
  const nodes = all<{ id: string; label: string }>(getAppDb(), "SELECT id, label FROM graph_nodes WHERE user_id = ?", userId);
  const edges = all<{ origin: string; from_id: string; to_id: string; academic_verification: string }>(getAppDb(), "SELECT origin, from_id, to_id, academic_verification FROM graph_edges WHERE user_id = ?", userId);
  return (
    <section className="stack">
      <h1>Knowledge Universe</h1>
      <p>Learner edges are what you enter. Inferred is not an academically verified prerequisite.</p>
      <form className="ivory stack" action={graphAction}>
        <Field label="From concept" name="from" required />
        <Field label="To concept" name="to" required />
        <label>Origin<select name="origin"><option value="learner">Learner entered</option><option value="inferred">Inferred, not verified</option></select></label>
        <button className="btn amber" type="submit">Save link</button>
      </form>
      <ul>{nodes.map((node) => <li key={node.id}>{node.label}</li>)}</ul>
      <ul>{edges.map((edge, index) => <li key={index}>{edge.origin} · {edge.academic_verification}</li>)}</ul>
    </section>
  );
}

export async function Resources({ userId }: { userId: string }) {
  const search = await searchVideos({ apiKey: process.env.YOUTUBE_API_KEY, online: true, allowNetwork: false });
  const bookmarks = all<{ id: string; video_id: string; note: string }>(getAppDb(), "SELECT id, video_id, note FROM video_bookmarks WHERE user_id = ?", userId);
  return (
    <section className="stack">
      <h1>Resource Discovery</h1>
      <p>YouTube search status: {search.status}. No titles are invented. A saved id is a reference, not proof the video was watched. Caption download is not available without video-edit permission.</p>
      <form className="ivory stack" action={bookmarkAction}>
        <Field label="11-character video id you already have" name="videoId" required />
        <Field label="Your note" name="note" />
        <Field label="Transcript, only if you have the right to store it" name="transcript" type="area" />
        <label><input type="checkbox" name="rights" /> I confirm this transcript is authorized</label>
        <button className="btn amber" type="submit">Save reference</button>
      </form>
      <ul>{bookmarks.map((bookmark) => <li key={bookmark.id}>{bookmark.video_id} · {bookmark.note || "No note"} · practice {canPracticeFromBookmark(getAppDb(), userId, bookmark.id).reason}</li>)}</ul>
    </section>
  );
}

export async function Practice({ userId, courseId }: { userId: string; courseId?: string }) {
  const courses = all<{ id: string; name: string }>(getAppDb(), "SELECT id, name FROM courses WHERE user_id = ?", userId);
  const topics = all<{ id: string; name: string; course_id: string }>(getAppDb(), "SELECT id, name, course_id FROM topics WHERE user_id = ?", userId);
  const questions = all<{ id: string; prompt: string; choices_json: string; topic_id: string | null; course_id: string }>(getAppDb(), "SELECT id, prompt, choices_json, topic_id, course_id FROM questions WHERE user_id = ?", userId);
  return (
    <section className="stack">
      <h1>Practice and Quiz</h1>
      <ErrorNote code={undefined} />
      <form className="ivory stack" action={questionAction}>
        <label>Course<select name="courseId" defaultValue={courseId}>{courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
        <label>Topic<select name="topicId">{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></label>
        <Field label="Prompt" name="prompt" required />
        <Field label="Choice A" name="a" required />
        <Field label="Choice B" name="b" required />
        <label>Correct<select name="correct"><option value="0">A</option><option value="1">B</option></select></label>
        <button className="btn amber" type="submit">Save question</button>
      </form>
      {questions.map((question) => {
        const choices = JSON.parse(question.choices_json) as string[];
        return (
          <form className="reading stack" key={question.id} action={attemptAction}>
            <input type="hidden" name="courseId" value={question.course_id} />
            <input type="hidden" name="topicId" value={question.topic_id ?? ""} />
            <input type="hidden" name="questionId" value={question.id} />
            <input type="hidden" name="token" value={newId()} />
            <input type="hidden" name="kind" value="practice" />
            <p>{question.prompt}</p>
            {choices.map((choice, index) => <label key={choice}><input type="radio" name="selected" value={index} required /> {choice}</label>)}
            <button className="btn amber" type="submit">Submit answer</button>
          </form>
        );
      })}
    </section>
  );
}

export async function Cards({ userId }: { userId: string }) {
  const cards = all<{ id: string; front: string; back: string }>(getAppDb(), "SELECT id, front, back FROM cards WHERE user_id = ?", userId);
  return (
    <section className="stack">
      <h1>Flashcard Studio</h1>
      <p>The scheduler is deterministic-sm2. Rating is self-rated and is not a mastery score. Reveal the answer before rating.</p>
      <form className="ivory stack" action={cardAction}>
        <Field label="Deck" name="deck" required />
        <Field label="Front" name="front" required />
        <Field label="Back" name="back" required />
        <button className="btn amber" type="submit">Save card</button>
      </form>
      {cards.map((card) => (
        <form key={card.id} className="reading stack" action={reviewAction}>
          <input type="hidden" name="cardId" value={card.id} />
          <p>{card.front}</p>
          <details><summary>Show answer</summary><p>{card.back}</p></details>
          <label><input type="checkbox" name="revealed" required /> I have revealed the answer</label>
          <label>Self-rating 0–5<input name="quality" type="number" min="0" max="5" required /></label>
          <button className="btn amber" type="submit">Record review</button>
        </form>
      ))}
    </section>
  );
}

export async function Memory({ userId }: { userId: string }) {
  const due = all<{ id: string; front: string; due_at: string | null }>(getAppDb(), "SELECT id, front, due_at FROM cards WHERE user_id = ? ORDER BY due_at", userId);
  return (
    <section className="stack">
      <h1>Memory Studio</h1>
      <p>Due cards use the same review log as Flashcard Studio.</p>
      <ul>{due.map((card) => <li key={card.id}>{card.front} · due {card.due_at ?? "now"}</li>)}</ul>
      <Link href="/cards">Review in Flashcard Studio</Link>
    </section>
  );
}

export async function Stress({ userId }: { userId: string }) {
  const missed = all<{ id: string; prompt: string; course_id: string; topic_id: string | null }>(getAppDb(), `SELECT DISTINCT q.id, q.prompt, q.course_id, q.topic_id FROM questions q JOIN attempt_answers aa ON aa.question_id = q.id WHERE q.user_id = ? AND aa.correct = 0`, userId);
  return (
    <section className="stack">
      <h1>Knowledge Stress Test</h1>
      <p>Items come from your missed questions. This is not a validated psychometric measure.</p>
      {missed.length === 0 ? <p>No missed questions yet.</p> : missed.map((question) => (
        <form key={question.id} action={attemptAction}>
          <input type="hidden" name="kind" value="stress" />
          <input type="hidden" name="timing" value="retrieval" />
          <input type="hidden" name="courseId" value={question.course_id} />
          <input type="hidden" name="topicId" value={question.topic_id ?? ""} />
          <input type="hidden" name="questionId" value={question.id} />
          <input type="hidden" name="token" value={newId()} />
          <input type="hidden" name="selected" value="0" />
          <button className="btn quiet" type="submit">Retry: {question.prompt}</button>
        </form>
      ))}
    </section>
  );
}

export function Games({ score, total }: { score?: string; total?: string }) {
  return (
    <section className="stack">
      <h1>GameVerse</h1>
      <p>This built-in pair is practice, not a record of your courses, and the score is not mastery.</p>
      {score ? <p role="status">Score {score} / {total}. Not mastery.</p> : null}
      <form className="ivory stack" action={gameAction}>
        <p>{BUILT_IN_GAME[0].prompt}</p>
        <Field label="Answer" name="one" required />
        <p>{BUILT_IN_GAME[1].prompt}</p>
        <Field label="Answer" name="two" required />
        <button className="btn amber" type="submit">Score game</button>
      </form>
    </section>
  );
}

export async function Cram({ userId }: { userId: string }) {
  const courses = all<{ id: string; name: string }>(getAppDb(), "SELECT id, name FROM courses WHERE user_id = ?", userId);
  return (
    <section className="stack">
      <h1>Exam Cram Sprint</h1>
      <p>Minutes come from the hours you enter and are dated between today and the exam. A short budget is labeled insufficient. It does not predict the paper.</p>
      <form className="ivory stack" action={cramAction}>
        <label>Course<select name="courseId" required>{courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
        <Field label="Exam title" name="title" required />
        <Field label="Exam date" name="date" type="date" required />
        <Field label="Available hours" name="hours" required />
        <Field label="Syllabus notes" name="syllabus" type="area" />
        <button className="btn quiet" type="submit">Preview</button>
        <button className="btn amber" name="confirm" value="1" type="submit">Confirm and add dated tasks</button>
      </form>
    </section>
  );
}

export async function Arena({ userId }: { userId: string }) {
  const questions = all<{ id: string; prompt: string; choices_json: string; course_id: string; topic_id: string | null }>(getAppDb(), "SELECT id, prompt, choices_json, course_id, topic_id FROM questions WHERE user_id = ?", userId);
  return (
    <section className="stack">
      <h1>Exam Arena</h1>
      <p>Interrupting an attempt stores no score.</p>
      {questions[0] ? (
        <form className="reading stack" action={attemptAction}>
          <input type="hidden" name="kind" value="arena" />
          <input type="hidden" name="timing" value="timed" />
          <input type="hidden" name="courseId" value={questions[0].course_id} />
          <input type="hidden" name="topicId" value={questions[0].topic_id ?? ""} />
          <input type="hidden" name="questionId" value={questions[0].id} />
          <input type="hidden" name="token" value={newId()} />
          <p>{questions[0].prompt}</p>
          {(JSON.parse(questions[0].choices_json) as string[]).map((choice, index) => <label key={choice}><input type="radio" name="selected" value={index} /> {choice}</label>)}
          <button className="btn amber" type="submit">Submit timed answer</button>
          <button className="btn quiet" name="interrupt" value="1" type="submit">Interrupt without a score</button>
        </form>
      ) : <p>Add a practice question before an arena attempt.</p>}
    </section>
  );
}

export async function Planner({ userId }: { userId: string }) {
  const tasks = all<{ id: string; title: string; status: string; confirmed: number; due_at: string | null }>(getAppDb(), "SELECT id, title, status, confirmed, due_at FROM tasks WHERE user_id = ? ORDER BY created_at", userId);
  const courses = all<{ id: string; name: string }>(getAppDb(), "SELECT id, name FROM courses WHERE user_id = ?", userId);
  return (
    <section className="stack">
      <h1>Study Planner</h1>
      <form className="ivory stack" action={taskAction}>
        <label>Course<select name="courseId">{courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
        <Field label="Task" name="title" required />
        <Field label="Due" name="due" type="datetime-local" />
        <button className="btn amber" type="submit">Add confirmed task</button>
      </form>
      <ul>{tasks.map((task) => <li key={task.id}>{task.title} · {task.status} · {task.due_at ?? "no date"} {task.confirmed ? "" : <form action={confirmTaskAction}><input type="hidden" name="taskId" value={task.id} /><button type="submit">Confirm</button></form>} {task.confirmed && task.status === "open" ? <form action={completeTaskAction}><input type="hidden" name="taskId" value={task.id} /><button type="submit">Complete</button></form> : null}</li>)}</ul>
    </section>
  );
}

export async function Twin({ userId }: { userId: string }) {
  const topics = all<{ id: string; name: string; self_reported_level: string }>(getAppDb(), "SELECT id, name, self_reported_level FROM topics WHERE user_id = ?", userId);
  return (
    <section className="stack">
      <h1>Learning Twin</h1>
      <ul>{topics.map((topic) => {
        const insight = twin(getAppDb(), userId, topic.id);
        return <li key={topic.id}>{topic.name}: stated {insight.selfReportedLevel || "unset"}. Evidence {insight.evidence ? `${insight.evidence.correct}/${insight.evidence.total}` : "none"}. Not mastery.</li>;
      })}</ul>
    </section>
  );
}

export async function Radar({ userId }: { userId: string }) {
  const radar = listMisconceptions(getAppDb(), userId);
  return (
    <section className="stack">
      <h1>Misconception Radar</h1>
      <p>A hypothesis needs two wrong answers in the current episode. One mistake is not a diagnosis. Correcting closes that episode.</p>
      <ul>{(radar.hypotheses as Array<{ id: string; evidence_json: string }>).map((item) => (
        <li key={item.id}>{item.evidence_json}<form action={radarAction}><input type="hidden" name="id" value={item.id} /><button type="submit">Mark corrected</button></form></li>
      ))}</ul>
    </section>
  );
}

export async function Autopilot({ userId, courseId }: { userId: string; courseId?: string }) {
  const courses = all<{ id: string; name: string }>(getAppDb(), "SELECT id, name FROM courses WHERE user_id = ?", userId);
  const selected = courseId || courses[0]?.id;
  const proposal = selected ? proposeAutopilot(getAppDb(), userId, selected) : null;
  return (
    <section className="stack">
      <h1>Academic Autopilot</h1>
      <p>Confirmation writes the due dates shown below. Nothing changes until you confirm.</p>
      {proposal ? (
        <form className="ivory stack" action={autopilotAction}>
          <input type="hidden" name="courseId" value={selected} />
          <ul>{proposal.after.map((row) => <li key={row.id}>{row.title}: {row.changed ? `change to ${row.dueAt}` : "unchanged"}</li>)}</ul>
          <button className="btn amber" name="confirm" value="1" type="submit">Apply these dates</button>
        </form>
      ) : <p>Add a course first.</p>}
    </section>
  );
}

export async function Circle({ userId }: { userId: string }) {
  const memberships = all<{ id: string; name: string; role: string; status: string }>(getAppDb(), "SELECT c.id, c.name, m.role, m.status FROM circles c JOIN circle_members m ON m.circle_id = c.id WHERE m.user_id = ?", userId);
  return (
    <section className="stack">
      <h1>Study Circle</h1>
      <form className="ivory stack" action={circleAction}>
        <input type="hidden" name="intent" value="create" />
        <Field label="Circle name" name="name" required />
        <button className="btn amber" type="submit">Create circle</button>
      </form>
      {memberships.map((circle) => {
        let who: Array<{ user_id: string; role: string }> = [];
        try { who = audience(getAppDb(), circle.id, userId); } catch { who = []; }
        return (
          <article className="glass" key={circle.id}>
            <h2>{circle.name}</h2>
            <p>{circle.role} · {circle.status}</p>
            <p>Audience now: {who.map((member) => member.role).join(", ") || "not visible until you are an active member"}</p>
            {circle.status === "pending" ? <form action={circleAction}><input type="hidden" name="intent" value="accept" /><input type="hidden" name="circleId" value={circle.id} /><button type="submit">Accept invite</button></form> : null}
            {circle.status === "active" ? (
              <form action={circleAction}>
                <input type="hidden" name="intent" value="post" />
                <input type="hidden" name="circleId" value={circle.id} />
                <Field label="Post" name="body" required />
                <button className="btn amber" type="submit">Post to the people listed</button>
              </form>
            ) : null}
            {circle.role === "owner" ? (
              <form action={circleAction}>
                <input type="hidden" name="intent" value="invite" />
                <input type="hidden" name="circleId" value={circle.id} />
                <Field label="Invite an existing account email" name="email" type="email" required />
                <button type="submit">Invite</button>
              </form>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

export async function Activity({ userId }: { userId: string }) {
  const notes = all<{ id: string; title: string; read_at: string | null }>(getAppDb(), "SELECT id, title, read_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC", userId);
  return (
    <section className="stack">
      <h1>Activity</h1>
      <ul>{notes.map((note) => <li key={note.id}>{note.title} · {note.read_at ? "read" : "unread"}</li>)}</ul>
    </section>
  );
}

export async function Settings({ userId, status }: { userId: string; status?: string }) {
  const profile = profileOf(userId);
  const { settingsAction, privacyAction, deleteAccountAction } = await import("../app/actions.js");
  return (
    <section className="stack">
      <h1>Profile and settings</h1>
      {status ? <p role="status">Profile save: {status}</p> : null}
      <form className="ivory stack" action={settingsAction}>
        <input type="hidden" name="rev" value={profile?.rev ?? 1} />
        <Field label="Preferred name" name="displayName" defaultValue={profile?.display_name ?? ""} />
        <Field label="Timezone" name="timezone" defaultValue={profile?.timezone ?? "UTC"} />
        <Field label="Goals" name="goals" defaultValue={profile?.goals_text ?? ""} />
        <label>Explanation depth<select name="depth" defaultValue={profile?.explanation_depth ?? "intermediate"}><option>beginner</option><option>intermediate</option><option>advanced</option></select></label>
        <label><input type="checkbox" name="offline" defaultChecked={profile?.offline_consent === 1} /> Offline copies may stay on this device</label>
        <button className="btn amber" type="submit">Save profile</button>
      </form>
      <form action={privacyAction}>
        <label>Provider id for a private-content grant<input name="provider" required /></label>
        <button type="submit">Record grant</button>
      </form>
      <p><a href="/api/export">Download account JSON</a></p>
      <form action={deleteAccountAction}><button className="btn quiet" type="submit">Delete account and derived records</button></form>
    </section>
  );
}

export function Tools({ query = "" }: { query?: string }) {
  const needle = query.trim().toLowerCase();
  const matches = allDestinations().filter((item) => !needle || item.label.toLowerCase().includes(needle) || item.alias?.some((alias) => alias.includes(needle)));
  return (
    <section className="stack">
      <h1>All tools</h1>
      <p>Every received destination is listed. A link is not a claim that the workflow is fully accepted.</p>
      {groups.map((group) => (
        <section key={group.id}>
          <h2>{group.label}</h2>
          <ul>{(group.href ? [{ href: group.href, label: group.label }] : group.items).map((item) => <li key={item.href}><Link href={item.href}>{item.label}</Link></li>)}</ul>
        </section>
      ))}
      {needle ? <ul>{matches.map((item) => <li key={item.href}><Link href={item.href}>{item.label}</Link></li>)}</ul> : null}
    </section>
  );
}
