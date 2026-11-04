"use client";

import { useEffect, useState } from "react";
import { clearOfficePersonSession, loadOfficePersonSession, saveOfficePersonSession, type OfficePersonSession } from "../core/auth";

type Role = "founder" | "admin" | "employee" | "intern" | "guest";
type Person = { id: string; display_name: string; email?: string | null; role: Role; mentor_id?: string | null; desk_label?: string | null; disabled: boolean };
const roles: Role[] = ["admin", "employee", "intern", "guest"];

/* Legacy compact implementation retained while the expanded workflow below replaces it.

export function PeopleManager({ api, onClose }: { api: string; onClose(): void }) {
  const [people, setPeople] = useState<Person[]>([]), [error, setError] = useState<string | null>(null), [name, setName] = useState(""), [id, setId] = useState(""), [role, setRole] = useState<Role>("employee");
  const refresh = async () => { const response = await fetch(`${api}/api/v1/people`); if (!response.ok) throw Error("People unavailable"); setPeople((await response.json()).people ?? []); };
  useEffect(() => { void refresh().catch(() => setError("Unable to load people.")); }, [session]);
  const add = async () => { if (!id || !name) return; setError(null); try { const response = await fetch(`${api}/api/v1/people`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, display_name: name, role }) }); if (!response.ok) throw Error("Create failed"); setId(""); setName(""); await refresh(); } catch { setError("Unable to create person. Use a unique safe ID."); } };
  const changeRole = async (person: Person, next: Role) => { try { const response = await fetch(`${api}/api/v1/people/${encodeURIComponent(person.id)}/role`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: next }) }); if (!response.ok) throw Error("Role failed"); setPeople(current => current.map(item => item.id === person.id ? { ...item, role: next } : item)); } catch { setError("Unable to change role."); } };
  const disable = async (person: Person) => { try { const response = await fetch(`${api}/api/v1/people/${encodeURIComponent(person.id)}`, { method: "DELETE" }); if (!response.ok) throw Error("Disable failed"); setPeople(current => current.map(item => item.id === person.id ? { ...item, disabled: true } : item)); } catch { setError("Unable to disable person."); } };
  return <aside className="absolute right-3 top-14 z-40 max-h-[calc(100%-5rem)] w-80 overflow-auto rounded-xl bg-slate-950/95 p-3 text-white shadow-2xl ring-1 ring-white/15"><button className="float-right text-xs opacity-70" onClick={onClose}>Close</button><h2 className="mb-3 text-sm font-semibold">People & roles</h2>{error && <p className="mb-2 rounded bg-rose-950 p-2 text-xs text-rose-200">{error}</p>}<div className="mb-3 grid gap-1 rounded bg-slate-900 p-2"><input className="rounded bg-slate-800 p-1 text-xs" placeholder="Safe ID" value={id} onChange={event => setId(event.target.value)} /><input className="rounded bg-slate-800 p-1 text-xs" placeholder="Display name" value={name} onChange={event => setName(event.target.value)} /><div className="flex gap-1"><select className="flex-1 rounded bg-slate-800 p-1 text-xs" value={role} onChange={event => setRole(event.target.value as Role)}>{roles.map(value => <option key={value}>{value}</option>)}</select><button className="rounded bg-blue-700 px-2 text-xs" onClick={() => void add()}>Add</button></div></div>{people.map(person => <div key={person.id} className="border-t border-white/10 py-2 text-xs"><div className="flex items-center justify-between"><span>{person.display_name}<span className="ml-1 opacity-50">@{person.id}</span></span>{person.disabled && <span className="text-rose-300">disabled</span>}</div><div className="mt-1 flex gap-1"><select disabled={person.id === "founder" || person.disabled} className="flex-1 rounded bg-slate-800 p-1 text-xs disabled:opacity-50" value={person.role} onChange={event => void changeRole(person, event.target.value as Role)}>{person.id === "founder" && <option value="founder">founder</option>}{roles.map(value => <option key={value}>{value}</option>)}</select>{person.id !== "founder" && !person.disabled && <button className="rounded bg-rose-900 px-2 text-xs" onClick={() => void disable(person)}>Disable</button>}</div></div>)}</aside>;
}
*/

type Invite = { id: number; email: string; display_name: string; suggested_id: string; role: Role; mentor_id?: string | null; desk_label?: string | null; status: string };

