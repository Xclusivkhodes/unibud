"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiClientError } from "./http.js";
import { emptyMemory, parseMemory, readCourse, type BrowserMemory, type CourseView } from "./present.js";
import type { SessionUser } from "../contract/types.js";

const MEMORY_KEY = "unibud.browser-returned.v1";
const COURSE_KEY = "unibud.course-context";

type WorkspaceValue = {
  me: SessionUser;
  courses: CourseView[];
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
  const [coursesError, setCoursesError] = useState("");
  const [courseId, setCourseIdState] = useState("");
  const [memory, setMemory] = useState<BrowserMemory>(emptyMemory());
  const [online, setOnline] = useState(true);

  async function refreshCourses() {
    try {
      const body = await api("/api/courses");
      const row = body && typeof body === "object" && "courses" in body ? (body as { courses: unknown }).courses : [];
      const next = Array.isArray(row) ? row.flatMap((item) => { const course = readCourse(item); return course ? [course] : []; }) : [];
      setCourses(next);
      setCoursesError("");
      setCourseIdState((current) => (current && next.some((course) => course.id === current) ? current : next[0]?.id ?? ""));
    } catch (caught) {
      setCoursesError(caught instanceof ApiClientError ? caught.code : "internal");
    }
  }

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
    }).catch((caught) => {
      if (!live) return;
      if (caught instanceof ApiClientError && (caught.status === 401 || caught.code === "unauthenticated")) router.replace("/login");
      else {
        setError(caught instanceof ApiClientError ? caught.code : "internal");
        setPhase("error");
      }
    });
    return () => { live = false; };
  }, [router]);

  useEffect(() => {
    if (phase !== "ready") return;
    const stored = window.sessionStorage.getItem(COURSE_KEY) ?? "";
    setCourseIdState(stored);
    setMemory(parseMemory(window.sessionStorage.getItem(MEMORY_KEY)));
    void refreshCourses();
  }, [phase]);

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

  const value = useMemo<WorkspaceValue | null>(() => {
    if (!me) return null;
    return {
      me,
      courses,
      coursesError,
      refreshCourses,
      courseId,
      setCourseId: (id: string) => {
        setCourseIdState(id);
        window.sessionStorage.setItem(COURSE_KEY, id);
      },
      memory,
      updateMemory: (change) => {
        setMemory((current) => {
          const next = change(current);
          window.sessionStorage.setItem(MEMORY_KEY, JSON.stringify(next));
          return next;
        });
      },
      online,
    };
  }, [me, courses, coursesError, courseId, memory, online]);

  if (phase === "loading") return <p className="status" role="status">Checking your session…</p>;
  if (phase === "error" || !value) return <p className="alert" role="alert">The session could not be checked. {error}</p>;
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
