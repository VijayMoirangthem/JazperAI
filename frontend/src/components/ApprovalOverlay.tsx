"use client";

import { useState } from "react";
import { Check, X, ChevronDown, ChevronUp, Zap } from "lucide-react";
import type { ApprovalRequest } from "@/hooks/useApprovals";

const AGENT_EMOJI: Record<string, string> = {
  Scout:   "🔍",
  Hermes:  "📬",
  Sage:    "🧠",
  Lens:    "👁️",
  Atlas:   "🗺️",
  Phantom: "👻",
  Jazper:  "⚡",
};

const ACTION_LABELS: Record<string, string> = {
  send_email:              "Send Email",
  submit_job_application:  "Submit Job Application",
  delete_file:             "Delete File",
  write_file:              "Write File",
  schedule_cron:           "Schedule Cron Job",
  post_message:            "Post Message",
  web_search:              "Web Search",
  read_file:               "Read File",
};

interface Props {
  pending:          ApprovalRequest[];
  onApprove:        (id: string) => void;
  onDeny:           (id: string) => void;
  autoApproveTypes: string[];
  onAddAutoApprove: (action_type: string) => void;
}

function ApprovalCard({
  req,
  onApprove,
  onDeny,
  autoApproveTypes,
  onAddAutoApprove,
}: {
  req:              ApprovalRequest;
  onApprove:        () => void;
  onDeny:           () => void;
  autoApproveTypes: string[];
  onAddAutoApprove: (t: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const emoji        = AGENT_EMOJI[req.agent] ?? "🤖";
  const actionLabel  = ACTION_LABELS[req.action_type] ?? req.action_type;
  const alreadyAuto  = autoApproveTypes.includes(req.action_type);
  const hasPayload   = Object.keys(req.payload ?? {}).length > 0;
  const diffText     = (req.payload as { diff?: string })?.diff;

  return (
    <div style={{
      background:   "var(--color-surface)",
      border:       "1px solid var(--color-border)",
      borderLeft:   "3px solid var(--color-accent)",
      borderRadius: 8,
      padding:      "12px 14px",
      marginBottom: 8,
      minWidth:     320,
      maxWidth:     380,
      boxShadow:    "0 4px 24px rgba(0,0,0,0.4)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>{emoji}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-accent)" }}>
            {req.agent} wants to:
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 1 }}>
            {actionLabel}
          </div>
        </div>
      </div>

      {/* Description */}
      <p style={{ margin: "0 0 10px", fontSize: 12, opacity: 0.75, lineHeight: 1.5 }}>
        {req.description}
      </p>

      {/* Real diff for write_file — this is the whole point of the approval step */}
      {diffText !== undefined && (
        <pre style={{
          background:   "#0d0d0d",
          border:       "1px solid var(--color-border)",
          borderRadius: 4,
          padding:      "8px 10px",
          fontSize:     10,
          fontFamily:   "monospace",
          overflowX:    "auto",
          overflowY:    "auto",
          maxHeight:    240,
          marginBottom: 10,
        }}>
          {diffText.length === 0 ? (
            <span style={{ color: "#64748b" }}>(empty diff — file unchanged)</span>
          ) : (
            diffText.split("\n").map((line, i) => (
              <div key={i} style={{
                color: line.startsWith("+") && !line.startsWith("+++") ? "#22c55e"
                     : line.startsWith("-") && !line.startsWith("---") ? "#f87171"
                     : line.startsWith("@@") ? "#818cf8"
                     : "#64748b",
                whiteSpace: "pre-wrap", wordBreak: "break-all",
              }}>
                {line || " "}
              </div>
            ))
          )}
        </pre>
      )}

      {/* Payload expander */}
      {hasPayload && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--color-text)", opacity: 0.5, fontSize: 11,
            display: "flex", alignItems: "center", gap: 4, marginBottom: 8, padding: 0,
          }}
        >
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          {expanded ? "Hide details" : "Show details"}
        </button>
      )}
      {expanded && hasPayload && (
        <pre style={{
          background:   "var(--color-bg)",
          border:       "1px solid var(--color-border)",
          borderRadius: 4,
          padding:      "8px 10px",
          fontSize:     10,
          overflowX:    "auto",
          marginBottom: 10,
          color:        "var(--color-text)",
          opacity:      0.8,
        }}>
          {JSON.stringify(req.payload, null, 2)}
        </pre>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          onClick={onApprove}
          style={{
            flex:          1,
            display:       "flex",
            alignItems:    "center",
            justifyContent:"center",
            gap:           5,
            background:    "#16a34a",
            color:         "#fff",
            border:        "none",
            borderRadius:  6,
            padding:       "7px 0",
            fontSize:      12,
            fontWeight:    700,
            cursor:        "pointer",
          }}
        >
          <Check size={13} /> Approve
        </button>
        <button
          onClick={onDeny}
          style={{
            flex:          1,
            display:       "flex",
            alignItems:    "center",
            justifyContent:"center",
            gap:           5,
            background:    "#dc2626",
            color:         "#fff",
            border:        "none",
            borderRadius:  6,
            padding:       "7px 0",
            fontSize:      12,
            fontWeight:    700,
            cursor:        "pointer",
          }}
        >
          <X size={13} /> Deny
        </button>
      </div>

      {/* Auto-approve toggle */}
      <button
        onClick={() => !alreadyAuto && onAddAutoApprove(req.action_type)}
        disabled={alreadyAuto}
        style={{
          marginTop:   8,
          width:       "100%",
          background:  alreadyAuto ? "rgba(234,179,8,0.1)" : "none",
          border:      `1px solid ${alreadyAuto ? "#ca8a04" : "var(--color-border)"}`,
          borderRadius:5,
          padding:     "5px 8px",
          fontSize:    10,
          color:       alreadyAuto ? "#ca8a04" : "var(--color-text)",
          opacity:     alreadyAuto ? 1 : 0.6,
          cursor:      alreadyAuto ? "default" : "pointer",
          display:     "flex",
          alignItems:  "center",
          gap:         5,
        }}
      >
        <Zap size={10} />
        {alreadyAuto
          ? `Auto-approving "${actionLabel}" from now on`
          : `Always allow "${actionLabel}" without asking`}
      </button>
    </div>
  );
}

export function ApprovalOverlay({
  pending,
  onApprove,
  onDeny,
  autoApproveTypes,
  onAddAutoApprove,
}: Props) {
  if (pending.length === 0) return null;

  return (
    <div style={{
      position:      "fixed",
      bottom:        24,
      right:         24,
      zIndex:        9999,
      display:       "flex",
      flexDirection: "column",
      alignItems:    "flex-end",
      pointerEvents: "none",
    }}>
      {/* Badge when more than 1 pending */}
      {pending.length > 1 && (
        <div style={{
          marginBottom: 6,
          background:   "var(--color-accent)",
          color:        "#000",
          fontSize:     10,
          fontWeight:   700,
          padding:      "3px 10px",
          borderRadius: 99,
        }}>
          {pending.length} approvals waiting
        </div>
      )}

      {/* Show latest first — max 3 cards visible */}
      {[...pending].reverse().slice(0, 3).map((req) => (
        <div key={req.id} style={{ pointerEvents: "all" }}>
          <ApprovalCard
            req={req}
            onApprove={() => onApprove(req.id)}
            onDeny={() => onDeny(req.id)}
            autoApproveTypes={autoApproveTypes}
            onAddAutoApprove={onAddAutoApprove}
          />
        </div>
      ))}
    </div>
  );
}
