# COOS — ORGANIZATIONAL STRUCTURE & AGENT COMPANY MODEL

Project:
COOS = Create Origins Operating System

Primary AI:
Jazper

Jazper is the highest-level personal AI orchestrator and acts as the central intelligence coordinating the entire COOS organization.

==================================================
OBJECTIVE
==================================================

We need to redesign and formalize the organizational/company structure inside COOS.

The current COOS already contains departments, agents and systems, but the structure is not sufficiently standardized or scalable.

We now want COOS to model a realistic modern organization.

IMPORTANT:

Do NOT simply create a static list of departments.

Build a flexible ORGANIZATIONAL MODEL that can represent:

Company
→ Executive layer
→ Divisions
→ Departments
→ Functions
→ Teams
→ Department Heads
→ Directors
→ Managers
→ Supervisors
→ Specialists
→ Associates
→ Assistants
→ Interns
→ Contractors
→ Freelancers
→ Temporary agents
→ AI agents
→ Human employees
→ External partners

The structure must be dynamic.

The user must eventually be able to create, modify, merge, split, disable or remove organizational units and positions.

==================================================
REFERENCE MATERIAL
==================================================

Study these references carefully:

1.
https://www.indeed.com/career-advice/career-development/business-departments

2.
https://www.indeed.com/career-advice/starting-new-job/business-roles

3.
https://www.indeed.com/career-advice/finding-a-job/human-resources-definition

4.
https://simplicable.com/en/company-departments

Also inspect relevant linked/related articles from these references where useful.

Do NOT blindly copy their structure.

Use them as organizational research/reference material.

Extract:

- departments
- functions
- roles
- job titles
- executive positions
- managerial positions
- operational positions
- administrative positions
- specialist positions
- support positions
- responsibilities
- reporting relationships
- organizational concepts
- business functions
- organizational design concepts

Where multiple sources use different names for similar functions, normalize them into a common COOS model.

==================================================
CORE PRINCIPLE
==================================================

COOS is NOT supposed to simulate only a traditional company.

It is a PERSONAL + BUSINESS + AI OPERATING SYSTEM.

Therefore the organizational structure must support:

1. Human employees
2. AI agents
3. Hybrid human-AI teams
4. External freelancers
5. Contractors
6. Consultants
7. Temporary agents
8. External organizations
9. Automated systems
10. Departments that may contain both humans and AI

Example:

Engineering Department

Head:
CTO / Head of Engineering

Team:

Frontend Team
Backend Team
Mobile Team
QA Team
DevOps Team

Members:

Human developer
AI developer agent
AI QA agent
Freelance developer
Intern

All of these should be valid COOS organizational entities.

==================================================
JAZPER
==================================================

Jazper is the primary orchestrator.

Jazper should conceptually sit above the organizational hierarchy.

Jazper:

- understands the overall organization
- coordinates departments
- delegates work
- monitors organizational status
- communicates with department heads
- coordinates cross-department work
- resolves conflicts
- monitors KPIs
- coordinates AI agents
- coordinates humans
- requests human approval when necessary
- maintains organizational memory
- understands responsibilities and authority
- can create temporary teams
- can recommend organizational changes

However:

Jazper must NOT automatically override every organizational role.

The system should support authority, permissions and delegation.

==================================================
ORGANIZATIONAL HIERARCHY
==================================================

Design the hierarchy approximately as:

JAZPER
│
├── Executive / Strategic Layer
│
├── Divisions / Business Units
│
├── Departments
│
├── Teams
│
├── Roles / Positions
│
└── People / Agents

But DO NOT make this hierarchy rigid.

Some organizations may use:

Jazper
→ Department
→ Manager
→ Agents

Others may use:

Jazper
→ Division
→ Director
→ Department
→ Manager
→ Team
→ Agents

Some departments may contain only one person.

Some departments may be completely automated.

Some departments may not require a department head.

==================================================
EXECUTIVE STRUCTURE
==================================================

Create a comprehensive model for executive roles.

Include common positions such as:

