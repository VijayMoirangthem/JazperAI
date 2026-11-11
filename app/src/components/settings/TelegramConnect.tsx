"use client";

import { useState } from "react";
import { Bot, CheckCircle2, UserCheck } from "lucide-react";
import { useApi } from "@/lib/swr";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Pending { chat_id: string; name: string; username: string; at: number }
interface Status {
  configured: boolean; enabled: boolean; approved_chat_id: string;
  bot: { running: boolean; username: string; last_error: string; last_update_at: number | null; pending: Pending[] };
}

/** Talk to Jazper from Telegram: paste the bot token, message the bot, approve yourself. Runs on this PC (no public URL). */
export function TelegramConnect() {
  const { data, refresh } = useApi<Status>(`${API}/api/telegram/status`, { ttl: 1000, poll: 4000 });
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState("");
  const bot = data?.bot;
  const approved = !!data?.approved_chat_id;

  async function connect() {
    setMsg("");
    const r = await fetch(`${API}/api/telegram/configure`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bot_token: token.trim(), chat_id: data?.approved_chat_id ?? "", enabled: true }) });
    setMsg(r.ok ? "Connected. Now open your bot in Telegram and send /start." : "Could not save the token.");
    if (r.ok) setToken("");
    setTimeout(refresh, 1500);
  }
  async function approve(chat_id: string) {
    const r = await fetch(`${API}/api/telegram/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id }) });
    setMsg(r.ok ? "Approved. Jazper will now answer that chat." : "Approval failed (ask them to message the bot again).");
    refresh();
  }

  const box: React.CSSProperties = { border: "var(--border-lo)", borderRadius: "var(--r-sm)", background: "var(--color-surface-raised)", padding: "var(--sp-3)", display: "grid", gap: 8, fontSize: 12 };
  return (
    <div style={box} data-testid="telegram-connect">
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}><Bot size={14} /> Talk to Jazper from Telegram</div>
      <div style={{ opacity: 0.7 }}>
        1. In Telegram, message <b>@BotFather</b>, send <code>/newbot</code>, and copy the token. 2. Paste it here. 3. Open your new bot and send <code>/start</code>.
        4. Click <b>Approve</b> below. Jazper answers in English, Hindi or Hinglish. It runs on this PC; nothing is exposed to the internet.
      </div>
      {bot?.running && bot.username && (
        <div style={{ color: "#22c55e", display: "flex", alignItems: "center", gap: 6 }}>
          <CheckCircle2 size={13} /> Bot online: <a href={`https://t.me/${bot.username}`} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>@{bot.username}</a>
          {approved ? " · approved chat linked" : " · waiting for you to message it"}
        </div>
      )}
      {bot?.last_error && <div style={{ color: "#f59e0b" }}>⚠ {bot.last_error}</div>}
      {(bot?.pending ?? []).map((p) => (
        <div key={p.chat_id} style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid rgba(99,102,241,0.5)", borderRadius: 6, padding: "6px 8px" }}>
          <UserCheck size={14} />
          <span style={{ flex: 1 }}>{p.name}{p.username ? ` (@${p.username})` : ""} wants to chat · id {p.chat_id}</span>
          <button onClick={() => approve(p.chat_id)} style={{ background: "var(--color-accent)", border: "none", borderRadius: 6, color: "#fff", padding: "4px 12px", cursor: "pointer" }}>Approve</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bot token from @BotFather"
          style={{ flex: 1, background: "var(--color-surface)", border: "var(--border-hi)", borderRadius: 6, padding: "6px 8px", color: "inherit" }} />
        <button disabled={!token.trim()} onClick={connect} style={{ background: "var(--color-accent)", border: "none", borderRadius: 6, color: "#fff", padding: "6px 14px", cursor: "pointer", opacity: token.trim() ? 1 : 0.5 }}>Connect</button>
      </div>
      {msg && <div style={{ opacity: 0.85 }}>{msg}</div>}
      <div style={{ opacity: 0.55, fontSize: 11 }}>Only the approved chat is answered. Anyone else is told it is a private bot. Anyone with your bot token could message it, so keep the token private.</div>
    </div>
  );
}
