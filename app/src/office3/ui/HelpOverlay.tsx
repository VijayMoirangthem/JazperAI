"use client";

import { useEffect, useState } from "react";
import { loadOfficeViewSettings } from "../core/settings";
import { useOfficeText } from "./useOfficeText";

export function HelpOverlay() {
  const [open, setOpen] = useState(false);
  const [interactionKey, setInteractionKey] = useState("e"), [helpKey, setHelpKey] = useState("?"), [photoKey, setPhotoKey] = useState("p"), [paletteKey, setPaletteKey] = useState("k"), [cameraCycleKey, setCameraCycleKey] = useState("t");
  const t = useOfficeText();
  const controls = [[t("move"), t("moveDescription")], [t("camera"), t("cameraDescription", { key: cameraCycleKey.toUpperCase() })], [t("interact"), t("interactDescription", { key: interactionKey.toUpperCase() })], [t("peopleControl"), t("peopleDescription")], [t("quickFind"), t("quickFindDescription", { key: paletteKey.toUpperCase() })], [t("emotes"), t("emotesDescription")], [t("photoControl"), t("photoDescription", { key: photoKey.toUpperCase() })], [t("builder"), t("builderDescription")]];
  useEffect(() => {
    const syncInteractionKey = () => { const settings = loadOfficeViewSettings(); setInteractionKey(settings.interactionKey); setHelpKey(settings.helpKey); setPhotoKey(settings.photoKey); setPaletteKey(settings.paletteKey); setCameraCycleKey(settings.cameraCycleKey); };
    const onKeyDown = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
      if (event.key === "Escape") setOpen(false);
      if (event.key.toLowerCase() === helpKey && !typing) { event.preventDefault(); setOpen(true); }
    };
    window.addEventListener("keydown", onKeyDown);
    const show = () => setOpen(true);
    window.addEventListener("office3:open-help", show);
    window.addEventListener("office3:view-settings", syncInteractionKey);
    syncInteractionKey();
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("office3:open-help", show); window.removeEventListener("office3:view-settings", syncInteractionKey); };
  }, []);
  return <>
    <button className="absolute bottom-3 right-36 z-20 rounded bg-black/70 px-2 py-1 text-xs text-white ring-1 ring-white/15 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300" title={t("helpHint", { key: helpKey.toUpperCase() })} onClick={() => setOpen(true)}>{t("help")}</button>
    {open && <div className="absolute inset-0 z-40 grid place-items-center bg-black/55 p-4" onMouseDown={() => setOpen(false)}>
      <section role="dialog" aria-modal="true" aria-label={t("helpTitle")} className="w-full max-w-lg rounded-xl bg-slate-950/95 p-5 text-sm text-white shadow-2xl ring-1 ring-white/15" onMouseDown={event => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-base font-semibold">{t("helpTitle")}</h2><p className="mt-1 text-xs text-slate-300">{t("helpDismiss")}</p></div><button className="rounded px-2 py-1 text-xs hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300" onClick={() => setOpen(false)}>{t("helpClose")}</button></div>
        <dl className="mt-4 grid gap-2 sm:grid-cols-2">{controls.map(([name, description]) => <div key={name} className="rounded-lg bg-slate-900 p-3"><dt className="font-medium text-blue-200">{name}</dt><dd className="mt-1 text-xs leading-5 text-slate-300">{description}</dd></div>)}</dl>
      </section>
    </div>}
  </>;
}