- CEO
- President
- COO
- CFO
- CTO
- CMO
- CHRO / Chief People Officer
- CIO
- CISO
- CRO
- Chief Legal Officer / General Counsel
- Chief Product Officer
- Chief Strategy Officer
- Chief Information Officer
- Chief Data Officer
- Chief Customer Officer
- Chief Revenue Officer
- Chief Experience Officer
- Chief Innovation Officer
- Chief Risk Officer
- Executive Assistant
- Chief of Staff
- Board / Advisor structures where appropriate

Do NOT assume every company needs every role.

The system should allow:

role exists
role does not exist
role combined with another role
role temporarily outsourced
role assigned to human
role assigned to AI
role assigned to the owner
role assigned to external consultant

==================================================
CORE COMPANY DEPARTMENTS
==================================================

Build a normalized master catalogue.

At minimum investigate and model:

1. Executive / General Management
2. Administration
3. Operations
4. Human Resources / People
5. Finance
6. Accounting
7. Legal
8. Compliance
9. Risk Management
10. Information Technology
11. Information Security / Cybersecurity
12. Engineering / Software Development
13. Research & Development
14. Product Management
15. Design / Creative
16. Marketing
17. Sales
18. Business Development
19. Customer Service
20. Customer Success
21. Corporate Communications / Public Relations
22. Procurement / Purchasing
23. Supply Chain
24. Production
25. Quality Assurance / Quality Control
26. Data / Analytics
27. Strategy
28. Project / Program Management
29. Investor Relations
30. Asset Management
31. Facilities / Office Management
32. Knowledge Management
33. Innovation
34. Partnerships
35. Corporate Strategy
36. Business Intelligence
37. Geographic / Regional Operations
38. Other industry-specific functions

This is a starting catalogue, NOT a fixed final list.

Use the references to expand and normalize it.

==================================================
IMPORTANT: DEPARTMENT VS FUNCTION VS ROLE
==================================================

Do NOT treat these as the same thing.

For example:

"Finance" = Department / Function

"CFO" = Executive Position

"Finance Manager" = Managerial Position

"Accountant" = Operational Role

"Bookkeeper" = Specialist/Operational Role

Similarly:

"Marketing" = Department

"CMO" = Executive

"Marketing Director" = Leadership

"Marketing Manager" = Manager

"Marketing Specialist" = Specialist

"Content Writer" = Operational Role

"Social Media Manager" = Specialist/Managerial Role

This distinction must exist in the COOS data model.

==================================================
POSITION MODEL
==================================================

Every position should have structured metadata.

Example:

Position:
Senior Frontend Developer

Department:
Engineering

Team:
Frontend Engineering

Level:
Senior / Individual Contributor

Reports To:
Frontend Engineering Manager

Responsibilities:
...

Required Skills:
...

Tools:
...

Authority:
...

Permissions:
...

KPIs:
...

Employment Type:
Human / AI / Freelancer / Contractor

Status:
Active / Vacant / Suspended / Archived

Model:
Claude / GPT / Local Model / etc.

Prompt:
...

Memory:
...

==================================================
FUNCTIONAL NAME VS PERSONAL NAME
==================================================

This is VERY IMPORTANT.

COOS must separate:

FUNCTIONAL IDENTITY

from

PERSONAL IDENTITY.

Example:

Functional Role:
Senior Frontend Developer

Personal Name:
Rahul Sharma

Display:

Rahul Sharma
Senior Frontend Developer
Engineering Department

For an AI:

Functional Role:
Frontend Development Agent

Personal Name:
Arjun

Display:

Arjun
Frontend Development Agent
Engineering Department

Therefore:

"Role" ≠ "Name"

"Position" ≠ "Person"

"Agent" ≠ "Role"

"Person" ≠ "Department"

These must be separate entities in the data model.

==================================================
NAMING
==================================================

Support both:

English names
Indian names

Examples:

English:
Michael
James
Sophia
Alex

Indian:
Arjun
Aarav
Ananya
Priya
Rahul
Vikram
Kavya
Aditya

The user should be able to manually assign names.

The system may generate names for AI agents.

Names should NOT determine the functional role.

For example:

"Arjun" could be:

