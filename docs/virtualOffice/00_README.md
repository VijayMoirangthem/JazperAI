# Virtual Office 2 - planning pack

Goal: replace the Virtual Office panel with a WorkAdventure-style 2D office (rooms, avatars, live agent status, proximity chat, ID cards, add/edit employees), driven by our own `/ws/rpc` events.

| File | What it is |
|---|---|
| `01_workadventure_study.md` | What was verified in the WorkAdventure code (real paths), reuse matrix |
| `02_decision_adr.md` | Decision: own Phaser code + WorkAdventure conventions (Option C); why not self-hosting (licence, RAM, no bot API) |
| `03_target_design.md` | Modules, map format, data flow, behaviour rules, acceptance criteria F1-F14 |
| `04_asset_plan.md` | Licence audit, procedural art plan, optional CC0 upgrade path |
| `05_test_plan.md` | Test layers, commands, e2e flows, perf protocol, reviewer checklist |
| `06_risk_register.md` | Risks and mitigations (shared working tree with another model, licence, perf, Windows) |
| `promptsVirtualOffice.md` | 18 ordered, self-contained prompts for Nemotron (paste PREAMBLE first) |
| `previews/` | Generated PNG previews of the map and avatars (created by P03/P06) |
| `PROGRESS.md` | Created by P01, one row per finished prompt |

Non-goals: video/voice rooms, multi-human multiplayer, a map editor UI, backend changes, WorkAdventure code or art.

Workflow: Nemotron runs prompt N on branch `feature/office2` -> Claude reviews with the checklist -> next prompt. The founder approves the switch (P18) explicitly.
