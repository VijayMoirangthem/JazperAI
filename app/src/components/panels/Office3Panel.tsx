"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/lib/swr";
import { useViewActive } from "@/lib/viewActive";
import { hashParams } from "@/office2/constants";
import { makeSimPeople, peopleSignature, toPeople, type DirectoryLike, type RosterLike } from "@/office2/people";
import { bindLive } from "@/office2/liveBridge";
import type { Office3Handle, Office3Stats } from "@/office3/office3";
import { useLiveAgents } from "@/stores/liveAgentsStore";
import { ViewSettings, type ViewSettings as OfficeViewSettings } from "@/office3/ui/ViewSettings";
import { Minimap3D } from "@/office3/ui/Minimap3D";
import { LookGallery } from "@/office3/ui/LookGallery";
import { CustomModelImport } from "@/office3/ui/CustomModelImport";
import { HelpOverlay } from "@/office3/ui/HelpOverlay";
import { CommandPalette } from "@/office3/ui/CommandPalette";
import { ActionBar } from "@/office3/ui/ActionBar";
import { Roster } from "@/office3/ui/Roster";
import { PeopleManager } from "@/office3/ui/PeopleManager";
import { BuilderPanel } from "@/office3/ui/BuilderPanel";
import { TaskBoard } from "@/office3/ui/TaskBoard";
import { AttentionInbox } from "@/office3/ui/AttentionInbox";
import { VisitCard, type VisitPerson } from "@/office3/ui/VisitCard";
import { Onboarding } from "@/office3/ui/Onboarding";

type JasperBridge = { savePng?(name: string, dataUrl: string): Promise<string | null>; revealSavedPng?(path: string): Promise<boolean> };
const actionPanelTips: Partial<Record<"roster" | "people" | "edit" | "tasks" | "attention" | "activity" | "minutes" | "threads" | "moderation", { id: string; text: string }>> = {
  roster: { id: "roster", text: "Tip: search the roster, then use Go to to focus that person in the Office." },
  edit: { id: "builder", text: "Tip: Builder changes are local drafts until you publish them; use the inspector for precise object edits." },
  tasks: { id: "tasks", text: "Tip: task changes update the Office activity and agent nameplate state." },
  attention: { id: "attention", text: "Tip: review the request details before approving or denying an attention item." },
  people: { id: "people", text: "Tip: People & roles manages local Office access; founder accounts cannot be disabled." },
  activity: { id: "activity", text: "Tip: filter activity by agents or Office events, then focus an eligible agent directly from an entry." },
  minutes: { id: "minutes", text: "Tip: meeting minutes are saved from completed Office meetings and can be reviewed here." },
  threads: { id: "threads", text: "Tip: open an agent thread to focus its participants or continue the conversation with the founder." },
  moderation: { id: "moderation", text: "Tip: reports from private-room conversations stay out of the moderation inbox." },
};
import { ActivityFeed } from "@/office3/ui/ActivityFeed";
import { SelectionBar } from "@/office3/ui/SelectionBar";
import { AppearanceEditor } from "@/office3/ui/AppearanceEditor";
import { ThemePicker } from "@/office3/ui/ThemePicker";
import { ZoneOverlayToggle } from "@/office3/ui/ZoneOverlayToggle";
import { MinutesDrawer } from "@/office3/ui/MinutesDrawer";
import { AgentThreadsDrawer } from "@/office3/ui/AgentThreadsDrawer";
import { ConversationDrawer } from "@/office3/ui/ConversationDrawer";
import { ModerationInbox } from "@/office3/ui/ModerationInbox";
import { Toasts } from "@/office3/ui/Toasts";
import { EmoteWheel } from "@/office3/ui/EmoteWheel";
import { FeatureTips } from "@/office3/ui/FeatureTips";
import { WelcomeChecklist } from "@/office3/ui/WelcomeChecklist";
import { MentorWelcome } from "@/office3/ui/MentorWelcome";
import { BenchmarkResult } from "@/office3/ui/BenchmarkResult";
import { parseAppearance, type Appearance } from "@/office3/core/appearance";
import { loadOfficePersonSession, officePersonAuthHeaders } from "@/office3/core/auth";
import type { World } from "@/office3/core/world";
import { safeStorage } from "@/office3/core/storage";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_URL = API.replace(/^http/, "ws") + "/ws/rpc";
type BuilderObjectPatch = { pos?: [number, number]; rot?: number; scale?: number };
const PENDING_OBJECT_PATCHES = "office3.pending-object-patches";
const pendingObjectPatches = (): Record<string, BuilderObjectPatch> => { try { const value = JSON.parse(safeStorage.get(PENDING_OBJECT_PATCHES) ?? "{}"); return value && typeof value === "object" ? value : {}; } catch { return {}; } };
const savePendingObjectPatches = (value: Record<string, BuilderObjectPatch>) => safeStorage.set(PENDING_OBJECT_PATCHES, JSON.stringify(value));
const samePatchValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const officeJsonHeaders = (): HeadersInit => ({ "Content-Type": "application/json", ...officePersonAuthHeaders() });
const canEditOfficeWorld = (authRequired: boolean) => !authRequired || ["founder", "admin"].includes(loadOfficePersonSession()?.role ?? "");
/** Retain fields changed locally after this queued request was sent. */
const withoutDeliveredFields = (current: BuilderObjectPatch | undefined, delivered: BuilderObjectPatch): BuilderObjectPatch | undefined => {
  if (!current) return undefined;
  const remaining = { ...current };
  for (const key of Object.keys(delivered) as Array<keyof BuilderObjectPatch>) if (samePatchValue(current[key], delivered[key])) delete remaining[key];
  return Object.keys(remaining).length ? remaining : undefined;
};