CTO
Frontend Developer
HR Manager
Research Agent

depending on the assigned position.

==================================================
AI AGENT MODEL
==================================================

AI agents should behave like organizational workers.

Each AI agent should have:

- unique ID
- personal/display name
- functional role
- department
- team
- department head
- supervisor
- system prompt
- role instructions
- skills
- tools
- permissions
- model
- memory
- knowledge access
- communication channels
- task queue
- current task
- status
- cost tracking
- performance metrics
- creation date
- evolution history
- approval requirements

Example:

Name:
Arjun

Role:
Frontend Developer Agent

Department:
Engineering

Head:
CTO

Manager:
Frontend Engineering Manager

Model:
Claude

Tools:
Git
Terminal
Browser
VS Code
Docker

Permissions:
Read/write project workspace
No financial access

==================================================
HUMAN EMPLOYEE MODEL
==================================================

Humans should use the same organizational framework.

However, they should have additional HR information such as:

- employment type
- joining date
- compensation
- manager
- department
- skills
- documents
- performance
- leave
- availability
- onboarding status
- contracts
- emergency/contact information
- training
- employment status

Keep sensitive HR data behind appropriate permissions.

==================================================
FREELANCER / CONTRACTOR MODEL
==================================================

Support:

- freelancers
- contractors
- consultants
- vendors
- external agencies
- temporary workers

They may belong to a project without belonging permanently to a department.

==================================================
DYNAMIC ORGANIZATION
==================================================

The user must eventually be able to say:

"Create a Marketing Department."

or:

"Create a Head of Marketing."

or:

"Create a social media team under Marketing."

or:

"Create an AI social media manager named Maya."

or:

"Move Maya to Communications."

or:

"Change Maya's prompt."

or:

"Make Maya report to the Marketing Director."

or:

"Create three temporary agents for this campaign."

The architecture must support these operations.

==================================================
DEPARTMENT HEADS
==================================================

Every department may have:

- Head
- Director
- Manager
- Team Leads
- Specialists
- Workers

But these are optional.

For small organizations:

Department
→ One Head
→ Several workers

For larger organizations:

Department
→ Director
→ Managers
→ Teams
→ Specialists

For AI departments:

Department
→ AI Head
→ AI Managers
→ AI Agents

==================================================
CROSS-DEPARTMENT COLLABORATION
==================================================

Departments must NOT be isolated.

Example:

Client wants a website.

Business Development:
→ receives client requirement

Sales:
→ prepares proposal

Finance:
→ evaluates pricing

Legal:
→ handles contract

Project Management:
→ creates project

Engineering:
→ builds website

Design:
→ creates UI

QA:
→ tests

Marketing:
→ prepares launch

Customer Success:
→ handles client relationship

Finance:
→ tracks invoice/payment

Jazper:
→ coordinates the overall workflow

This interconnected workflow is one of the most important goals of this architecture.

==================================================
MATRIX / PROJECT TEAMS
==================================================

Support employees and agents belonging to:

Primary Department

AND

Temporary Project Team.

Example:

Rahul

Primary:
Engineering

Temporary:
Client ABC Website Project

Therefore reporting and project assignment must be different concepts.

==================================================
RESPONSIBILITY MODEL
==================================================

Every organizational entity should have:

- responsibilities
- authority
- objectives
- KPIs
- required tools
- dependencies
- escalation path
- reporting structure
- permissions

Use concepts such as:

Responsible
Accountable
Consulted
Informed

where appropriate.

==================================================
ORGANIZATIONAL FLEXIBILITY
==================================================

COOS must support:

Create
Read
Update
Delete
Merge
Split
Move
Archive
Deactivate
Duplicate
Clone
Assign
Reassign

for:

- departments
- teams
- positions
- roles
- agents
- employees
- projects
- reporting relationships

==================================================
COOS DATA MODEL
==================================================

Design proper entities for:

Organization
Division
Department
Team
Position
Role
Person
Employee
Agent
DepartmentHead
Manager
Project
Assignment
ReportingRelationship
Permission
Capability
Tool
Model
Prompt
Memory
KPI
Task
Workflow

