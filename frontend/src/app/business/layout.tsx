"use client";

import "./business.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Users, FolderKanban, UserCog, Receipt } from "lucide-react";

const NAV_ITEMS = [
  { href: "/business",          label: "Jazper",   icon: MessageSquare },
  { href: "/business/clients",  label: "Clients",  icon: Users },
  { href: "/business/projects", label: "Projects", icon: FolderKanban },
  { href: "/business/team",     label: "Team",     icon: UserCog },
  { href: "/business/finance",  label: "Finance",  icon: Receipt },
];

export default function BusinessLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="biz-root">
      <nav className="biz-topnav">
        <div className="biz-wordmark">
          <span className="biz-wordmark-badge">C</span>
          COOS
          <span className="biz-wordmark-sub">Business</span>
        </div>

        <div className="biz-navlinks">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = href === "/business" ? pathname === href : (pathname ?? "").startsWith(href);
            return (
              <Link key={href} href={href} className={`biz-navlink${active ? " active" : ""}`}>
                <Icon size={14} />
                {label}
              </Link>
            );
          })}
        </div>

        <div className="biz-nav-spacer" />
        <span className="biz-nav-tag">Beta</span>
      </nav>

      {children}
    </div>
  );
}
