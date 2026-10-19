"use client";

import { useState } from "react";
import BusinessChatPage from "@/business/page";
import ClientsPage from "@/business/clients/page";
import ProjectsPage from "@/business/projects/page";
import TeamPage from "@/business/team/page";
import FinancePage from "@/business/finance/page";
import "@/business/business.css";

const TABS = [
  { id: "chat", label: "Overview", C: BusinessChatPage },
  { id: "clients", label: "Clients", C: ClientsPage },
  { id: "projects", label: "Projects", C: ProjectsPage },
  { id: "team", label: "Team", C: TeamPage },
  { id: "finance", label: "Finance", C: FinancePage },
] as const;

/** Former Next.js /business/* routes, now tabs of one panel (Plan V2 B4). */
export function BusinessPanel() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("chat");
  const Active = TABS.find((t) => t.id === tab)!.C;
  return (
    <div className="flex flex-col h-full">
      <nav className="flex gap-1 border-b px-4 pt-3">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className="px-3 py-1.5 text-sm rounded-t"
            style={{ background: tab === t.id ? "rgba(255,255,255,0.08)" : "transparent" }}>{t.label}</button>
        ))}
      </nav>
      <div className="flex-1 overflow-auto"><Active /></div>
    </div>
  );
}
