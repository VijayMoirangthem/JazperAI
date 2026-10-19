"use client";

export const pluginMeta = {
  id: "example",
  label: "Example Plugin",
  group: "main" as const,
  icon: "Puzzle",
  description: "Example plugin — edit or replace to add custom panels",
};

export default function ExamplePlugin() {
  return (
    <div style={{ padding: 40, color: "var(--color-text)" }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>Example Plugin</h2>
      <p style={{ opacity: 0.5, fontSize: 14, lineHeight: 1.6 }}>
        This panel was loaded dynamically. Edit{" "}
        <code style={{ background: "rgba(255,255,255,0.07)", padding: "1px 6px", borderRadius: 4 }}>
          frontend/src/plugins/ExamplePlugin.tsx
        </code>{" "}
        to customise it, or drop a new{" "}
        <code style={{ background: "rgba(255,255,255,0.07)", padding: "1px 6px", borderRadius: 4 }}>
          .tsx
        </code>{" "}
        file in the same directory — the backend file watcher will automatically
        register it in the sidebar without a restart.
      </p>
    </div>
  );
}