/** Office 3 (beta): 3D office spike. Same data and logic as Office 2, different renderer. */
export function Office3Panel() {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<Office3Handle | null>(null);
  const active = useViewActive();
  const activeRef = useRef(active);
  activeRef.current = active;
  const [stats, setStats] = useState<Office3Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [peopleManagerOpen, setPeopleManagerOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderObjectToInspect, setBuilderObjectToInspect] = useState<string | null>(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [visitPerson, setVisitPerson] = useState<VisitPerson | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [selectionCount, setSelectionCount] = useState(0);
  const [minutesOpen, setMinutesOpen] = useState(false);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [threadToOpen, setThreadToOpen] = useState<string | null>(null);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [conversation, setConversation] = useState<{ members: { slug: string; name: string; kind: "human" | "agent" | "bot" }[]; privateRoom: boolean } | null>(null);
  const [backendOnline, setBackendOnline] = useState(true);
  const [webglLost, setWebglLost] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [photoMode, setPhotoMode] = useState(false);
  const photoModeRef = useRef(photoMode);
  photoModeRef.current = photoMode;
  const [sceneEpoch, setSceneEpoch] = useState(0);
  const [refreshingScene, setRefreshingScene] = useState(false);
  const [officeRooms, setOfficeRooms] = useState<{ id: string; label: string; kind: string }[]>([]);
  const [viewSettings, setViewSettings] = useState<OfficeViewSettings | null>(null);
  const [officeAuthRequired, setOfficeAuthRequired] = useState(false);
  const [birthdayProfiles, setBirthdayProfiles] = useState<{ profiles?: { slug: string; birthday: string }[] }>();
  const viewSettingsRef = useRef<OfficeViewSettings | null>(null);
  const celebratedBirthdays = useRef(new Set<string>());
  viewSettingsRef.current = viewSettings;

  const connect = useLiveAgents((s) => s.connect);
  useEffect(() => connect(WS_URL), [connect]);
  useEffect(() => {
    let cancelled = false;
    const load = () => fetch(`${API}/api/v1/people/auth/config`).then(response => response.ok ? response.json() : null).then(value => { if (!cancelled) setOfficeAuthRequired(value?.required === true); }).catch(() => undefined);
    load();
    window.addEventListener("office3:person-session-changed", load);
    return () => { cancelled = true; window.removeEventListener("office3:person-session-changed", load); };
  }, []);
  useEffect(() => { const onCard = (event: Event) => setVisitPerson((event as CustomEvent<VisitPerson>).detail); window.addEventListener("office3:visit-card", onCard); return () => window.removeEventListener("office3:visit-card", onCard); }, []);
  useEffect(() => { const warn = () => window.dispatchEvent(new CustomEvent("office3:toast", { detail: { id: "storage-full", text: "Office local storage is full. New offline edits cannot be queued until space is available.", priority: "warning" } })); window.addEventListener("office3:storage-warning", warn); return () => window.removeEventListener("office3:storage-warning", warn); }, []);
  useEffect(() => { const refresh = () => { setRefreshingScene(true); setSceneEpoch(epoch => epoch + 1); }; window.addEventListener("office3:refresh-scene", refresh); return () => window.removeEventListener("office3:refresh-scene", refresh); }, []);
  useEffect(() => { const onSelection = (event: Event) => setSelectionCount((event as CustomEvent<number>).detail); window.addEventListener("office3:selection", onSelection); return () => window.removeEventListener("office3:selection", onSelection); }, []);
  useEffect(() => { const focus = (event: Event) => { const roomId = (event as CustomEvent<unknown>).detail; if (typeof roomId === "string") handle.current?.focusRoom(roomId); }; window.addEventListener("office3:focus-room", focus); return () => window.removeEventListener("office3:focus-room", focus); }, []);
  useEffect(() => { const focus = (event: Event) => { const point = (event as CustomEvent<unknown>).detail; if (!point || typeof point !== "object" || !("x" in point) || !("z" in point) || typeof point.x !== "number" || typeof point.z !== "number") return; handle.current?.focusPoint(point.x, point.z); }; window.addEventListener("office3:focus-point", focus); return () => window.removeEventListener("office3:focus-point", focus); }, []);
  useEffect(() => { const open = (event: Event) => { if (!canEditOfficeWorld(officeAuthRequired)) { window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "World editing requires a founder or admin Office session.", priority: "warning" } })); return; } const id = (event as CustomEvent<unknown>).detail; if (typeof id !== "string") return; setBuilderObjectToInspect(id); setBuilderOpen(true); handle.current?.setEditMode(true); }; window.addEventListener("office3:edit-object", open); return () => window.removeEventListener("office3:edit-object", open); }, [officeAuthRequired]);
  useEffect(() => { const onInteraction = (event: Event) => { if ((event as CustomEvent<string>).detail === "whiteboard") setTasksOpen(true); }; window.addEventListener("office3:interaction", onInteraction); return () => window.removeEventListener("office3:interaction", onInteraction); }, []);
  useEffect(() => { const open = () => setTasksOpen(true); window.addEventListener("office3:open-task-board", open); return () => window.removeEventListener("office3:open-task-board", open); }, []);
  useEffect(() => { const open = (event: Event) => { const thread = (event as CustomEvent<{ thread?: unknown }>).detail?.thread; if (typeof thread !== "string") return; setThreadToOpen(thread); setThreadsOpen(true); }; window.addEventListener("office3:open-agent-thread", open); return () => window.removeEventListener("office3:open-agent-thread", open); }, []);
  useEffect(() => {
    const onAttention = (event: Event) => {
      setAttentionOpen(true);
      window.dispatchEvent(new CustomEvent("office3:toast", { detail: { id: "attention", text: "An agent needs your approval.", priority: "warning" } }));
      const settings = viewSettingsRef.current;
      if (!document.hidden || settings?.notifications === false || settings?.doNotDisturb || typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const slug = (event as CustomEvent<unknown>).detail;
      const notice = new Notification("Office 3: approval needed", { body: typeof slug === "string" ? `${slug} is waiting for your decision.` : "An agent is waiting for your decision." });
      notice.onclick = () => { window.focus(); setAttentionOpen(true); notice.close(); };
      window.setTimeout(() => notice.close(), 7000);
    };
    window.addEventListener("office3:attention", onAttention);
    return () => window.removeEventListener("office3:attention", onAttention);
  }, []);
  useEffect(() => { const onResolved = (event: Event) => { const detail = (event as CustomEvent<{ agent?: string; approved: boolean }>).detail; if (detail.agent) handle.current?.resolveAttention(detail.agent, detail.approved); }; window.addEventListener("office3:approval-resolved", onResolved); return () => window.removeEventListener("office3:approval-resolved", onResolved); }, []);
  useEffect(() => { type ConversationEvent = { members: { slug: string; name: string; kind: "human" | "agent" | "bot" }[]; privateRoom: boolean }; const detail = (event: Event): ConversationEvent | null => { const value = (event as CustomEvent<unknown>).detail; if (Array.isArray(value)) return { members: value as ConversationEvent["members"], privateRoom: false }; const payload = value as { members?: unknown; privateRoom?: unknown } | null; if (!payload || !Array.isArray(payload.members)) return null; return { members: payload.members as ConversationEvent["members"], privateRoom: payload.privateRoom === true }; }; const open = (event: Event) => { const next = detail(event); if ((next?.members.length ?? 0) > 1) setConversation(next); }; const group = (event: Event) => { const next = detail(event); if ((next?.members.length ?? 0) > 1) setConversation(current => current ?? next); }; window.addEventListener("office3:open-conversation", open); window.addEventListener("office3:conversation-group", group); return () => { window.removeEventListener("office3:open-conversation", open); window.removeEventListener("office3:conversation-group", group); }; }, []);
  useEffect(() => { const check = () => fetch(`${API}/health`).then(response => setBackendOnline(response.ok)).catch(() => setBackendOnline(false)); check(); const timer = window.setInterval(check, 15000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!backendOnline) return;
    const pending = pendingObjectPatches(), entries = Object.entries(pending);
    if (!entries.length) return;
    let stopped = false;
    void Promise.allSettled(entries.map(async ([id, patch]) => {
      const response = await fetch(`${API}/api/v1/office/world/objects/${encodeURIComponent(id)}`, { method: "PATCH", headers: officeJsonHeaders(), body: JSON.stringify(patch) });
      if (!response.ok) throw Error("replay failed");
      return [id, patch, await response.json()] as const;
    })).then(outcomes => {
      if (stopped) return;
      const results = outcomes.flatMap(outcome => outcome.status === "fulfilled" ? [outcome.value] : []);
      if (!results.length) return;
      const remaining = pendingObjectPatches();
      for (const [id, sent, value] of results) {
        const newer = withoutDeliveredFields(remaining[id], sent);
        if (newer) remaining[id] = newer; else delete remaining[id];
        if (value.object) {
          const resolved = { ...value.object, ...newer };
          handle.current?.applyObjectTransform(id, resolved);
        }
      }
      savePendingObjectPatches(remaining);
      window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `${results.length} queued builder edit${results.length === 1 ? "" : "s"} saved.`, priority: "success" } }));
    }).catch(() => undefined);
    return () => { stopped = true; };
  }, [backendOnline]);
  useEffect(() => { const lost = () => setWebglLost(true); const restored = () => { setWebglLost(false); setRefreshingScene(true); setSceneEpoch(epoch => epoch + 1); }; window.addEventListener("office3:webgl-lost", lost); window.addEventListener("office3:webgl-restored", restored); return () => { window.removeEventListener("office3:webgl-lost", lost); window.removeEventListener("office3:webgl-restored", restored); }; }, []);
  useEffect(() => { const toggle = (event: KeyboardEvent) => { if (event.key === "Escape") { setSettingsOpen(false); return; } if (event.key.toLowerCase() !== (viewSettingsRef.current?.settingsKey ?? "v") || event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return; event.preventDefault(); setSettingsOpen(open => !open); }; window.addEventListener("keydown", toggle); return () => window.removeEventListener("keydown", toggle); }, []);
  useEffect(() => { const toggle = (event: KeyboardEvent) => { if (event.key.toLowerCase() !== (viewSettingsRef.current?.photoKey ?? "p") || event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return; event.preventDefault(); setPhotoMode(current => { const next = !current; handle.current?.setPhotoMode(next); return next; }); }; window.addEventListener("keydown", toggle); return () => window.removeEventListener("keydown", toggle); }, []);
  const { data: directory } = useApi<DirectoryLike>(`${API}/api/v1/directory/`, { ttl: 30000, poll: 30000 });
  const { data: roster } = useApi<RosterLike>(`${API}/api/v1/bots/`, { ttl: 5000, poll: 5000 });
  useEffect(() => {
    let cancelled = false;
    const load = () => fetch(`${API}/api/v1/office/profiles/list`, { headers: officePersonAuthHeaders() })
      .then(response => response.ok ? response.json() : null)
      .then(value => { if (!cancelled && value) setBirthdayProfiles(value); })
      .catch(() => undefined);
    load();
    const timer = window.setInterval(load, 300000);
    window.addEventListener("office3:person-session-changed", load);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("office3:person-session-changed", load); };
  }, []);
  const people = useMemo(() => {
    const requestedBots = Number(hashParams().get("bots") ?? 0);
    const sim = Math.max(Number.isFinite(requestedBots) ? requestedBots : 0, hashParams().get("bench") === "1" ? 120 : 0);
    return [...toPeople(directory, roster), ...(sim > 0 ? makeSimPeople(sim) : [])];
  }, [directory, roster]);
  const sig = peopleSignature(people);
  const peopleRef = useRef(people);
  peopleRef.current = people;

  useEffect(() => {
    let cancelled = false;
    let h: Office3Handle | null = null;
    let unbind: (() => void) | null = null;
    (async () => {
      try {
        const { startOffice3 } = await import("@/office3/office3");
        if (cancelled || !host.current) return;
        h = await startOffice3(host.current);
        if (cancelled) { h.destroy(); return; }
        handle.current = h;
        setRefreshingScene(false);
        setOfficeRooms(h.rooms());
        if (!activeRef.current) h.setActive(false);
        if (photoModeRef.current) h.setPhotoMode(true);
        h.sync(peopleRef.current);
        if (viewSettingsRef.current) h.setViewSettings(viewSettingsRef.current);
        try {
          const saved = localStorage.getItem("office3.appearance");
          if (saved) { const appearance = parseAppearance(JSON.parse(saved)); h.setFounderAppearance(appearance); window.dispatchEvent(new CustomEvent("office3:appearance-changed", { detail: appearance })); }
        } catch { localStorage.removeItem("office3.appearance"); }
        const customModel = localStorage.getItem("office3.customModel");
        if (customModel) void h.setFounderCustomModel(customModel).catch(() => { localStorage.removeItem("office3.customModel"); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "The saved custom model could not be loaded and was cleared.", priority: "warning" } })); });
        unbind = bindLive({ applyLive: (l) => h?.applyLive(l) });
      } catch (e) { console.error("office3 init failed", e); setErr(String(e)); setRefreshingScene(false); }
    })();
    const t = setInterval(() => { if (handle.current) setStats(handle.current.stats()); }, 1000);
    return () => { cancelled = true; clearInterval(t); unbind?.(); h?.destroy(); handle.current = null; };
  }, [sceneEpoch]);

  useEffect(() => { handle.current?.sync(peopleRef.current); }, [sig]);
  useEffect(() => { const today = new Date(), key = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`; for (const profile of birthdayProfiles?.profiles ?? []) { const once = `${key}:${profile.slug}`; if (profile.birthday !== key || celebratedBirthdays.current.has(once)) continue; celebratedBirthdays.current.add(once); window.setTimeout(() => window.dispatchEvent(new CustomEvent("office3:birthday", { detail: { slug: profile.slug } })), 500); } }, [birthdayProfiles]);
  useEffect(() => { handle.current?.setActive(active); }, [active]);
  useEffect(() => { if (viewSettings) handle.current?.setViewSettings(viewSettings); }, [viewSettings]);
  useEffect(() => {
    const founder = people.find((person) => person.kind === "human");
    if (!founder) return;
    let cancelled = false;
    fetch(`${API}/api/v1/office/appearance/${encodeURIComponent(founder.slug)}`, { headers: officePersonAuthHeaders() })
      .then((response) => response.ok && response.status !== 204 ? response.json() : null)
      .then((saved) => { if (!cancelled && saved) { const appearance = parseAppearance(saved); handle.current?.setFounderAppearance(appearance); window.dispatchEvent(new CustomEvent("office3:appearance-changed", { detail: appearance })); } })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [people, sig]);

  const applyFounderAppearance = (appearance: Appearance) => {
    handle.current?.setFounderAppearance(appearance);
    window.dispatchEvent(new CustomEvent("office3:appearance-changed", { detail: appearance }));
    const founder = peopleRef.current.find((person) => person.kind === "human");
    if (!founder) return;
    fetch(`${API}/api/v1/office/appearance/${encodeURIComponent(founder.slug)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...officePersonAuthHeaders() },
      body: JSON.stringify({ appearance }),
    }).catch((error) => console.warn("Office appearance persistence failed", error));
  };
  const applyTheme = async (id: string) => {
    handle.current?.setTheme(id);
    try {
      const currentResponse = await fetch(`${API}/api/v1/office/world`);
      if (!currentResponse.ok) throw Error("Unable to load Office world");
      const current = await currentResponse.json();
      const response = await fetch(`${API}/api/v1/office/world`, { method: "PUT", headers: officeJsonHeaders(), body: JSON.stringify({ world: { ...current.world, theme: id }, rev: current.rev }) });
      if (!response.ok) throw Error("Unable to save Office theme");
    } catch (error) { console.warn("Office theme persistence failed", error); }
  };
  const updateRoomRules = async (roomId: string, rules: { silent: boolean; focusable: boolean; capacity: number; tooltip?: string; roles?: Array<"founder" | "member">; locked?: boolean; ambience?: "none" | "focus" | "social" | "meeting" }) => {
    const currentResponse = await fetch(`${API}/api/v1/office/world`);
    if (!currentResponse.ok) throw Error("Unable to load Office world");
    const current = await currentResponse.json();
    const rooms = current.world.rooms.map((room: { id: string; rules: object }) => room.id === roomId ? { ...room, rules: { ...room.rules, ...rules } } : room);
    const response = await fetch(`${API}/api/v1/office/world`, { method: "PUT", headers: officeJsonHeaders(), body: JSON.stringify({ world: { ...current.world, rooms }, rev: current.rev }) });
    if (!response.ok) throw Error("Unable to save zone rules");
    handle.current?.applyRoomRules(roomId, rules);
  };
  const resizeBuilderRoom = async (roomId: string, rect: [number, number, number, number]) => {
    const currentResponse = await fetch(`${API}/api/v1/office/world`);
    if (!currentResponse.ok) throw Error("Unable to load Office world");
    const current = await currentResponse.json();
    const rooms = current.world.rooms.map((room: { id: string; rect: [number, number, number, number] }) => room.id === roomId ? { ...room, rect } : room);
    const response = await fetch(`${API}/api/v1/office/world`, { method: "PUT", headers: officeJsonHeaders(), body: JSON.stringify({ world: { ...current.world, rooms }, rev: current.rev }) });
    if (!response.ok) throw Error("Unable to resize room");
    handle.current?.applyRoomRect(roomId, rect);
    window.dispatchEvent(new Event("office3:refresh-minimap"));
  };
  const updateBuilderObject = async (id: string, patch: BuilderObjectPatch) => {
    try {
      const response = await fetch(`${API}/api/v1/office/world/objects/${encodeURIComponent(id)}`, { method: "PATCH", headers: officeJsonHeaders(), body: JSON.stringify(patch) });
      if (!response.ok) throw Error("Unable to save object");
      const value = await response.json();
      handle.current?.applyObjectTransform(id, value.object ?? patch);
    } catch (reason) {
      if (!(reason instanceof TypeError)) throw reason;
      const pending = pendingObjectPatches(); savePendingObjectPatches({ ...pending, [id]: { ...pending[id], ...patch } });
      handle.current?.applyObjectTransform(id, patch);
      setBackendOnline(false);
      window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Builder edit saved locally and will retry when Office reconnects.", priority: "warning" } }));
    }
  };
  const claimFounderDesk = async (seatId: string) => {
    const founder = peopleRef.current.find(person => person.kind === "human");
    if (!founder) throw Error("Founder is unavailable");
    const currentResponse = await fetch(`${API}/api/v1/office/world`);
    if (!currentResponse.ok) throw Error("Unable to load Office world");
    const current = await currentResponse.json();
    const seat = current.world.seats.find((item: { id: string; owner: string | null }) => item.id === seatId);
    if (!seat || seat.owner || current.world.seats.some((item: { owner: string | null }) => item.owner === founder.slug)) throw Error("Desk is unavailable");
    const seats = current.world.seats.map((item: { id: string; owner: string | null }) => item.id === seatId ? { ...item, owner: founder.slug } : item);
    const response = await fetch(`${API}/api/v1/office/world`, { method: "PUT", headers: officeJsonHeaders(), body: JSON.stringify({ world: { ...current.world, seats }, rev: current.rev }) });
    if (!response.ok) throw Error("Unable to claim desk");
  };
  const setSpawnFromRoom = async (roomId: string) => {
    const currentResponse = await fetch(`${API}/api/v1/office/world`);
    if (!currentResponse.ok) throw Error("Unable to load Office world");
    const current = await currentResponse.json();
    const room = current.world.rooms.find((item: { id: string; rect: [number, number, number, number] }) => item.id === roomId);
    if (!room) throw Error("Room is unavailable");
    const [left, top, right, bottom] = room.rect;
    const position: [number, number] = [Math.floor((left + right) / 2), Math.floor((top + bottom) / 2)];
    const response = await fetch(`${API}/api/v1/office/world`, { method: "PUT", headers: officeJsonHeaders(), body: JSON.stringify({ world: { ...current.world, spawn: { founder: position, default: position } }, rev: current.rev }) });
    if (!response.ok) throw Error("Unable to save spawn point");
    handle.current?.setFounderSpawn(position);
  };
  const publishBuilderDraft = async (force = false) => {
    const currentResponse = await fetch(`${API}/api/v1/office/world`);
    if (!currentResponse.ok) throw Error("Unable to load the current Office world");
    const current = await currentResponse.json();
    const builderDraftStorageKey = `office3.builder.draft.${typeof current.world?.id === "string" ? current.world.id : "default"}`;
    const draft = JSON.parse(localStorage.getItem(builderDraftStorageKey) ?? "{\"objects\":[]}") as { objects?: { key: string; prefab: string; rot?: number }[]; seats?: unknown[] };
    const objects = (draft.objects ?? []).flatMap((item, index) => { const [x, z] = item.key.split(",").map(Number); return Number.isFinite(x) && Number.isFinite(z) ? [{ id: `draft-${Date.now()}-${index}`, prefab: item.prefab, pos: [x, z], rot: Number.isFinite(item.rot) ? item.rot : 0, scale: 1, props: {} }] : []; });
    const seats = (draft.seats ?? []).filter((seat): seat is { id: string; room: string; pos: [number, number]; facing: "up"|"down"|"left"|"right"; owner: null } => Boolean(seat && typeof seat === "object" && "id" in seat && "room" in seat && "pos" in seat && "facing" in seat));
    const publish = async (base: { world: { objects: unknown[]; seats: { room: string; pos: [number, number] }[] }; rev: number }) => fetch(`${API}/api/v1/office/world`, { method: "PUT", headers: officeJsonHeaders(), body: JSON.stringify({ world: { ...base.world, objects: [...base.world.objects, ...objects], seats: [...base.world.seats, ...seats.filter(seat => !base.world.seats.some(existing => existing.room === seat.room && existing.pos[0] === seat.pos[0] && existing.pos[1] === seat.pos[1]))] }, rev: base.rev }) });
    let response = await publish(current);
    if (response.status === 409 && force) { const latestResponse = await fetch(`${API}/api/v1/office/world`); if (!latestResponse.ok) throw Error("WORLD_CONFLICT"); response = await publish(await latestResponse.json()); }
    if (response.status === 409) throw Error("WORLD_CONFLICT");
    if (!response.ok) throw Error("Unable to publish Office draft");
    localStorage.removeItem(builderDraftStorageKey);
  };
  const importBuilderWorld = async (world: World) => {
    const currentResponse = await fetch(`${API}/api/v1/office/world`);
    if (!currentResponse.ok) throw Error("Unable to load the current Office world");
    const current = await currentResponse.json();
    const response = await fetch(`${API}/api/v1/office/world`, { method: "PUT", headers: officeJsonHeaders(), body: JSON.stringify({ world, rev: current.rev }) });
    if (response.status === 409) throw Error("WORLD_CONFLICT");
    if (!response.ok) throw Error("Unable to import Office world");
    // Import replaces the active world's persisted layout, so an older draft
    // must not be reapplied over the imported layout on the next scene build.
    const previousId = typeof current.world?.id === "string" ? current.world.id : "default";
    localStorage.removeItem(`office3.builder.draft.${previousId}`);
    localStorage.removeItem(`office3.builder.draft.${world.id}`);
  };
  const closeActionPanels = () => {
    setRosterOpen(false); setPeopleManagerOpen(false); setBuilderOpen(false); setTasksOpen(false); setAttentionOpen(false);
    setActivityOpen(false); setMinutesOpen(false); setThreadsOpen(false); setThreadToOpen(null); setModerationOpen(false); setVisitPerson(null); setConversation(null);
    handle.current?.setEditMode(false);
  };
  const showFeatureTip = (id: string, text: string) => window.dispatchEvent(new CustomEvent("office3:feature-tip", { detail: { id, text } }));
  const openActionPanel = (panel: "roster" | "people" | "edit" | "tasks" | "attention" | "activity" | "minutes" | "threads" | "moderation") => {
    if (panel === "edit" && !canEditOfficeWorld(officeAuthRequired)) { window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "World editing requires a founder or admin Office session.", priority: "warning" } })); return; }
    closeActionPanels();
    const tip = actionPanelTips[panel];
    if (tip) showFeatureTip(tip.id, tip.text);
    if (panel === "roster") setRosterOpen(true);
    if (panel === "people") setPeopleManagerOpen(true);
    if (panel === "edit") { handle.current?.setEditMode(true); setBuilderOpen(true); }
    if (panel === "tasks") setTasksOpen(true);
    if (panel === "attention") setAttentionOpen(true);
    if (panel === "activity") setActivityOpen(true);
    if (panel === "minutes") setMinutesOpen(true);
    if (panel === "threads") setThreadsOpen(true);
    if (panel === "moderation") setModerationOpen(true);
  };
  const togglePhotoMode = () => setPhotoMode(current => { const next = !current; handle.current?.setPhotoMode(next); if (next) showFeatureTip("photo", "Tip: use Download PNG for a normal capture, or Transparent PNG for an alpha-background export."); return next; });
  const downloadPhoto = (transparent = false) => {
    const image = handle.current?.capturePng(transparent);
    if (!image) return;
    const name = `jazper-office${transparent ? "-transparent" : ""}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    const bridge = (window as Window & { jasper?: JasperBridge }).jasper;
    if (bridge?.savePng) {
      void bridge.savePng(name, image).then(saved => {
        if (saved) window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Office photo saved to Pictures.", priority: "success", action: bridge.revealSavedPng ? { label: "Show in folder", run: () => { void bridge.revealSavedPng?.(saved); } } : undefined } }));
        else window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Office photo could not be saved to Pictures.", priority: "warning" } }));
      }).catch(() => window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Office photo could not be saved to Pictures.", priority: "warning" } })));
      return;
    }
    const link = document.createElement("a");
    link.href = image;
    link.download = name;
    link.click();
  };

  return (
    <div className="relative h-full min-h-[560px] w-full">
      <div ref={host} data-testid="office3-host" className="absolute inset-0" />
      <div className={photoMode ? "hidden" : ""}>
      <Toasts enabled={viewSettings?.notifications ?? true} doNotDisturb={viewSettings?.doNotDisturb ?? false} />
      <FeatureTips />
      <WelcomeChecklist onOpenRoster={() => openActionPanel("roster")} />
      <MentorWelcome people={people} onMeet={slug => { const founder = people.find(person => person.kind === "human"); const mentor = people.find(person => person.slug === slug); if (!founder || !mentor) return; handle.current?.focusPerson(slug); setConversation({ members: [founder, mentor], privateRoom: false }); }} />
      <BenchmarkResult />
      <EmoteWheel />
      {refreshingScene && <div className="absolute inset-0 z-40 grid place-items-center bg-slate-950/65 text-sm text-white" role="status">Refreshing the latest Office world…</div>}
      {!backendOnline && <div className="absolute left-1/2 top-3 z-50 -translate-x-1/2 rounded-lg bg-amber-900/95 px-3 py-2 text-xs text-amber-100 shadow-lg">Office is offline. Local scene controls remain available; saved changes will retry when the backend returns.</div>}
      {webglLost && <div className="absolute inset-0 z-50 grid place-items-center bg-slate-950/95 p-6 text-center text-white"><div><h2 className="text-lg font-semibold">Office 3 graphics paused</h2><p className="mt-2 text-sm text-slate-300">WebGL was lost by the graphics driver. When it returns, Office 3 rebuilds automatically. You can also retry the scene now or use Office 2.</p><div className="mt-4 flex justify-center gap-2"><button className="rounded bg-blue-700 px-3 py-2 text-sm" onClick={() => window.dispatchEvent(new Event("office3:refresh-scene"))}>Retry Office 3</button><button className="rounded bg-slate-700 px-3 py-2 text-sm" onClick={() => { location.hash = "office2"; }}>Open Office 2</button></div></div></div>}
      <ViewSettings onChange={setViewSettings} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Minimap3D />
      <LookGallery onSelect={applyFounderAppearance} />
      <AppearanceEditor onApply={applyFounderAppearance} soundEnabled={viewSettings?.sound ?? true} />
      <ThemePicker onChange={applyTheme} />
      <ZoneOverlayToggle onChange={(visible) => handle.current?.setZoneOverlay(visible)} />
      <CustomModelImport onImported={async url => { const scene = handle.current; if (!scene) throw Error("Office 3 is still loading."); await scene.setFounderCustomModel(url); }} />
      <HelpOverlay />
      <CommandPalette people={people} rooms={officeRooms} onGo={(slug) => handle.current?.focusPerson(slug)} onGoRoom={id => handle.current?.focusRoom(id)} onAction={action => { if (action === "appearance") { closeActionPanels(); showFeatureTip("appearance", "Tip: choose a look or fine-tune appearance; your selection stays synced with the live 3D founder." ); window.dispatchEvent(new Event("office3:open-appearance-editor")); } else if (action === "chat") { closeActionPanels(); showFeatureTip("chat", "Tip: team chat stays available outside the 3D Office; return here to see agents in context." ); location.hash = "team_chat"; } else if (action === "photo") { closeActionPanels(); togglePhotoMode(); } else if (action === "settings") { closeActionPanels(); showFeatureTip("settings", "Tip: settings are saved locally and apply to the current Office scene immediately." ); setSettingsOpen(true); } else if (action === "help") window.dispatchEvent(new Event("office3:open-help")); else openActionPanel(action); }} />
      <ActionBar onRoster={() => openActionPanel("roster")} onPeople={() => openActionPanel("people")} onAppearance={() => { closeActionPanels(); showFeatureTip("appearance", "Tip: choose a look or fine-tune appearance; your selection stays synced with the live 3D founder."); window.dispatchEvent(new Event("office3:open-appearance-editor")); }} onChat={() => { closeActionPanels(); showFeatureTip("chat", "Tip: team chat stays available outside the 3D Office; return here to see agents in context."); location.hash = "team_chat"; }} onEdit={() => openActionPanel("edit")} onTasks={() => openActionPanel("tasks")} onAttention={() => openActionPanel("attention")} onActivity={() => openActionPanel("activity")} onMinutes={() => openActionPanel("minutes")} onThreads={() => openActionPanel("threads")} onModeration={() => openActionPanel("moderation")} onPhoto={togglePhotoMode} onSettings={() => { closeActionPanels(); showFeatureTip("settings", "Tip: settings are saved locally and apply to the current Office scene immediately."); setSettingsOpen(true); }} />
      {rosterOpen && <Roster people={people} onClose={() => setRosterOpen(false)} onGo={(slug) => { handle.current?.focusPerson(slug); setRosterOpen(false); }} />}
      {peopleManagerOpen && <PeopleManager api={API} onClose={() => setPeopleManagerOpen(false)} />}
      {builderOpen && <BuilderPanel initialObjectId={builderObjectToInspect} onSelect={(id) => handle.current?.setBuilderPrefab(id)} onTemplate={(room, template) => handle.current?.insertRoomTemplate(room, template)} onAutoFurnish={room => handle.current?.autoFurnishRoom(room)} onApplyRoomRules={updateRoomRules} onResizeRoom={resizeBuilderRoom} onClaimDesk={claimFounderDesk} onSetSpawn={setSpawnFromRoom} onUpdateObject={updateBuilderObject} onSaveDraft={() => handle.current?.saveBuilderDraft()} onSnapshot={async () => { const response = await fetch(`${API}/api/v1/office/snapshots`, { method: "POST", headers: officePersonAuthHeaders() }); if (!response.ok) throw Error("Unable to save snapshot"); }} onRestoreSnapshot={async id => { const response = await fetch(`${API}/api/v1/office/snapshots/${id}/restore`, { method: "POST", headers: officePersonAuthHeaders() }); if (!response.ok) throw Error("Unable to restore snapshot"); }} onPublish={publishBuilderDraft} onImportWorld={importBuilderWorld} onLockRoom={async room => { const response = await fetch(`${API}/api/v1/office/rooms/${encodeURIComponent(room)}/lock`, { method: "POST", headers: officeJsonHeaders(), body: JSON.stringify({ editor: "founder" }) }); if (!response.ok) throw Error("Unable to reserve room"); }} onUnlockRoom={async room => { await fetch(`${API}/api/v1/office/rooms/${encodeURIComponent(room)}/lock?editor=founder`, { method: "DELETE", headers: officePersonAuthHeaders() }); }} onClose={() => { handle.current?.setEditMode(false); setBuilderOpen(false); }} />}
      {tasksOpen && <TaskBoard onClose={() => setTasksOpen(false)} />}
      {attentionOpen && <AttentionInbox onClose={() => setAttentionOpen(false)} />}
      {visitPerson && <VisitCard person={visitPerson} onClose={() => setVisitPerson(null)} />}
      {activityOpen && <ActivityFeed onClose={() => setActivityOpen(false)} onGo={slug => { handle.current?.focusPerson(slug); setActivityOpen(false); }} />}
      {minutesOpen && <MinutesDrawer onClose={() => setMinutesOpen(false)} />}
      {threadsOpen && <AgentThreadsDrawer openThreadId={threadToOpen} onClose={() => { setThreadsOpen(false); setThreadToOpen(null); }} onFocus={slug => { handle.current?.focusPerson(slug); setThreadsOpen(false); setThreadToOpen(null); }} onOpen={thread => { const founder = people.find(person => person.kind === "human"); const agent = people.find(person => person.kind !== "human" && (person.slug === thread.from_slug || person.slug === thread.to_slug)); if (agent) handle.current?.focusPerson(agent.slug); if (founder && agent) setConversation({ members: [founder, agent], privateRoom: false }); setThreadsOpen(false); setThreadToOpen(null); }} />}
      {moderationOpen && <ModerationInbox onClose={() => setModerationOpen(false)} />}
      {conversation && <ConversationDrawer members={conversation.members} privateRoom={conversation.privateRoom} onClose={() => setConversation(null)} />}
      <SelectionBar count={selectionCount} onClear={() => window.dispatchEvent(new Event("office3:clear-selection"))} />
      <Onboarding />
      <div className="absolute left-3 top-3 rounded-lg bg-black/60 px-3 py-2 text-xs ring-1 ring-white/15" data-testid="office3-hud">
        <div className="font-semibold">Office 3 (beta, 3D)</div>
        {stats && viewSettings?.fps && <div className="opacity-80">{stats.fps} fps · {stats.people} people · {stats.calls} draw calls · {(stats.triangles / 1000).toFixed(0)}k tris</div>}
        <div className="opacity-50">drag = pan · right-drag = rotate · wheel = zoom</div>
        {err && <div className="text-red-300">{err}</div>}
      </div>
      </div>
      {photoMode && <div className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-xl bg-slate-950/85 p-2 text-xs text-white shadow-xl ring-1 ring-white/15"><button className="rounded px-2 py-1 hover:bg-slate-700" onClick={() => downloadPhoto()}>Download PNG</button><button className="ml-1 rounded px-2 py-1 hover:bg-slate-700" onClick={() => downloadPhoto(true)}>Transparent PNG</button><button className="ml-1 rounded px-2 py-1 hover:bg-slate-700" onClick={togglePhotoMode}>Exit photo · P</button></div>}
    </div>
  );
}
