"use client";

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";

export type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastCtx {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastCtx>({ showToast: () => {} });

const TYPE_STYLE: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: { bg: "#14532d22", border: "#22c55e44", icon: "✓" },
  error:   { bg: "#7f1d1d22", border: "#ef444444", icon: "✕" },
  warning: { bg: "#78350f22", border: "#f59e0b44", icon: "⚠" },
  info:    { bg: "#1e3a5f22", border: "#3b82f644", icon: "ℹ" },
};

const TYPE_COLOR: Record<ToastType, string> = {
  success: "#22c55e",
  error:   "#ef4444",
  warning: "#f59e0b",
  info:    "#3b82f6",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = ++counter.current;
    setToasts(prev => [...prev.slice(-4), { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast container — fixed top-right */}
      <div
        style={{
          position: "fixed", top: 16, right: 16,
          zIndex: 9999, display: "flex", flexDirection: "column",
          gap: 8, pointerEvents: "none",
        }}
        aria-live="polite"
      >
        {toasts.map(t => {
          const s = TYPE_STYLE[t.type];
          const c = TYPE_COLOR[t.type];
          return (
            <div
              key={t.id}
              style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                padding: "10px 14px", borderRadius: "var(--r-sm)",
                background: s.bg, border: `1px solid ${s.border}`,
                backdropFilter: "blur(12px)", minWidth: 220, maxWidth: 340,
                boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
                animation: "sj-toast-in 0.18s ease",
                pointerEvents: "auto",
              }}
            >
              <span style={{ fontSize: 12, color: c, fontWeight: 700, flexShrink: 0, lineHeight: 1.5 }}>
                {s.icon}
              </span>
              <span style={{ fontSize: 12, color: "var(--color-text)", lineHeight: 1.5 }}>
                {t.message}
              </span>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes sj-toast-in {
          from { opacity: 0; transform: translateX(16px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastCtx["showToast"] {
  return useContext(ToastContext).showToast;
}
