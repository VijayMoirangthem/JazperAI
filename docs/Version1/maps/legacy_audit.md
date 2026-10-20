# Legacy panel audit

Generated from plugin-registry.ts; main GET endpoints probed against the running backend (status code; 405 = POST-only, skipped).
Findings: `/api/jobs/*` returned 500 (jobs.py used the new context-manager `_pg()` as a plain connection) - **fixed**. Gmail/Calendar 401 until Google sign-in (Connections will fix). `/api/ide/tree` and `/api/control-tower/processes` time out. `/api/agents/autonomy-log` is 404 (Company panel).

**Totals:** keep 25, merge 34, retire 12.

| id | label | probe | verdict | note |
|---|---|---|---|---|
| dashboard | Dashboard | no component | merge | Team Chat home; stats move to FinOps/Live Agents |
| chat | Jazper | no component | merge | Duplicate of Team Chat (ChatPanel2) |
| notifications | Notifications | no GET calls | keep | Keep; surface as bell in Team Chat header |
| munder | Munder Difflin | no GET calls | retire | Demo office; Virtual Office replaces |
| cooshq | COOS HQ | no GET calls | retire | Old command floor; Virtual Office + Live Agents replace |
| mood | Mood & Energy | 200 mood; 200 mood/today | keep | Personal; re-home as skill |
| habits | Habits | no GET calls | keep | Personal; skill |
| focus | Focus Timer | 200 focus/stats; 200 focus/sessions | keep | Personal; skill |
| voice_journal | Voice Journal | 200 voice-journal | keep | Personal; skill (uses voice2 STT) |
| reading_list | Reading List | 200 reading-list | keep | Personal; skill |
| memory | Memory | 404 v1/memory2 | keep | Already Memory v2 |
| briefings | Daily Brief | no GET calls | keep | Daily brief; skill backed by Gmail/Calendar |
| phases | Mind Simulation | 200 phases/sessions; 200 phases/personalities | retire | Mind Simulation; no overlap with the new design |
| voice_mode | Voice Mode | no GET calls | merge | Replaced by Team Chat voice (G3) |
| voice_profile | Voice Profile | 200 voice-profile/config; 200 voice/voices | merge | Fold into AI Providers/Settings voice section |
| jobs | Job Search | 500 jobs/; 500 jobs/runs/all; 500 jobs/profile/ | keep | Career skill (was 500, now fixed) |
| jobapply | Job Apply | 200 apply/profile; 200 apply/screening; 200 apply/cover-letters | keep | Career skill |
| applications | Applications | 200 apply/applications | keep | Career skill |
| job_radar | Job Radar | 200 jobs/radar | keep | Career skill |
| resume | Resume Builder | no GET calls | keep | Career skill |
| interview_prep | Interview Prep | 200 interview-prep/sessions | keep | Career skill |
| salary_coach | Salary Coach | (POST/405 only) | merge | Merge into one Career skill |
| offer_eval | Offer Evaluator | 200 offer-eval | merge | Merge into one Career skill |
| networking | Networking | 200 contacts/networking | merge | Merge with Contacts |
| app_funnel | App Intelligence | 200 apply/funnel; 200 apply/salary | merge | Merge into Applications |
| gmail | Gmail | 200 google/oauth/authorize; 401 google/gmail/jazper-summary; 200 google/oauth/status | keep | Needs Connections (Google sign-in) - 401 until connected |
| email_triage | Email Triage | 200 triage/inbox | keep | Gmail skill |
| compose | Compose Email | no GET calls | merge | Merge into Gmail |
| email_analytics | Email Analytics | 200 email-analytics | merge | Merge into Gmail |
| followup | Follow-Ups | 200 followup/due; 200 followup/history | keep | Gmail skill |
| calendar | Calendar | 422 calendar/events; 401 calendar/week | keep | Needs Connections - 401 until connected |
| contacts | Contacts | no GET calls | keep | Personal CRM |
| templates | Templates | 200 templates | merge | Merge into Gmail compose |
| reminders | Reminders | 200 reminders | keep | Personal; skill |
| memory_graph | Memory Graph | 200 memory/core; 200 memory/extracted; 200 memory/auto | merge | Merge into Memory v2 (graph tab) |
| knowledge | Knowledge Base | no GET calls | merge | Merge into Memory v2 |
| shared_memory | Shared Memory | 200 shared-memory; 200 shared-memory/agents | merge | Merge into Memory v2 |
| search | Search | no GET calls | merge | Merge into Team Chat search |
| sage | Sage Memory | 200 memory/sage; 200 memory/core; 200 memory/extracted | retire | Old Sage memory explorer; Memory v2 replaces |
| history | History | 200 history/ | merge | Team Chat history |
| digest | Weekly Digest | 200 digest | keep | Weekly digest; skill |
| tasks | Tasks | 200 tasks/ | keep | Daily-use |
| planner | Daily Planner | no GET calls | keep | Daily-use; skill |
| sprints | Sprints | 200 sprints | merge | Merge into Business projects |
| goals | Goals | 200 goals | keep | Daily-use |
| standup | Daily Standup | 200 standup/history | merge | Merge into Live Agents standup |
| task_priority | Task Priority | 200 task-priority | merge | Merge into Tasks |
| activity_timeline | Timeline | 200 activity | merge | Merge into Live Agents |
| logs | Logs | 200 logs/stream | merge | Merge into System |
| portfolio | Portfolio | 200 portfolio | retire | Showcase; unused |
| workflows | Workflows | no component | retire | No panel component (placeholder) |
| webhooks | Webhooks | 200 webhooks | merge | Merge into Tool Hub |
| automation | Automation | no GET calls | retire | Placeholder; Tool Hub + Dev Loop replace |
| browser | Browser | no component | retire | Placeholder |
| agents | Agents | 200 agents/; 200 agents/departments/; 200 agents/autonomy/ | merge | Merge into Org Chart |
| marketplace | Marketplace | 200 agents/templates; 200 agents/ | merge | Merge into Org Chart (hire from template) |
| evolution | Evolution Log | 200 evolution; 200 evolution/stats | retire | Mutation audit trail; superseded by hub audit + git |
| it_dept | IT Department | 200 it/logs/stream; 200 it/tickets; 200 it/errors | merge | Merge into Dev Loop (repair tickets) |
| approvals | Approvals | 200 approvals/history | merge | Duplicate of HITL cards in Team Chat; keep history view in System |
| pipeline | Pipeline | no GET calls | retire | Mind map; Live Agents replaces |
| ide | IDE | ERR ide/tree; 422 ide/file; 200 ide/git/status | merge | Duplicate of AI Diff Editor |
| db_changes | DB Changes | 200 db-changes | merge | Merge into System |
| model_costs | Model Costs | 200 model-costs/summary; 200 model-costs/daily; 200 model-costs/by-source | merge | Duplicate of FinOps |
| qa | QA Center | 200 it/performance | merge | Merge into Dev Loop |
| observatory | Observatory | 200 stream/stream; 200 stream/status | merge | Duplicate of Live Agents |
| company | Company | 200 company/kpis; 200 company/departments; 404 agents/autonomy-log | merge | Duplicate of Org Chart/FinOps |
| control_tower | Control Tower | ERR control-tower/processes; 200 control-tower/resources; 200 control-tower/terminal/log | merge | Merge into System |
| plans | Plans | 200 plans/ | merge | Merge into Dev Loop/Org Chart |
| command_center | Command Center | (POST/405 only) | retire | Old chat/voice entry; Team Chat replaces |
| roadmap | Roadmap | 200 roadmap/notes; 200 roadmap/stats; 200 roadmap/context | retire | Replaced by docs/06_PLAN_V2.md |
| settings | Settings | 200 models; 200 telegram/status | keep | Keep (bottom of rail) |

Nothing is removed until approved; git history keeps everything.
