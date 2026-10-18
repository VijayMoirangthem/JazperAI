# Agent Organization

AI agents are first-class members of the org chart.

## Identity

| Field | Description |
|-------|-------------|
| `codename` | Floor id (e.g. `darwin`) |
| `name` | Display name |
| `title` | Position / role label |
| `department` | Department id |
| `team_id` | Team room |
| `floor_id` | Division / floor |
| `system_prompt` | Behavioral instructions |
| `deploymentStatus` | `deployed` \| `planned` \| `catalogue` |

## Floor behavior

- Home desk in team room
- Status-driven animation: idle, working, blocked, compacting
- Cross-team messages → walk to recipient desk
- Meetings → walk to conference room
- Hive `AGENT_MESSAGE` → flying envelope

## Profile UI (COOS HQ)

Click agent → **Profile** tab: role, timestamps, goals, schedules, editable system prompt, reporting chain.

## Bridge

`backend/munder-web/src/coos/bridge.ts` seeds from `/api/agents/live` and syncs WebSocket status/message events.
