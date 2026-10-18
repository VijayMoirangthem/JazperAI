# COOS AI-Native IDE — UI / UX Specification

**Last Updated:** 2026-08-11  
**Target View:** `Agent OS` → `IDE` (`IDEPanel.tsx`)

---

## 1. Professional Multi-Pane IDE Layout

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Header: Project Workspace Selector · Git Branch · Dev Server Status · Run   │
├─────────────┬──────────────────────────────────────────┬────────────────────┤
│             │                                          │                    │
│ File Tree   │ Monaco Code Editor                       │ AI Agent Panel     │
│             │ - Multi-tab bar & dirty state indicators │ - Mode selector    │
│             │ - Diff view for proposed agent edits     │ - Context preview  │
│             │ - Line numbers, diagnostics, minimap     │ - Plan checklist   │
│             │                                          │ - Streaming output │
│             │                                          │ - Approval buttons │
├─────────────┼──────────────────────────────────────────┼────────────────────┤
│ Git Widget  │ Live Application Preview / Browser       │ Activity Feed      │
│ (Commit)    │ OR Integrated xterm.js Terminal          │ (SSE Agent Log)    │
├─────────────┴──────────────────────────────────────────┴────────────────────┤
│ Status Bar: CPU/RAM · Active Model · Local Costs · Active Agents            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Interactive AI Modes (Selector in AI Command Panel)

1. 💬 **Ask:** Explain code, answer architecture questions (No file modifications).
2. 📋 **Plan:** Analyze request, output numbered implementation plan & file diff preview.
3. ✏️ **Edit:** Modify files directly with live diff previews & approval gates.
4. ⚙️ **Execute:** Run build commands, npm scripts, and tests.
5. 🔍 **Debug:** Analyze error tracebacks and test failures, then propose targeted fixes.
6. 👁️ **Review:** Review git diffs, security, and performance without touching code.

---

## 3. Keyboard Shortcuts & User Controls

- `Ctrl+S` / `Cmd+S`: Save active editor file.
- `Ctrl+P` / `Cmd+P`: Quick file switcher.
- `Ctrl+\`: Toggle AI Command Panel.
- `Ctrl+\``: Toggle Bottom Terminal / Preview panel.
- `Ctrl+Shift+S`: Toggle Studio Mode / Multi-pane layout.
