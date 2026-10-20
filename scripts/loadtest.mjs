// Latency check for the endpoints behind the left rail: 30 sequential calls each (what the UI feels). Usage: node scripts/loadtest.mjs  (backend must be running)
const B = "http://127.0.0.1:8000";
const paths = ["/api/v1/bots/tree", "/api/v1/bots/", "/api/v1/connections/", "/api/v1/directory/", "/api/v1/company/structure", "/api/v1/llm/providers", "/api/v1/finops/summary", "/api/v1/system/health", "/api/v1/skills/", "/api/v1/mcp-hub/tools", "/api/v1/workspaces/", "/api/v1/devloop/runs", "/api/v1/comms/recent", "/api/v1/comms/threads", "/api/v1/hitl/pending", "/api/v1/slo/", "/api/notifications/unread-count"];
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
console.log("endpoint".padEnd(34), "p50ms p95ms (30 sequential calls)");
for (const p of paths) {
  await fetch(B + p).catch(() => 0);
  const lat = [];
  for (let i = 0; i < 30; i++) { const t = performance.now(); const r = await fetch(B + p); await r.arrayBuffer(); lat.push(performance.now() - t); }
  console.log(p.padEnd(34), q(lat, .5).toFixed(0).padStart(5), q(lat, .95).toFixed(0).padStart(5));
}
