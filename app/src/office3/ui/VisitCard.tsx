"use client";
import { useEffect, useState } from "react";
import { officePersonAuthHeaders } from "../core/auth";
import { useLiveAgents } from "@/stores/liveAgentsStore";
import { officeTime } from "./locale";
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export interface VisitPerson { slug: string; name: string; kind: string; state?: string; }
type Profile = { founder_note: string; title: string; bio: string; timezone: string; birthday: string };
const blankProfile: Profile = { founder_note: "", title: "", bio: "", timezone: "", birthday: "" };
const timezoneTime = (timezone: string, now: Date): string | null => { try { return new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(now); } catch { return null; } };
export function VisitCard({ person, onClose }: { person: VisitPerson; onClose(): void }) {
  const live = useLiveAgents(state => state.agents[person.slug]);
  const history = useLiveAgents(state => state.history[person.slug] ?? []);
  const noteKey = `office3.profile-note.${person.slug}`;
  const [profile, setProfile] = useState<Profile>(blankProfile);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 30000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    let active = true;
    const fallback = () => { if (!active) return; try { setProfile({ ...blankProfile, ...JSON.parse(localStorage.getItem(noteKey) ?? "{}") }); } catch { setProfile({ ...blankProfile, founder_note: localStorage.getItem(noteKey) ?? "" }); } };
    fetch(`${API}/api/v1/office/profiles/${encodeURIComponent(person.slug)}`, { headers: officePersonAuthHeaders() }).then(response => {
      if (response.ok) return response.json();
      if (response.status === 401 || response.status === 403) throw Error("profile-forbidden");
      throw Error("profile-unavailable");
    }).then(value => { if (!active) return; const next = { founder_note: value.founder_note ?? "", title: value.title ?? "", bio: value.bio ?? "", timezone: value.timezone ?? "", birthday: value.birthday ?? "" }; setProfile(next); const today = new Date(); if (next.birthday === `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`) window.dispatchEvent(new CustomEvent("office3:birthday", { detail: { slug: person.slug } })); }).catch(reason => { if (!active) return; if (reason instanceof Error && reason.message === "profile-forbidden") setProfile(blankProfile); else fallback(); });
    return () => { active = false; };
  }, [noteKey, person.slug]);
  const saveProfile = () => {
    localStorage.setItem(noteKey, JSON.stringify(profile));
    void fetch(`${API}/api/v1/office/profiles/${encodeURIComponent(person.slug)}`, { method: "PUT", headers: { "Content-Type": "application/json", ...officePersonAuthHeaders() }, body: JSON.stringify(profile) });
  };
  const role = person.kind === "human" ? "Founder" : "Agent";
  const state = live?.state ?? person.state ?? "online";
  const activity = live?.bubble ?? live?.reason ?? person.state ?? "Available";
  const localTime = profile.timezone ? timezoneTime(profile.timezone, clock) : null;
  const update = (key: keyof Profile, value: string) => setProfile(current => ({ ...current, [key]: value }));
  return <aside className="absolute left-1/2 top-1/2 z-50 max-h-[calc(100%-2rem)] w-80 -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl bg-slate-950/95 p-5 text-white shadow-2xl ring-1 ring-white/15"><button className="float-right text-xs opacity-70" onClick={onClose}>Close</button><div className="mb-3 h-12 w-12 rounded-full bg-blue-500/40"/><h2 className="text-lg font-semibold">{person.name}</h2><p className="text-xs text-blue-200">{profile.title || role} · {state}</p><dl className="mt-4 space-y-2 text-xs"><div><dt className="opacity-50">Office identity</dt><dd>{person.slug}</dd></div><div><dt className="opacity-50">Working on</dt><dd>{activity}</dd></div>{profile.bio && <div><dt className="opacity-50">Bio</dt><dd>{profile.bio}</dd></div>}{profile.timezone && <div><dt className="opacity-50">Timezone</dt><dd>{profile.timezone}{localTime ? ` · ${localTime}` : ""}</dd></div>}{profile.birthday && <div><dt className="opacity-50">Birthday</dt><dd>{profile.birthday}</dd></div>}{live?.ts && <div><dt className="opacity-50">Last update</dt><dd>{officeTime(live.ts)}</dd></div>}</dl>{history.length > 1 && <section className="mt-4 text-xs"><p className="opacity-50">Lifecycle</p><ol className="mt-1 max-h-28 space-y-1 overflow-auto border-l border-slate-600 pl-2 text-slate-300">{history.slice(1).reverse().map(item => { const index = history.findIndex(entry => entry.seq === item.seq); const from = history[index - 1]?.state ?? "started"; return <li key={item.seq}><span className="text-blue-200">{from} → {item.state}</span><span className="opacity-60"> · {officeTime(item.ts)}</span>{item.reason && <p className="line-clamp-1 opacity-60">{item.reason}</p>}</li>; })}</ol></section>}<section className="mt-4 space-y-2 text-xs"><p className="opacity-50">Office profile</p><input className="w-full rounded bg-slate-800 p-2" maxLength={100} value={profile.title} placeholder="Title" onChange={event => update("title", event.target.value)} onBlur={saveProfile} /><textarea className="h-14 w-full resize-none rounded bg-slate-800 p-2" maxLength={160} value={profile.bio} placeholder="Bio (optional)" onChange={event => update("bio", event.target.value)} onBlur={saveProfile} /><input className="w-full rounded bg-slate-800 p-2" maxLength={80} value={profile.timezone} placeholder="Timezone (optional, e.g. Asia/Kolkata)" onChange={event => update("timezone", event.target.value)} onBlur={saveProfile} /><input className="w-full rounded bg-slate-800 p-2" inputMode="numeric" maxLength={5} value={profile.birthday} placeholder="Birthday MM-DD (optional)" onChange={event => update("birthday", event.target.value)} onBlur={saveProfile} /><textarea className="h-16 w-full resize-none rounded bg-slate-800 p-2" maxLength={500} value={profile.founder_note} placeholder="Founder note: context, follow-up, or preference…" onChange={event => update("founder_note", event.target.value)} onBlur={saveProfile} /></section></aside>;
}
