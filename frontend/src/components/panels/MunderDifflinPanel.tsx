"use client";

// Full-screen host for the COOS copy of Munder Difflin — the real Munder
// renderer built into the COOS backend and served at /munder/index.html.
//
// In its default "coos" mode the app is wired to this same COOS stack:
//   • the floor is seeded with every agent from GET /api/agents/live
//     (40 agents, 16 departments — same roster as #command_center)
//   • live status/action sync over the backend WebSocket
//   • the composer / command center / kanban / threads talk to /api/hive/*
//
// Entry: http://localhost:3001/#cooshq
// Demo office (no backend): #munder

// Bump when rebuilding backend/munder-web so the iframe skips stale cached JS.
const MUNDER_BUILD = "yYzr7Zxx";
const MUNDER_LIVE_URL = `http://localhost:8000/munder/index.html?v=${MUNDER_BUILD}`;

export default function MunderDifflinPanel() {
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
          COOS HQ — Live
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>
          backend/munder-web · /api/agents/live · /ws · /api/hive/*
        </span>
        <span style={{ marginLeft: "auto", opacity: 0.7 }}>
          all departments &amp; agents live from #command_center
        </span>
      </div>
      <iframe
        src={MUNDER_LIVE_URL}
        title="CREATE ORIGINS OS — COOS HQ"
        style={{ flex: 1, width: "100%", border: "none", display: "block" }}
        sandbox="allow-scripts allow-same-origin allow-presentation"
      />
    </div>
  );
}