"use client";

import { useEffect, useMemo, useState } from "react";
import { portraitUrl } from "@/office2/avatarSheet";
import { slugify, validateEmployee, type EmployeeForm } from "@/office2/forms";
import { CREW_COLOR, LOOK_COUNTS, lookFor } from "@/office2/look";
import { readLooks, writeLook } from "@/office2/lookStore";
import type { OfficeScene } from "@/office2/OfficeScene";
import type { Look, Person } from "@/office2/types";

type Slot = keyof typeof LOOK_COUNTS;
const SLOTS: { slot: Slot; label: string; optional?: boolean }[] = [
  { slot: "body", label: "Skin" }, { slot: "eyes", label: "Eyes" }, { slot: "hair", label: "Hair" },
  { slot: "clothes", label: "Clothes" }, { slot: "hat", label: "Hat", optional: true }, { slot: "accessory", label: "Accessory", optional: true },
];

interface Props { api: string; scene: OfficeScene; mode: "add" | "edit"; person?: Person; existingSlugs: string[]; onClose(): void; onDone(): void }

export function EditDialog({ api, scene, mode, person, existingSlugs, onClose, onDone }: Props) {
  const [form, setForm] = useState<EmployeeForm>({
    slug: person?.slug ?? "", name: person?.name ?? "", role: person?.role ?? "", crew: person?.crew ?? "baeit", prompt: "",
  });
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [extra, setExtra] = useState<{ reports_to: string; tools: unknown[]; tier: string }>({ reports_to: "jasper", tools: [], tier: "standard" });
  const [look, setLook] = useState<Look>(() => lookFor(person?.slug ?? "new", person?.crew ?? "baeit", "bot", readLooks()[person?.slug ?? ""]));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== "edit" || !person) return;
    fetch(`${api}/api/v1/bots/${person.slug}/card`).then((r) => r.json()).then((c) => {
      setForm((f) => ({ ...f, prompt: c.prompt ?? "", name: c.display_name ?? f.name, role: c.role_title ?? f.role, crew: c.crew ?? f.crew }));
      setExtra({ reports_to: c.reports_to ?? "jasper", tools: c.tools ?? [], tier: c.tier ?? "standard" });
    }).catch(() => setError("Could not load the current settings."));
  }, [api, mode, person]);

  const set = (patch: Partial<EmployeeForm>) => setForm((f) => {
    const n = { ...f, ...patch };
    if (mode === "add" && !slugTouched && patch.name !== undefined) n.slug = slugify(patch.name);
    return n;
  });
  const bump = (slot: Slot, dir: 1 | -1, optional?: boolean) => setLook((l) => {
    const min = optional ? -1 : 0, span = LOOK_COUNTS[slot] - min;
    const v = ((l[slot] - min + dir + span) % span) + min;
    return { ...l, [slot]: v };
  });
  const preview = useMemo(() => portraitUrl(scene, { ...look, shirtColor: CREW_COLOR[form.crew] ?? look.shirtColor }, 5), [scene, look, form.crew]);

  const submit = async () => {
    const f = { ...form, prompt: form.prompt.trim() || `You are ${form.name}, ${form.role} in the ${form.crew} crew of Sir Jasper AI. Be concise and concrete.` };
    const problem = validateEmployee(f, existingSlugs, mode);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    try {
      const r = await fetch(`${api}/api/v1/bots/`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: f.slug, display_name: f.name, role_title: f.role, crew: f.crew, prompt: f.prompt, reports_to: extra.reports_to, tools: extra.tools, model_policy: { default_tier: extra.tier } }),
      });
      if (!r.ok) { setError(`The server said: ${(await r.text()).slice(0, 200)}`); return; }
      writeLook(f.slug, look);
      onDone();
    } catch { setError("Could not reach the server."); } finally { setBusy(false); }
  };

  const input = "w-full rounded border border-white/20 bg-transparent px-2 py-1 text-sm";
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60" data-testid="office2-edit">
      <div className="max-h-[90%] w-[26rem] space-y-2 overflow-auto rounded-2xl bg-neutral-900 p-4 ring-1 ring-white/20">
        <div className="font-semibold">{mode === "add" ? "Add employee" : `Edit ${person?.name}`}</div>
        <div className="flex gap-3">
          <img src={preview} alt="" className="h-40 w-40 shrink-0 rounded bg-white/5" style={{ imageRendering: "pixelated" }} />
          <div className="grid flex-1 grid-cols-1 gap-1 text-xs">
            {SLOTS.map(({ slot, label, optional }) => (
              <div key={slot} className="flex items-center justify-between gap-1">
                <span className="opacity-60">{label}</span>
                <span><button className="rounded border px-1.5" onClick={() => bump(slot, -1, optional)}>‹</button> <span className="inline-block w-6 text-center">{look[slot] < 0 ? "–" : look[slot] + 1}</span> <button className="rounded border px-1.5" onClick={() => bump(slot, 1, optional)}>›</button></span>
              </div>
            ))}
          </div>
        </div>
        <input className={input} placeholder="Name" value={form.name} onChange={(e) => set({ name: e.target.value })} />
        <input className={input} placeholder="Slug" value={form.slug} readOnly={mode === "edit"} onChange={(e) => { setSlugTouched(true); set({ slug: e.target.value }); }} />
        <input className={input} placeholder="Role" value={form.role} onChange={(e) => set({ role: e.target.value })} />
        <select className={input} value={form.crew} onChange={(e) => set({ crew: e.target.value })}>
          {Object.keys(CREW_COLOR).filter((c) => c !== "human").map((c) => <option key={c} value={c} className="bg-neutral-900">{c}</option>)}
        </select>
        <textarea className={`${input} h-20`} placeholder="Prompt (optional: a sensible default is used)" value={form.prompt} onChange={(e) => set({ prompt: e.target.value })} />
        {error && <div role="alert" className="text-xs text-red-300">{error}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded border px-3 py-1 text-sm">Cancel</button>
          <button onClick={submit} disabled={busy} className="rounded bg-green-700 px-3 py-1 text-sm">{mode === "add" ? "Add" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
