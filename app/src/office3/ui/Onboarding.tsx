"use client";
import { useEffect, useState } from "react";
const steps = ["Click the floor to move around the office.", "Use Q and E to rotate the camera, and T to cycle views.", "Right-click a person to see contextual actions.", "Use Alt+1 through Alt+9 for quick emotes.", "Open the roster or Ctrl+K to find anyone quickly."];
export function Onboarding() {
  const [step, setStep] = useState<number | null>(null);
  useEffect(() => { if (!localStorage.getItem("office3.onboarding.complete")) setStep(0); }, []);
  if (step === null) return null;
  const finish = () => { localStorage.setItem("office3.onboarding.complete", "1"); setStep(null); };
  return <section className="absolute bottom-20 left-1/2 z-40 w-96 -translate-x-1/2 rounded-xl bg-slate-950/95 p-4 text-sm text-white shadow-2xl"><div className="mb-2 text-xs text-blue-200">Office tour · {step + 1}/{steps.length}</div><p>{steps[step]}</p><div className="mt-3 flex justify-end gap-2"><button className="text-xs opacity-70" onClick={finish}>Skip</button><button className="rounded bg-blue-600 px-3 py-1 text-xs" onClick={() => step + 1 >= steps.length ? finish() : setStep(step + 1)}>{step + 1 >= steps.length ? "Done" : "Next"}</button></div></section>;
}
