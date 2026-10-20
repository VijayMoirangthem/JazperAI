# Connectors: status and exact credentials (Plan V3 W9)

All connectors run as MCP servers under the hub (schema validation, tiering, rate limits, audit). Reads are Tier 1, writes Tier 2, destructive Tier 3. After reading external content, writes become Tier 3 (`docs/ops/prompt_injection.md`). Secrets go to the OS vault only: use the credential card in Chat or Connections, or put the value in `backend/python/.env` and say "connect <name>" (Connector copies it into the vault).

| Connector | Status | What you need |
|---|---|---|
| Google Workspace (Gmail, Calendar, Drive read-only) | **Verified live** (inbox search and a real incorporation-mail answer) | Sign in with Google once. Scopes used: Gmail read-only, Calendar read-only |
| Playwright browser | **Verified live** 2026-10-21: 25 tools, `browser_tabs` read | Nothing. Navigation/click/type are Tier 2 |
| Project files (filesystem MCP) | Ready, not exercised (workspaces already give the bots file tools) | Nothing |
| Knowledge-graph memory MCP | Ready, not exercised (Jasper already has pgvector memory) | Nothing |
| GitHub | Declared; **needs your token** | Fine-grained personal access token, repositories: the ones you want. Permissions: Metadata (read), Contents (read; write only if you want agents to push), Issues (read/write), Pull requests (read/write). Set `GITHUB_TOKEN`. Merging stays Tier 3 |
| Brave Search | Declared; **needs a key** | Brave Search API key (free tier exists): `BRAVE_API_KEY` |
| Slack | Declared, untested; **needs tokens** | Create a Slack app, bot token scopes `channels:read channels:history chat:write users:read`, install to the workspace, set `SLACK_BOT_TOKEN` (starts with `xoxb-`) and `SLACK_TEAM_ID` (starts with `T`). Invite the bot to the channels it should see |
| Notion | Declared, untested; **needs a token** | Internal integration token `NOTION_TOKEN`; then share each page/database with the integration (Notion only exposes what is shared) |
| Linear, Jira, Discord, Cashfree, Google Sheets | Not available (no verified MCP server wired yet) | They appear as "planned" in the suggestion cards |

## How to verify one yourself
Connections panel → Connect → Test. A connector shows **Connected** only after a harmless read call passes. Chat: "connect GitHub" shows a secure card for the token; after saving, Connector runs the test and reports.

## OAuth note
Google uses the loopback OAuth flow (system browser, token stored by the backend, refresh handled by the Google library). Slack, Notion and Linear can use OAuth apps, but each needs an app registered under your own account (client id/secret, redirect URI `http://127.0.0.1:8000/...`), so v1 uses tokens for them. Adding OAuth for them is straightforward once you register the apps.

## Things to know
- A connector that fails to start is reported DEGRADED and its process is reaped (no orphans). Gmail is reconnected automatically at backend start.
- The Slack connector can also deliver alerts and approvals to a channel; that wiring is not done (alerts currently go to the app, the comms log and the phone).
