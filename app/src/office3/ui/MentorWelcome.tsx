"use client";

import { useEffect, useMemo, useState } from "react";

type Person = { slug: string; name: string; role: string; kind: "human" | "bot" };
const STORAGE_KEY = "office3.mentor-welcome.complete";

/** One local first-day handoff; a future authenticated assignment can replace the mentor selection. */
export function MentorWelcome({ people, onMeet }: { people: Person[]; onMeet(slug: string): void }) {
  const mentor = useMemo(() => people.find(person => person.kind === "bot" && /mentor/i.test(person.role)) ?? people.find(person => person.kind === "bot") ?? null, [people]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const reception = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== "reception" || localStorage.getItem(STORAGE_KEY)) return;
      setOpen(true);
    };
    window.addEventListener("office3:interaction", reception);
    return () => window.removeEventListener("office3:interaction", reception);
  }, []);
  if (!open || !mentor) return null;
  const dismiss = () => { localStorage.setItem(STORAGE_KEY, "1"); setOpen(false); };
  return <aside className="absolute bottom-20 right-3 z-40 w-72 rounded-xl bg-slate-950/95 p-3 text-sm text-white shadow-2xl ring-1 ring-sky-300/30" role="status"><p className="text-xs uppercase tracking-wide text-sky-200">Reception introduction</p><h2 className="mt-1 font-semibold">Meet {mentor.name}</h2><p className="mt-1 text-xs text-slate-300">{mentor.name} is available to help you find your way around the Office.</p><div className="mt-3 flex justify-end gap-2"><button type="button" className="text-xs text-slate-400 hover:text-white" onClick={dismiss}>Later</button><button type="button" className="rounded bg-sky-700 px-2 py-1 text-xs hover:bg-sky-600" onClick={() => { dismiss(); onMeet(mentor.slug); }}>Say hello</button></div></aside>;
}
