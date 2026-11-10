"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { groups, mobileNav, type Dest } from "../nav.js";
import { Logo } from "./Bits.js";
import { api } from "./http.js";
import { messageFor, mobileDestination } from "./present.js";
import { clearAccountCache, useWorkspace, WorkspaceGate } from "./workspace.js";

function NavGroup({ group, pathname, onNavigate }: { group: { id: string; label: string; items: Dest[] }; pathname: string; onNavigate: () => void }) {
  const active = group.items.some((item) => item.href === pathname);
  const [expanded, setExpanded] = useState(active);
  useEffect(() => { if (active) setExpanded(true); }, [active]);
  return (
    <details id={`group-${group.id}`} className="group" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>
        {group.label}
        <span className="sr">{expanded ? "expanded" : "collapsed"}</span>
      </summary>
      <ul>
        {group.items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} aria-current={pathname === item.href ? "page" : undefined} onClick={onNavigate}>{item.label}</Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me, courses, coursesError, courseId, setCourseId, online } = useWorkspace();
  const [open, setOpen] = useState(false);
  const mobile = mobileDestination(pathname);
  const selected = courses.find((course) => course.id === courseId);

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
    } finally {
      clearAccountCache();
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
            <NavGroup key={group.id} group={group} pathname={pathname} onNavigate={() => setOpen(false)} />
          ))}
        </nav>
        <div className="rail-search">
          <form className="search" action="/search" role="search">
            <label className="sr" htmlFor="q-menu">Search tools</label>
            <input id="q-menu" name="q" placeholder="Search topics, notes and tools" />
          </form>
          <Link className="nav-link" href="/tools" onClick={() => setOpen(false)}>Help</Link>
        </div>
        <div className="rail-foot stack">
          <p className="eyebrow">{me.email}</p>
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
          <Link className="btn quiet help-link" href="/tools">Help</Link>
        </header>
        {!online ? <p className="alert" role="status">You're offline. Nothing new is sent until you're back online.</p> : null}
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
