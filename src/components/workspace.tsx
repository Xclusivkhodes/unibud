"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiClientError, errorCode } from "./http.js";
import { emptyMemory, listField, parseMemory, readCourse, type BrowserMemory, type CourseView } from "./present.js";
import type { SessionUser } from "../contract/types.js";

const MEMORY_KEY = "unibud.browser-returned.v1";
const COURSE_KEY = "unibud.course-context";

type WorkspaceValue = {
  me: SessionUser;
  courses: CourseView[];
  coursesStatus: "loading" | "ready" | "error";
  coursesError: string;
  refreshCourses: () => Promise<void>;
  courseId: string;
  setCourseId: (id: string) => void;
  memory: BrowserMemory;
  updateMemory: (change: (current: BrowserMemory) => BrowserMemory) => void;
  online: boolean;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("Workspace missing");
  return value;
}

export function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<SessionUser | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [courses, setCourses] = useState<CourseView[]>([]);
  const [coursesStatus, setCoursesStatus] = useState<"loading" | "ready" | "error">("loading");
  const [coursesError, setCoursesError] = useState("");
  const [courseId, setCourseIdState] = useState("");
  const [memory, setMemory] = useState<BrowserMemory>(emptyMemory());
  const [online, setOnline] = useState(true);

  const refreshCourses = useCallback(async () => {
    try {
      const body = await api("/api/courses");
      const next = listField(body, "courses").flatMap((item) => {
        const course = readCourse(item);
        return course ? [course] : [];
      });
      setCourses(next);
      setCoursesError("");
      setCoursesStatus("ready");
      setCourseIdState((current) => {
        const stored = current || window.sessionStorage.getItem(COURSE_KEY) || "";
        if (stored && next.some((course) => course.id === stored)) return stored;
        return next[0]?.id ?? "";
      });
    } catch (caught) {
      setCoursesStatus("error");
      setCoursesError(errorCode(caught));
    }
  }, []);

  useEffect(() => {
    let live = true;
    api("/api/me").then((body) => {
      if (!live) return;
      const row = body as Partial<SessionUser>;
      if (!row || typeof row.id !== "string" || typeof row.email !== "string") {
        router.replace("/login");
        return;
      }
      setMe({ id: row.id, email: row.email, dataClass: typeof row.dataClass === "string" ? row.dataClass : "" });
      setPhase("ready");
    }).catch((caught: unknown) => {
      if (!live) return;
      if (caught instanceof ApiClientError && (caught.status === 401 || caught.code === "unauthenticated")) router.replace("/login");
      else {
        setError(errorCode(caught));
        setPhase("error");
      }
    });
    return () => { live = false; };
  }, [router]);

  useEffect(() => {
    if (phase !== "ready") return;
    setMemory(parseMemory(window.sessionStorage.getItem(MEMORY_KEY)));
    void refreshCourses();
  }, [phase, refreshCourses]);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const setCourseId = useCallback((id: string) => {
    setCourseIdState(id);
    window.sessionStorage.setItem(COURSE_KEY, id);
  }, []);

  const updateMemory = useCallback((change: (current: BrowserMemory) => BrowserMemory) => {
    setMemory((current) => {
      const next = change(current);
      window.sessionStorage.setItem(MEMORY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo<WorkspaceValue | null>(() => {
    if (!me) return null;
    return { me, courses, coursesStatus, coursesError, refreshCourses, courseId, setCourseId, memory, updateMemory, online };
  }, [me, courses, coursesStatus, coursesError, refreshCourses, courseId, setCourseId, memory, updateMemory, online]);

  if (phase === "loading") return <p className="status boot" role="status">Checking your session…</p>;
  if (phase === "error" || !value) {
    return (
      <section className="state state-error boot" role="alert">
        <p className="kicker">Error</p>
        <h1>The session could not be checked</h1>
        <p>{error || "The workspace did not load."}</p>
      </section>
    );
  }
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
