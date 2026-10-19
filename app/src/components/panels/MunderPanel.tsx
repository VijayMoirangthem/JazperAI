"use client";

// Full-screen host for the Munder Difflin web app — the real Munder renderer
// (built with Vite into frontend/public/munder) running inside an iframe.
// The Munder app is Electron-native; in the browser it boots its built-in
// DEMO mode: the Office cast animates the floor (mock agents), while live
// agent spawning / terminals are unavailable (node-pty + local CLIs).

const MUNDER_URL = "/munder/index.html";

export default function MunderPanel() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "var(--color-bg)",
      }}
    >
      <div
        style={{
          height: 30,
          flexShrink: 0,
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          gap: 8,
          fontSize: 11,
          color: "var(--color-text-muted)",
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--color-text-secondary)" }}>
          Munder Difflin
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>storage/archive/munder</span>
        <span style={{ marginLeft: "auto", opacity: 0.7 }}>
          demo mode — live agent spawns unavailable in-browser
        </span>
      </div>
      <iframe
        src={MUNDER_URL}
        title="Munder Difflin"
        style={{ flex: 1, width: "100%", border: "none", display: "block" }}
        sandbox="allow-scripts allow-same-origin allow-presentation"
      />
    </div>
  );
}