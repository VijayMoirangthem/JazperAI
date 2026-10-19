"use client";

/**
 * Lightweight toast + modal-dialog singletons for the IDE — replaces native
 * alert()/confirm()/prompt() (which are jarring and block the whole tab) with
 * IDE-styled equivalents. Plain subscribe/emit, same pattern as ide_bus on the
 * backend — no React Context needed, callable from any helper function.
 */

// ── Toasts ────────────────────────────────────────────────────────────────────

export interface Toast { id: string; kind: "success" | "error" | "info"; message: string }

let toasts: Toast[] = [];
let toastListeners: ((t: Toast[]) => void)[] = [];

function notifyToasts() { toastListeners.forEach(l => l(toasts)); }

function pushToast(kind: Toast["kind"], message: string) {
  const id = Math.random().toString(36).slice(2);
  toasts = [...toasts, { id, kind, message }];
  notifyToasts();
  setTimeout(() => { toasts = toasts.filter(t => t.id !== id); notifyToasts(); }, 4000);
}

export const toast = {
  success: (message: string) => pushToast("success", message),
  error:   (message: string) => pushToast("error", message),
  info:    (message: string) => pushToast("info", message),
  subscribe: (fn: (t: Toast[]) => void) => {
    toastListeners.push(fn);
    return () => { toastListeners = toastListeners.filter(l => l !== fn); };
  },
};

// ── Confirm / Prompt dialogs ─────────────────────────────────────────────────

export type DialogRequest =
  | { type: "confirm"; message: string; danger?: boolean; resolve: (ok: boolean) => void }
  | { type: "prompt"; message: string; defaultValue: string; resolve: (value: string | null) => void };

let currentDialog: DialogRequest | null = null;
let dialogListeners: ((d: DialogRequest | null) => void)[] = [];

function setDialog(d: DialogRequest | null) {
  currentDialog = d;
  dialogListeners.forEach(l => l(d));
}

export function confirmDialog(message: string, opts?: { danger?: boolean }): Promise<boolean> {
  return new Promise(resolve => {
    setDialog({ type: "confirm", message, danger: opts?.danger, resolve: (ok) => { resolve(ok); setDialog(null); } });
  });
}

export function promptDialog(message: string, defaultValue = ""): Promise<string | null> {
  return new Promise(resolve => {
    setDialog({ type: "prompt", message, defaultValue, resolve: (v) => { resolve(v); setDialog(null); } });
  });
}

export function subscribeDialog(fn: (d: DialogRequest | null) => void) {
  dialogListeners.push(fn);
  fn(currentDialog);
  return () => { dialogListeners = dialogListeners.filter(l => l !== fn); };
}
