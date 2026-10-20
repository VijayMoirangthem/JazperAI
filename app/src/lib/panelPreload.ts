// Warm a panel's code (and its first data) when the pointer is over its rail icon, so the click that follows is instant.
// The import() calls here resolve to the same chunks as the lazy() imports in app/page.tsx, so the browser fetches each chunk once.
import { preload } from "./swr";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const CODE: Record<string, () => Promise<unknown>> = {
  mind_map: () => import("@/components/panels/MindMapPanel"),
  live_agents: () => import("@/components/panels/LiveAgentsPanel"),
  office: () => import("@/components/panels/OfficePanel"),
  org_chart: () => import("@/components/panels/CompanyPanel"),
  dev_loop: () => import("@/components/panels/DevLoopPanel"),
  diff_editor: () => import("@/components/panels/DiffEditorPanel"),
  connections: () => import("@/components/panels/ConnectionsPanel"),
  skills: () => import("@/components/panels/SkillsPanel"),
  mcp_hub: () => import("@/components/panels/McpHubPanel"),
  ai_providers: () => import("@/components/panels/AiProvidersPanel"),
  finops: () => import("@/components/panels/FinOpsPanel"),
  business: () => import("@/components/panels/BusinessPanel"),
  system: () => import("@/components/panels/SystemPanel"),
};
const DATA: Record<string, string[]> = {
  mind_map: ["/api/v1/bots/tree", "/api/v1/connections/"],
  office: ["/api/v1/directory/", "/api/v1/bots/"],
  org_chart: ["/api/v1/company/structure"],
  connections: ["/api/v1/connections/", "/api/v1/workspaces/"],
  skills: ["/api/v1/skills/"],
  mcp_hub: ["/api/v1/mcp-hub/connectors", "/api/v1/mcp-hub/tools"],
  ai_providers: ["/api/v1/llm/providers", "/api/v1/llm/routing"],
  finops: ["/api/v1/finops/summary"],
  system: ["/api/v1/system/health"],
};
const done = new Set<string>();

export function preloadPanel(id: string): void {
  if (done.has(id)) return;
  done.add(id);
  void CODE[id]?.().catch(() => done.delete(id));
  (DATA[id] ?? []).forEach((p) => { void preload(API + p).catch(() => undefined); });
}
