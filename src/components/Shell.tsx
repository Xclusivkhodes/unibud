"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { groups, mobileNav } from "../nav.js";
import { logoutAction } from "../app/actions.js";

type Course = { id: string; name: string };

export function Shell({ displayName, courses, children }: { displayName: string; courses: Course[]; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <div className="shell">
      <a className="skip" href="#content">Skip to content</a>
      <aside className={open ? "rail open" : "rail"}>
        <div className="logo-plate">
          <img src="/brand/unibud-primary-logo-reference.png" width={1028} height={442} alt="UniBud" />
        </div>
        <p className="eyebrow">Your workspace</p>
        <nav aria-label="Learning">
          {groups.map((group) =>
            group.href ? (
              <Link key={group.id} className="nav-link" href={group.href} aria-current={pathname === group.href ? "page" : undefined} onClick={() => setOpen(false)}>
                {group.label}
              </Link>
            ) : (
              <details key={group.id} className="group" open={group.items.some((item) => pathname === item.href)}>
                <summary>{group.label}</summary>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} aria-current={pathname === item.href ? "page" : undefined} onClick={() => setOpen(false)}>
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ),
          )}
        </nav>
        <div className="rail-foot stack">
          <p className="eyebrow">{displayName || "Student"}</p>
          <Link className="nav-link" href="/settings">Profile and settings</Link>
          <Link className="nav-link" href="/activity">Activity</Link>
          <form action={logoutAction}><button className="btn quiet" type="submit">Log out</button></form>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn quiet menu" type="button" onClick={() => setOpen((value) => !value)}>Menu</button>
          <form className="search" action="/search">
            <label className="sr" htmlFor="q">Search notes and tools</label>
            <input id="q" name="q" placeholder="Search topics, notes and tools" />
            <button className="btn quiet" type="submit">Search</button>
          </form>
          <Link className="btn quiet" href="/tools">Help</Link>
        </header>
        {courses.length > 0 ? (
          <p className="kicker">Course · {courses.map((course) => course.name).join(", ")}</p>
        ) : (
          <p className="kicker">No course saved yet</p>
        )}
        <div id="content">{children}</div>
      </div>
      <nav className="bottom-nav" aria-label="Mobile">
        {mobileNav.map((item) => (
          <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined}>{item.label}</Link>
        ))}
      </nav>
    </div>
  );
}
