"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { groups, mobileNav } from "../nav.js";
import { Logo } from "./Bits.js";
import { api } from "./http.js";
import { messageFor, mobileDestination } from "./present.js";
import { useWorkspace, WorkspaceGate } from "./workspace.js";

function Frame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me, courses, coursesError, courseId, setCourseId, online } = useWorkspace();
  const [open, setOpen] = useState(false);
  const mobile = mobileDestination(pathname);
  const selected = courses.find((course) => course.id === courseId);

  useEffect(() => {
    for (const group of groups) {
      if (group.items.some((item) => item.href === pathname)) {
        const node = document.getElementById(`group-${group.id}`);
        if (node instanceof HTMLDetailsElement) node.open = true;
      }
    }
  }, [pathname]);

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <div className="shell">
      <a className="skip" href="#content">Skip to content</a>
      <aside id="learning-rail" className={open ? "rail open" : "rail"}>
        <Logo />
        <p className="eyebrow">Your workspace</p>
        <nav aria-label="Learning">
          {groups.map((group) => group.href ? (
            <Link key={group.id} className="nav-link" href={group.href} aria-current={pathname === group.href ? "page" : undefined} onClick={() => setOpen(false)}>{group.label}</Link>
          ) : (
            <details key={group.id} id={`group-${group.id}`} className="group" open={group.items.some((item) => pathname === item.href)}>
              <summary>{group.label}</summary>
              <ul>
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} aria-current={pathname === item.href ? "page" : undefined} onClick={() => setOpen(false)}>{item.label}</Link>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </nav>
        <div className="rail-foot stack">
          <p className="eyebrow">{me.email}</p>
          <p className="meta">Data class {me.dataClass || "unknown"}</p>
          <button className="btn quiet" type="button" onClick={() => void logout()}>Log out</button>
        </div>
      </aside>
      {open ? <button className="scrim" type="button" aria-label="Close menu" onClick={() => setOpen(false)} /> : null}
      <div className="workspace">
        <header className="topbar">
          <button className="btn quiet menu" type="button" aria-expanded={open} aria-controls="learning-rail" onClick={() => setOpen((value) => !value)}>{open ? "Close" : "Menu"}</button>
          <Logo compact />
          <form className="search" action="/search" role="search">
            <label className="sr" htmlFor="q">Search tools</label>
            <input id="q" name="q" placeholder="Search topics, notes and tools" />
          </form>
          <label className="course-select">
            <span>Course</span>
            <select value={courseId} onChange={(event) => setCourseId(event.target.value)} aria-label="Course context">
              <option value="">No course selected</option>
              {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
            </select>
          </label>
          <Link className="btn quiet" href="/tools">Help</Link>
        </header>
        {!online ? <p className="alert" role="status">Offline. Saved server actions on this page are not sent until the connection returns.</p> : null}
        {coursesError ? <p className="alert" role="alert">Courses could not be loaded. {messageFor(coursesError)}</p> : null}
        {selected ? <p className="context">Course · {selected.name}{selected.subject ? ` · ${selected.subject}` : ""}</p> : <p className="context">No course saved yet</p>}
        <main id="content">{children}</main>
      </div>
      <nav className="bottom-nav" aria-label="Mobile">
        {mobileNav.map((item) => (
          <Link key={item.href} href={item.href} aria-current={mobile === item.href ? "page" : undefined}>{item.label}</Link>
        ))}
      </nav>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return <WorkspaceGate><Frame>{children}</Frame></WorkspaceGate>;
}
