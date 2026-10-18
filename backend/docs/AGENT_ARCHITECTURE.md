# COOS Agent Architecture

## Hierarchy

```
JAZPER (GOD / Global Orchestrator)
  -> Department Heads (one per department)
    -> Agents
      -> Tools
```

## The GOD role (Jazper)

Jazper is the primary personal AI assistant and global orchestrator. On the
office floor, Jazper occupies the HQ desk, reads the hive board and task kanban,
dispatches work to department heads/agents, and escalates only what needs a human
(approvals). Jazper's behavior is defined by its system prompt in
`agent_registry` and the chain-loop orchestrator in `chat.py`.

## Department structure

- 16 departments seeded in `departments` (`executive`, `intelligence`,
  `communications`, `operations`, `it`, `security`, `personal`, `marketing`,
  `sales`, `finance`, `hr`, `analytics`, `research`, `relations`, `creative`,
  `quality_assurance`).
- Each department has a `head_agent`, an enable/disable toggle, a budget, a
  badge color, and a `floor_position` (grid cell) used by the office floor.
- Department heads coordinate their team's agents; agents have a level (L1-L5),
  a model, a system prompt, and a badge/avatar identity.

## Agent runtime

- Agents are defined in `agent_registry` (persistent) and run as managed
  in-process tasks (not external processes).
- The runtime manager (`app/services/agent_runtime.py`) tracks live status,
  current action, and an activity stream per agent.
- Each agent has a workspace under `storage/hive/agents/<codename>/` with
  identity, memory, inbox, and outbox.

## Agent capabilities

- 16 tools: list_agents, get_agent_info, list_departments, create_agent,
  update_agent_settings, update_agent_status, delete_agent, update_dept_settings,
  list_files, read_file, write_file, run_command, install_package, web_search,
  save_memory, recall_memory.
- Risky tools (`write_file`, `install_package`, `delete_agent`) require human
  approval via the approval overlay.
- All mutations are logged to `evolution_log`.

## Future extensibility (foundation only)

The architecture is designed so the user can later:

- create/delete/rename departments and heads
- create/delete/edit agents, change roles/prompts/capabilities
- assign tools, permissions, models, memory
- change hierarchy, move agents between departments
- create specialized/temporary agents and teams

These are intentionally NOT implemented in Phase 1; the registry + runtime +
hive structures make them clean additions later.