export function PeopleManager({ api, onClose }: { api: string; onClose(): void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [mentorId, setMentorId] = useState("");
  const [deskLabel, setDeskLabel] = useState("");
  const [credential, setCredential] = useState("");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [loginId, setLoginId] = useState("founder");
  const [loginCredential, setLoginCredential] = useState("");
  const [session, setSession] = useState<OfficePersonSession | null>(() => loadOfficePersonSession());
  const [redeemInviteId, setRedeemInviteId] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemCredential, setRedeemCredential] = useState("");
  const authHeaders = (): Record<string, string> => session ? { Authorization: `Bearer ${session.accessToken}` } : {};
  const refresh = async () => {
    const [peopleResponse, invitesResponse] = await Promise.all([fetch(`${api}/api/v1/people`, { headers: authHeaders() }), fetch(`${api}/api/v1/people/invites`, { headers: authHeaders() })]);
    if (!peopleResponse.ok || !invitesResponse.ok) throw Error("People unavailable");
    setPeople((await peopleResponse.json()).people ?? []);
    setInvites((await invitesResponse.json()).invites ?? []);
  };
  useEffect(() => { void refresh().catch(() => setError("Unable to load people.")); }, [session]);
  const add = async () => {
    if (!id.trim() || !name.trim()) return;
    setError(null);
    try {
      const response = await fetch(`${api}/api/v1/people`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ id: id.trim(), display_name: name.trim(), email: email.trim() || undefined, role, mentor_id: mentorId || undefined, desk_label: deskLabel.trim() || undefined, credential: credential || undefined }) });
      if (!response.ok) throw Error("Create failed");
      setId(""); setName(""); setEmail(""); setMentorId(""); setDeskLabel(""); setCredential(""); await refresh();
    } catch { setError("Unable to create person. Use a unique safe ID."); }
  };
  const invite = async () => {
    if (!email.trim() || !name.trim() || !id.trim()) return;
    setError(null);
    try {
      const response = await fetch(`${api}/api/v1/people/invites`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ email: email.trim(), display_name: name.trim(), suggested_id: id.trim(), role, mentor_id: mentorId || undefined, desk_label: deskLabel.trim() || undefined }) });
      if (!response.ok) throw Error("Invite failed");
      const created = await response.json() as { activation_code?: unknown };
      setInviteCode(typeof created.activation_code === "string" ? created.activation_code : null);
      setId(""); setName(""); setEmail(""); setMentorId(""); setDeskLabel(""); setCredential(""); await refresh();
    } catch { setError("Unable to create invitation. Check the email and ensure it is not already pending."); }
  };
  const acceptInvite = async (inviteId: number) => {
    try {
      const response = await fetch(`${api}/api/v1/people/invites/${inviteId}/accept`, { method: "POST", headers: authHeaders() });
      if (!response.ok) throw Error("Acceptance failed");
      await refresh();
    } catch { setError("Unable to activate invitation. The suggested ID may already be in use."); }
  };
  const login = async () => {
    try {
      const response = await fetch(`${api}/api/v1/people/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: loginId.trim(), credential: loginCredential }) });
      if (!response.ok) throw Error("Login failed");
      const next = saveOfficePersonSession(await response.json());
      setSession(next); setLoginCredential(""); setError(null);
      window.dispatchEvent(new Event("office3:person-session-changed"));
    } catch { setError("Unable to start an Office session. Check the ID and access PIN."); }
  };
  const redeem = async () => {
    const inviteId = Number(redeemInviteId);
    if (!Number.isSafeInteger(inviteId) || inviteId < 1 || !redeemCode.trim() || redeemCredential.length < 4) { setError("Enter the invitation ID, one-time code, and an access PIN of at least 4 characters."); return; }
    try {
      const response = await fetch(`${api}/api/v1/people/invites/${inviteId}/redeem`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: redeemCode.trim(), credential: redeemCredential }) });
      if (!response.ok) throw Error("Redemption failed");
      const next = saveOfficePersonSession(await response.json());
      setSession(next); setRedeemCode(""); setRedeemCredential(""); setError(null);
      window.dispatchEvent(new Event("office3:person-session-changed"));
    } catch { setError("Invitation could not be redeemed. Check that the ID, code, and PIN are valid and unused."); }
  };
  const logout = () => { clearOfficePersonSession(); setSession(null); window.dispatchEvent(new Event("office3:person-session-changed")); };
  const exportConversationData = async () => {
    if (!session) return;
    try {
      const response = await fetch(`${api}/api/v1/office/conversation-data/${encodeURIComponent(session.personId)}`, { headers: authHeaders() });
      if (!response.ok) throw Error("Export failed");
      const link = document.createElement("a"), url = URL.createObjectURL(new Blob([JSON.stringify(await response.json(), null, 2)], { type: "application/json" }));
      link.href = url; link.download = `office-conversations-${session.personId}.json`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
      window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Conversation export downloaded.", priority: "success" } }));
    } catch { setError("Unable to export conversation data."); }
  };
  const deleteConversationData = async () => {
    if (!session || !window.confirm("Delete every Office message you authored and your related reports? This cannot be undone.")) return;
    try {
      const response = await fetch(`${api}/api/v1/office/conversation-data/${encodeURIComponent(session.personId)}`, { method: "DELETE", headers: authHeaders() });
      if (!response.ok) throw Error("Delete failed");
      const result = await response.json() as { deleted_messages?: number; deleted_reports?: number };
      window.dispatchEvent(new CustomEvent("office3:conversation-data-deleted", { detail: { personId: session.personId } }));
      window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `Deleted ${result.deleted_messages ?? 0} message(s) and ${result.deleted_reports ?? 0} report(s).`, priority: "success" } }));
    } catch { setError("Unable to delete your conversation data."); }
  };
  const dismissInvite = async (inviteId: number) => {
    try {
      const response = await fetch(`${api}/api/v1/people/invites/${inviteId}`, { method: "DELETE", headers: authHeaders() });
      if (!response.ok) throw Error("Dismissal failed");
      setInvites(current => current.filter(item => item.id !== inviteId));
    } catch { setError("Unable to dismiss invitation."); }
  };
  const changeRole = async (person: Person, next: Role) => {
    try { const response = await fetch(`${api}/api/v1/people/${encodeURIComponent(person.id)}/role`, { method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ role: next }) }); if (!response.ok) throw Error("Role failed"); setPeople(current => current.map(item => item.id === person.id ? { ...item, role: next } : item)); } catch { setError("Unable to change role."); }
  };
  const changeAssignment = async (person: Person, nextMentor: string, nextDesk: string) => {
    try { const response = await fetch(`${api}/api/v1/people/${encodeURIComponent(person.id)}/assignment`, { method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ mentor_id: nextMentor || null, desk_label: nextDesk.trim() || null }) }); if (!response.ok) throw Error("Assignment failed"); setPeople(current => current.map(item => item.id === person.id ? { ...item, mentor_id: nextMentor || null, desk_label: nextDesk.trim() || null } : item)); } catch { setError("Unable to save mentor or desk assignment."); }
  };
  const disable = async (person: Person) => {
    try { const response = await fetch(`${api}/api/v1/people/${encodeURIComponent(person.id)}`, { method: "DELETE", headers: authHeaders() }); if (!response.ok) throw Error("Disable failed"); setPeople(current => current.map(item => item.id === person.id ? { ...item, disabled: true } : item)); } catch { setError("Unable to disable person."); }
  };
  const mentors = people.filter(person => !person.disabled && person.id !== "founder");
  return <aside className="absolute right-3 top-14 z-40 max-h-[calc(100%-5rem)] w-96 overflow-auto rounded-xl bg-slate-950/95 p-3 text-white shadow-2xl ring-1 ring-white/15">
    <button className="float-right text-xs opacity-70" onClick={onClose}>Close</button><h2 className="mb-3 text-sm font-semibold">People, desks & mentorship</h2>
    {error && <p className="mb-2 rounded bg-rose-950 p-2 text-xs text-rose-200">{error}</p>}
    <section className="mb-3 grid gap-1 rounded bg-slate-900 p-2 text-xs"><p className="font-medium text-slate-200">Create locally or queue an invitation</p><input className="rounded bg-slate-800 p-1" placeholder="Safe ID" value={id} onChange={event => setId(event.target.value)} /><input className="rounded bg-slate-800 p-1" placeholder="Display name" value={name} onChange={event => setName(event.target.value)} /><input className="rounded bg-slate-800 p-1" placeholder="Email (required for invite)" value={email} onChange={event => setEmail(event.target.value)} /><input className="rounded bg-slate-800 p-1" type="password" minLength={4} placeholder="Access PIN (optional for local create)" value={credential} onChange={event => setCredential(event.target.value)} /><div className="flex gap-1"><select className="flex-1 rounded bg-slate-800 p-1" value={role} onChange={event => setRole(event.target.value as Role)}>{roles.map(value => <option key={value}>{value}</option>)}</select><button className="rounded bg-blue-700 px-2" onClick={() => void add()}>Create</button><button className="rounded bg-violet-700 px-2" onClick={() => void invite()}>Invite</button></div><div className="grid grid-cols-2 gap-1"><select className="rounded bg-slate-800 p-1" value={mentorId} onChange={event => setMentorId(event.target.value)}><option value="">No mentor</option>{mentors.map(person => <option key={person.id} value={person.id}>{person.display_name}</option>)}</select><input className="rounded bg-slate-800 p-1" placeholder="Desk label" value={deskLabel} onChange={event => setDeskLabel(event.target.value)} /></div></section>
    {inviteCode && <section className="mb-3 rounded bg-amber-950/60 p-2 text-xs text-amber-100"><p className="font-medium">Invitation created — share this one-time code securely.</p><code className="mt-1 block select-all break-all rounded bg-black/30 p-1">{inviteCode}</code><button className="mt-1 text-[11px] underline" onClick={() => setInviteCode(null)}>Hide code</button></section>}
    <section className="mb-3 rounded bg-slate-900 p-2 text-xs"><p className="font-medium text-slate-200">Office session</p>{session ? <><div className="mt-1 flex items-center justify-between gap-2"><span className="truncate text-emerald-200">Signed in as @{session.personId} · {session.role}</span><button className="rounded bg-slate-700 px-2 py-1 text-[11px]" onClick={logout}>Sign out</button></div><div className="mt-2 flex gap-1"><button type="button" className="rounded bg-slate-700 px-2 py-1 text-[11px]" onClick={() => void exportConversationData()}>Export my chats</button><button type="button" className="rounded bg-rose-900 px-2 py-1 text-[11px]" onClick={() => void deleteConversationData()}>Delete my chats</button></div></> : <><div className="mt-1 grid grid-cols-[1fr_1fr_auto] gap-1"><input className="min-w-0 rounded bg-slate-800 p-1" placeholder="Person ID" value={loginId} onChange={event => setLoginId(event.target.value)} /><input className="min-w-0 rounded bg-slate-800 p-1" type="password" placeholder="Access PIN" value={loginCredential} onChange={event => setLoginCredential(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void login(); }} /><button className="rounded bg-emerald-700 px-2" onClick={() => void login()}>Sign in</button></div><details className="mt-2 rounded bg-slate-800/70 p-1"><summary className="cursor-pointer text-[11px] text-slate-300">Redeem an invitation</summary><p className="mt-1 text-[11px] text-slate-400">Enter the invite number and one-time code shared by your founder, then choose your own access PIN.</p><div className="mt-1 grid grid-cols-2 gap-1"><input className="min-w-0 rounded bg-slate-900 p-1" inputMode="numeric" placeholder="Invite ID" value={redeemInviteId} onChange={event => setRedeemInviteId(event.target.value)} /><input className="min-w-0 rounded bg-slate-900 p-1" placeholder="One-time code" value={redeemCode} onChange={event => setRedeemCode(event.target.value)} /><input className="min-w-0 rounded bg-slate-900 p-1" type="password" minLength={4} placeholder="New access PIN" value={redeemCredential} onChange={event => setRedeemCredential(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void redeem(); }} /><button className="rounded bg-violet-700 px-2" onClick={() => void redeem()}>Redeem</button></div></details></>}</section>
    {invites.length > 0 && <section className="mb-3 rounded bg-violet-950/50 p-2 text-xs"><p className="mb-1 font-medium">Pending invitations ({invites.length})</p>{invites.map(item => <div key={item.id} className="flex items-center justify-between border-t border-white/10 py-1"><span>{item.display_name} · {item.email}<span className="ml-1 opacity-60">@{item.suggested_id}{item.desk_label ? ` · ${item.desk_label}` : ""}</span></span><span className="flex gap-1"><button className="rounded bg-violet-700 px-2 py-0.5 text-[11px]" onClick={() => void acceptInvite(item.id)}>Activate</button><button className="rounded bg-slate-700 px-2 py-0.5 text-[11px]" onClick={() => void dismissInvite(item.id)}>Dismiss</button></span></div>)}</section>}
    {people.map(person => <section key={person.id} className="border-t border-white/10 py-2 text-xs"><div className="flex items-center justify-between"><span>{person.display_name}<span className="ml-1 opacity-50">@{person.id}</span></span>{person.disabled && <span className="text-rose-300">disabled</span>}</div><div className="mt-1 flex gap-1"><select disabled={person.id === "founder" || person.disabled} className="flex-1 rounded bg-slate-800 p-1 disabled:opacity-50" value={person.role} onChange={event => void changeRole(person, event.target.value as Role)}>{person.id === "founder" && <option value="founder">founder</option>}{roles.map(value => <option key={value}>{value}</option>)}</select>{person.id !== "founder" && !person.disabled && <button className="rounded bg-rose-900 px-2" onClick={() => void disable(person)}>Disable</button>}</div>{!person.disabled && <div className="mt-1 grid grid-cols-2 gap-1"><select className="rounded bg-slate-800 p-1" value={person.mentor_id ?? ""} onChange={event => void changeAssignment(person, event.target.value, person.desk_label ?? "")}><option value="">No mentor</option>{mentors.filter(mentor => mentor.id !== person.id).map(mentor => <option key={mentor.id} value={mentor.id}>{mentor.display_name}</option>)}</select><input className="rounded bg-slate-800 p-1" placeholder="Desk label" defaultValue={person.desk_label ?? ""} onBlur={event => void changeAssignment(person, person.mentor_id ?? "", event.target.value)} /></div>}</section>)}
  </aside>;
}
