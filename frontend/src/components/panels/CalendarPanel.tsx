"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Calendar, ChevronLeft, ChevronRight, Plus, Trash2,
  Clock, MapPin, Users, Video, RefreshCw, Loader2, AlertCircle,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CalEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string;
  description: string;
  meet_link: string;
  attendees: string[];
  all_day: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function startOfWeek(d: Date): Date {
  const c = new Date(d);
  const day = c.getDay(); // 0 = Sun
  c.setDate(c.getDate() - day);
  c.setHours(0, 0, 0, 0);
  return c;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmt(isoStr: string): string {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr.replace("Z", "+00:00"));
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return isoStr;
  }
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── Sub-components ────────────────────────────────────────────────────────────

function EventCard({ event, onDelete }: { event: CalEvent; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="group rounded-lg border border-white/10 bg-white/5 px-3 py-2 cursor-pointer hover:bg-white/10 transition"
      onClick={() => setExpanded((p) => !p)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-white truncate">{event.title}</span>
        <div className="flex items-center gap-1.5 shrink-0 text-xs text-white/50">
          <Clock size={11} />
          <span>{fmt(event.start)}</span>
          {event.meet_link && <Video size={11} className="text-blue-400" />}
          <button
            className="opacity-0 group-hover:opacity-100 ml-1 text-red-400 hover:text-red-300"
            onClick={(e) => { e.stopPropagation(); onDelete(event.id); }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="mt-2 space-y-1 text-xs text-white/60">
          <div>{fmt(event.start)} → {fmt(event.end)}</div>
          {event.location && (
            <div className="flex items-center gap-1"><MapPin size={10} />{event.location}</div>
          )}
          {event.meet_link && (
            <a href={event.meet_link} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-blue-400 hover:underline"
              onClick={(e) => e.stopPropagation()}>
              <Video size={10} />Join Google Meet
            </a>
          )}
          {event.attendees.length > 0 && (
            <div className="flex items-center gap-1"><Users size={10} />{event.attendees.join(", ")}</div>
          )}
          {event.description && (
            <div className="text-white/40 italic line-clamp-2">{event.description}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Create Event Modal ─────────────────────────────────────────────────────────

interface CreateForm {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  description: string;
  location: string;
  attendees: string;
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<CreateForm>({
    title: "", date: isoDate(new Date()), startTime: "10:00",
    endTime: "11:00", description: "", location: "", attendees: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof CreateForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const start = `${form.date}T${form.startTime}:00`;
      const end   = `${form.date}T${form.endTime}:00`;
      const attendees = form.attendees.split(",").map((a) => a.trim()).filter(Boolean);
      const res = await fetch(`${API}/api/calendar/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title, start, end,
          description: form.description, location: form.location, attendees,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || res.statusText);
      }
      onCreated();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create event");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#1a1a2e] p-6 shadow-2xl">
        <h3 className="mb-4 text-lg font-semibold text-white">New Event</h3>
        <form onSubmit={submit} className="space-y-3">
          {[
            { label: "Title *", key: "title" as const, type: "text", required: true },
            { label: "Date", key: "date" as const, type: "date" },
            { label: "Start time", key: "startTime" as const, type: "time" },
            { label: "End time", key: "endTime" as const, type: "time" },
            { label: "Location", key: "location" as const, type: "text" },
            { label: "Attendees (comma-sep emails)", key: "attendees" as const, type: "text" },
          ].map(({ label, key, type, required }) => (
            <div key={key}>
              <label className="mb-1 block text-xs text-white/50">{label}</label>
              <input
                type={type}
                value={form[key]}
                onChange={set(key)}
                required={required}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
              />
            </div>
          ))}
          <div>
            <label className="mb-1 block text-xs text-white/50">Description</label>
            <textarea
              value={form.description}
              onChange={set("description")}
              rows={2}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500 resize-none"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-white/10 py-2 text-sm text-white/60 hover:bg-white/5">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 flex items-center justify-center gap-2">
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function CalendarPanel() {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [notAuthorized, setNotAuthorized] = useState(false);

  const fetchWeek = useCallback(async (ws: Date) => {
    setLoading(true);
    setError("");
    setNotAuthorized(false);
    try {
      const start = ws.toISOString().slice(0, 10);
      const res = await fetch(`${API}/api/calendar/week?start=${start}`);
      if (res.status === 401) {
        setNotAuthorized(true);
        return;
      }
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchWeek(weekStart); }, [weekStart, fetchWeek]);

  async function deleteEvent(id: string) {
    try {
      await fetch(`${API}/api/calendar/events/${id}`, { method: "DELETE" });
      setEvents((ev) => ev.filter((e) => e.id !== id));
    } catch {
      // silent — event remains in list
    }
  }

  function prevWeek() { setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; }); }
  function nextWeek() { setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; }); }
  function thisWeek() { setWeekStart(startOfWeek(new Date())); }

  // Group events by day-of-week (0–6)
  const byDay: Record<number, CalEvent[]> = {};
  for (let i = 0; i < 7; i++) byDay[i] = [];
  events.forEach((ev) => {
    try {
      const d = new Date(ev.start.replace("Z", "+00:00"));
      const dow = d.getDay();
      byDay[dow].push(ev);
    } catch { /* skip unparseable */ }
  });

  const today = isoDate(new Date());

  return (
    <div className="flex h-full flex-col gap-4 p-6 text-white overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar size={22} className="text-indigo-400" />
          <h2 className="text-xl font-semibold">Calendar</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => fetchWeek(weekStart)} title="Refresh"
            className="rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
          <button onClick={thisWeek}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10">
            Today
          </button>
          <button onClick={prevWeek}
            className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white">
            <ChevronLeft size={16} />
          </button>
          <button onClick={nextWeek}
            className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white">
            <ChevronRight size={16} />
          </button>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium hover:bg-indigo-500">
            <Plus size={14} />New Event
          </button>
        </div>
      </div>

      {/* Week label */}
      <p className="text-sm text-white/40">
        {dayLabel(weekStart)} — {dayLabel(new Date(weekStart.getTime() + 6 * 86400000))}
      </p>

      {/* Auth notice */}
      {notAuthorized && (
        <div className="flex items-center gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-300">
          <AlertCircle size={18} />
          <span>Google Calendar not connected. Re-authenticate at <strong>Settings → Google</strong>.</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle size={16} />{error}
        </div>
      )}

      {/* Week grid */}
      {!notAuthorized && (
        <div className="grid grid-cols-7 gap-2">
          {DAYS.map((_, i) => {
            const dayDate = new Date(weekStart.getTime() + i * 86400000);
            const isToday = isoDate(dayDate) === today;
            const dayEvents = byDay[i] ?? [];
            return (
              <div key={i} className={`rounded-xl border p-2 min-h-[140px] ${
                isToday ? "border-indigo-500/60 bg-indigo-500/5" : "border-white/8 bg-white/3"
              }`}>
                <div className={`mb-2 text-center text-xs font-semibold ${isToday ? "text-indigo-300" : "text-white/40"}`}>
                  <div>{DAYS[i]}</div>
                  <div className={`text-sm ${isToday ? "text-indigo-200" : "text-white/70"}`}>
                    {dayDate.getDate()}
                  </div>
                </div>
                <div className="space-y-1.5">
                  {loading
                    ? <div className="h-8 animate-pulse rounded bg-white/5" />
                    : dayEvents.length === 0
                      ? <p className="text-center text-[10px] text-white/20 mt-4">—</p>
                      : dayEvents.map((ev) => (
                          <EventCard key={ev.id} event={ev} onDelete={deleteEvent} />
                        ))
                  }
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onCreated={() => fetchWeek(weekStart)} />
      )}
    </div>
  );
}