Avoid storing everything as one giant Agent object.

Relationships should be explicit.

==================================================
UI / VISUALIZATION — COOS HQ
==================================================

Primary surface:
  http://localhost:3001/#cooshq

Legacy alias (auto-redirect):
  #munderdifflin → #cooshq

Demo office (no live backend):
  #munder

Stack:
  frontend/src/components/panels/MunderDifflinPanel.tsx  → iframe host
  backend/munder-web/                                    → Pixi office renderer
  http://localhost:8000/munder/index.html                → coos mode
  Data: GET /api/agents/live + WebSocket /ws/ + /api/hive/*

Hierarchy (real org → floor):

  Building  → Company (Create Origins)
  Floor     → Division / System layer
  Wing      → Department
  Room      → Team
  Desk      → Agent (AI or human)

Semantic zoom (content changes by level):

  FAR    → floor picker, division blocks, status heatmap
  MID    → department wings, team clusters, count badges
  NEAR   → desks, avatars, thought bubbles
  FOCUS  → single agent/team + Command Center panel

RULE: Never render 500 animated sprites. Catalogue ≠ floor population.

User click path:
  Department → Head → Teams → Members → Tasks / KPIs / Comms / Projects

==================================================
IMPLEMENTATION PHASES — COOS HQ FLOOR
==================================================

Execute IN ORDER. One phase per session unless user says otherwise.
After each phase: rebuild munder-web, test #cooshq, mark [x] below, report status.

──────────────────────────────────────────────────
PHASE 0 — Org data foundation (backend)
──────────────────────────────────────────────────
Goal: Explicit org graph in DB + API (no description-string hacks).

Tasks:
  [x] Tables: divisions, teams; extend agent_registry with team_id, floor_id, desk_slot
  [x] GET /api/agents/live returns department_id, team_id, floor_id, title, level
  [x] GET /api/agents/departments/ includes division_id, floor_id
  [x] Seed ~40 agents into team assignments
  [x] bridge.ts maps by department_id / team_id (not description parsing)

Files:
  backend/python/app/db/init.py
  backend/python/app/routes/agents.py
  backend/munder-web/src/coos/bridge.ts

Done when: agents placed by API fields, not description string.

──────────────────────────────────────────────────
PHASE 1 — Floor controls + stable OfficeFloor
──────────────────────────────────────────────────
Goal: Controllable floor for ~40 agents.

Tasks:
  [x] OfficeFloor stable (no React hooks inside Pixi useEffect — fix #321)
  [x] React overlay: zoom +/−/reset, wing arrows ◀▶, breadcrumbs
  [x] Camera ref in zustand; useFloorNavigation at React layer only
  [x] Minimap overlay with viewport rectangle
  [x] Keyboard: +/- zoom, arrows pan, 1-9 zones, F focus agent
  [x] npm run build in backend/munder-web; bump MUNDER_BUILD in panel

Files:
  backend/munder-web/src/renderer/src/scene/office/OfficeFloor.tsx
  backend/munder-web/src/renderer/src/components/FloorNavBar.tsx
  backend/munder-web/src/renderer/src/components/Minimap.tsx
  frontend/src/components/panels/MunderDifflinPanel.tsx

Done when: #cooshq loads, agents visible, zoom/wings work, no error overlay.

──────────────────────────────────────────────────
PHASE 2 — Go-to search + zone navigation
──────────────────────────────────────────────────
Goal: Jump to any agent, department, or team.

Tasks:
  [x] Cmd+K / Ctrl+K palette: search agents, departments, teams
  [x] On select: store.select + camera.focusOnAgent / focusOnZone
  [x] Breadcrumb: Floor › Department › Team › Agent
  [x] Zone labels show total + active agent counts

Files:
  backend/munder-web/src/renderer/src/App.tsx
  backend/munder-web/src/renderer/src/store/store.ts
  New: backend/munder-web/src/renderer/src/components/GoToPalette.tsx

Done when: search "darwin" or "Finance" pans and selects target.

──────────────────────────────────────────────────
PHASE 3 — Multi-floor + team rooms (~80–100 agents)
──────────────────────────────────────────────────
Goal: Multiple floors; teams as rooms inside wings.

Tasks:
  [x] floors[] in store: { id, label, divisionId, mapTheme }
  [x] Floor dropdown or ◀ Floor 1 | Floor 2 ▶
  [x] Team rooms as sub-rectangles inside dept zones
  [x] Agents placed by team_id → room → desk_slot
  [x] Cross-team errands walk to target room
  [x] Conference room tile for multi-agent meetings

Done when: 2+ floors switchable; agents grouped by team.

──────────────────────────────────────────────────
PHASE 4 — Clustering + LOD (~100–200 agents)
──────────────────────────────────────────────────
Goal: Performance at scale.

Tasks:
  [x] Zone > 15 agents → cluster bubble ("Finance · 23"); click to expand
  [x] Off-screen agents not rendered; dots on minimap only
  [x] Animate only working/thinking or changed-in-5min agents
  [x] Zoom thresholds: <0.5x clusters, 0.5–1.5x rooms, >1.5x avatars
  [x] Cap: max 50 character sprites on screen

Done when: 100 agents, 60fps, clusters expand on click.

──────────────────────────────────────────────────
PHASE 5 — Org chart + catalogue mode (~500 catalogue)
──────────────────────────────────────────────────
Goal: Full org structure view; floor shows ACTIVE only.

Tasks:
  [x] Toggle: Floor view | Org chart (React Flow)
  [x] Org chart: Division → Dept → Team → Agent; click focuses floor
  [x] Master catalogue vs active org (deployed vs planned positions)
  [x] Agents panel: filter deployed / planned / catalogue
  [x] Floor shows active subset (~20–50); rest via search/chart
  [x] Dept heatmap overlay by health_score / task load

Done when: 500 catalogue in DB; floor shows active subset only.

──────────────────────────────────────────────────
PHASE 6 — Movement rules + live ops polish
──────────────────────────────────────────────────
Goal: Office feels alive.

Tasks:
  [x] Persistent home desk per agent
  [x] Status-driven animation (idle, working, blocked, compacting)
  [x] team_id change → walk to new room
  [x] Envelopes on AGENT_MESSAGE WebSocket events
  [x] Wing header health badge
  [x] Status strip: "12 working · 3 blocked · 28 idle"

Done when: reassignment moves avatar; messages fly between desks.

──────────────────────────────────────────────────
PHASE 7 — COOS HQ polish (profiles, org admin, UX)
──────────────────────────────────────────────────
Goal: Production-ready COOS HQ for daily use.

Tasks:
  [x] Region-aware scroll: wheel on sidebar scrolls; floor canvas pans/zooms at cursor
  [x] Agent profile panel: role, timestamps, goals, schedules, system prompt edit
  [x] COOS sidebar tabs: Profile | Messages | Traces | Settings
  [x] Manage org UI: floors, departments, teams, reassign, activate, zone layout
  [x] Org API: `/api/org/*` divisions, departments, teams, catalogue, activate
  [x] Flow org chart (interactive SVG); conference room panel
  [x] Conference walk: agents animate to boardroom on open; return on close
  [x] Cross-team message walks on hive AGENT_MESSAGE
  [x] Minimap agent dots, camera persist, drag-pan, health heatmap
  [x] Error boundary, keyboard help overlay
  [x] Organization docs: backend/docs/organization/
  [x] Activate agent adds to floor store if not already seeded
  [x] Zone reorder persists floor_position to DB

Files:
  backend/munder-web/src/renderer/src/components/AgentProfilePanel.tsx
  backend/munder-web/src/renderer/src/components/OrgAdminPanel.tsx
  backend/munder-web/src/renderer/src/components/FlowOrgChart.tsx
  backend/munder-web/src/renderer/src/hooks/useFloorNavigation.ts
  backend/python/app/routes/org.py
  backend/docs/organization/

Done when: click agent → employee card; manage org CRUD works; sidebar scrolls.

==================================================
AGENT MOVEMENT RULES
==================================================

  Default    → home desk in team room
  Working    → stay at desk; bubble shows action
  Cross-team → walk to target room
  Meeting    → conference room
  Reorg      → team_id change → walk on next tick
  Teams      → group move only for all-hands / migration events

==================================================
TECHNICAL RULES
==================================================

  1. React hooks ONLY in React components — never in Pixi init()
  2. Camera ref in zustand for nav overlay + GoToPalette
  3. Rebuild munder-web after renderer changes; bump MUNDER_BUILD
  4. bridge.ts seeds from /api/agents/live; keep WebSocket sync
  5. Serve backend/munder-web/dist only (no frontend/public/munder)
  6. Test: http://localhost:3001/#cooshq

==================================================
DO NOT OVERCREATE
==================================================

Do not create 500 agents just because the catalogue contains 500 possible positions.

We are creating a:

MASTER ORGANIZATIONAL CATALOGUE

and a:

CURRENT ACTIVE ORGANIZATION.

These are different.

Example:

Master catalogue:
500 possible positions.

Current COOS:
20 active positions.

Future:
User activates more positions when required.

==================================================
SMALL BUSINESS MODE
==================================================

COOS must work for a one-person company.

Example:

Owner
↓
Jazper
↓
Virtual Departments

Marketing
Finance
Engineering
HR
Operations
Sales

Many departments may initially have AI agents rather than humans.

==================================================
GROWTH MODE
==================================================

As the company grows:

Owner
↓
Jazper
↓
Executive Heads
↓
Department Heads
↓
Managers
↓
Employees
↓
Agents

The architecture should scale without redesigning the database.

==================================================
INDIA + GLOBAL
==================================================

The system should support Indian business realities as well as generic/global structures.

Do not hard-code US-only terminology.

Where relevant support:

- Indian job titles
- Indian employment concepts
- Indian business terminology
- INR
- Indian compliance/legal roles
- Indian payroll concepts

But keep the organizational model globally usable.

==================================================
DELIVERABLES
==================================================

Before implementation, create:

backend/docs/organization/

├── ORGANIZATION_MODEL.md
├── DEPARTMENTS.md
├── ROLES.md
├── POSITIONS.md
├── EXECUTIVE_STRUCTURE.md
├── AGENT_ORGANIZATION.md
├── HUMAN_ORGANIZATION.md
├── REPORTING_STRUCTURE.md
├── PERMISSIONS.md
├── RESPONSIBILITIES.md
├── ORGANIZATIONAL_CATALOGUE.md
├── COOS_CURRENT_STRUCTURE.md
└── ROADMAP.md

Create a comprehensive master catalogue containing:

Department
→ Functions
→ Positions
→ Roles
→ Typical hierarchy
→ Responsibilities
→ Example AI agents
→ Example human positions

==================================================
FINAL REQUIREMENT
==================================================

Do not simply reproduce the websites.

Research them.

Normalize them.

Resolve overlapping terminology.

Design a professional organizational model suitable for COOS.

The final architecture should make COOS capable of behaving like a complete virtual organization where:

Jazper = Central Orchestrator

Departments = Functional organizational units

Heads = Department-level intelligence/leadership

Managers = Coordination layer

Agents = AI workers

Employees = Human workers

Freelancers = External workers

Teams = Execution groups

Projects = Temporary cross-functional structures

Tools = Capabilities

Models = Intelligence providers

Prompts = Behavioral instructions

Memory = Organizational knowledge

Permissions = Authority

Tasks = Work

Workflows = Processes

KPIs = Performance

Logs = Accountability

The organizational structure must be dynamic, interconnected and scalable.

Do not implement all future functionality immediately.

EXECUTION ORDER:
  DONE:    Phases 0–7 (COOS HQ floor + polish)
  NEXT:    Organization roadmap items (see backend/docs/organization/ROADMAP.md)

Implementing agent instructions:
  1. Read this entire document
  2. Find first phase with unchecked [ ] tasks
  3. Implement that phase only
  4. Test http://localhost:3001/#cooshq
  5. Mark [x] on completed tasks
  6. Stop and report done / remaining / next phase

Last updated: 2026-08-23 (Phase 7 complete)