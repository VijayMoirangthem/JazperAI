"use client";

import { useState } from "react";
import { officePersonAuthHeaders } from "../core/auth";
import { inspectCustomModel, validateCustomModel } from "../core/customModel";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function CustomModelImport({ onImported }: { onImported(url: string): void | Promise<void> }) {
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const choose = async (file: File | undefined) => {
    if (!file) return;
    try {
      setError(null); setName(null); setUploading(true);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const validation = validateCustomModel(file.name, bytes);
      if (validation) { setError(validation); return; }
      const inspection = await inspectCustomModel(bytes);
      if (inspection) { setError(inspection); return; }
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${API}/api/v1/office/models/founder`, { method: "POST", headers: officePersonAuthHeaders(), body: form });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw Error(typeof detail?.detail === "string" ? detail.detail : "Upload failed. Your model was not saved.");
      }
      const model = await response.json();
      if (!model || typeof model.url !== "string") throw Error("Upload finished without a valid model URL.");
      await onImported(model.url);
      localStorage.setItem("office3.customModel", model.url);
      setName(file.name);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Upload failed. Your model was not saved."); } finally { setUploading(false); }
  };
  return <label className="absolute bottom-3 left-80 rounded bg-black/70 px-2 py-1 text-xs text-white">{uploading ? "Checking model…" : "Import GLB"}<input className="hidden" type="file" accept=".glb" disabled={uploading} onClick={event => { event.currentTarget.value = ""; }} onChange={event => void choose(event.target.files?.[0])} />{name && <span className="ml-1 opacity-70">{name}</span>}{error && <span className="ml-1 text-rose-300">{error}</span>}</label>;
}
