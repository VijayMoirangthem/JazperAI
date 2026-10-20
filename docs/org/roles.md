# Organisation, reporting lines and escalation (Plan V3 W6)

Source of truth for roles is the bot registry (`shared.bot_definitions` + `shared.bot_org`); this page explains the structure. Spec: `docs/Sir Jasper AI.docx` sections 2, 13, 16, 20.

## Chart
```
Founder
└─ Jasper (chief orchestrator; delegates, never does the specialists' work)
   ├─ Jazper Team (personal): Messenger (mail), Connector (integrations), Bot Creator, Bot Reviewer, Scout, Atlas, personal assistants
   ├─ Create Origins (holding company)
   │   ├─ Executives: CEO of Create Origins, CFO, COO, General Counsel, VP Technology & Operations
   │   ├─ Core Operations: task dispatcher, state router, incident response
   │   ├─ Finance & Treasury: finance-treasury-bot            (reports to CFO)
   │   ├─ People: peopleops-bot, create-origins-hr-bot, travelops-bot
   │   ├─ IT & Core Systems, R&D, SRE (ChaosBot)
   ├─ Baeit (food-surplus marketplace)
   │   ├─ CEO / Product Lead of Baeit
   │   ├─ Engineering & Operations: backend, mobile, partner ops, QA
   │   └─ People & Governance (dedicated): baeit-hr-bot, baeit-legal-bot, baeit-secretary-bot, baeit-ca-bot
   └─ Boardmint (governance & compliance)
       ├─ Chief Governance Officer / Lead of Boardmint
       └─ Compliance & Governance: legal-compliance-bot, corp-secretary-bot, doc-archival-bot, boardmint-hr-bot, boardmint-ca-bot
```

## Who does what (rules of the road)
- **Jasper** routes. It asks `find_bot` for the owner, delegates to the group lead, and reports back. Raw tools (mail, files) belong to specialists: email goes to Messenger, connections to Connector.
- **Group leads** (CEO Baeit, Chief Governance Officer, CEO Create Origins, VP Tech & Ops) plan, delegate inside their group, hold meetings for decisions (the conclusion is saved to the group's memory), and report. Bots can only ask bots in their own group (plus Jasper, Connector, Messenger); cross-group work goes through the leads or Jasper.
- **Matrix (dual reporting):** functional experts (CFO, General Counsel, VP Tech) advise every company's bots on their discipline; the division lead owns priorities and delivery. When they conflict the COO proposes a resolution and **Jasper arbitrates**; the founder decides anything Tier 3.
- **Treasury control:** spending, payment-gateway bindings and API credit caps stay with the parent (CFO). Subsidiaries run their own product and people operations.

## Approval tiers (all roles)
Tier 1 autonomous: read, search, draft, analyse. Tier 2 notify + veto window: create a branch, draft a message, write a file in a workspace. Tier 3 explicit founder approval: merge to main, deploy, payments, filings, external mass communication, hiring or termination, binding contracts. After reading external content (email, files, web) every write is escalated to Tier 3 (see `docs/ops/prompt_injection.md`).

## Hiring a bot (lifecycle)
1. Need identified (by you, Jasper, or PeopleOps). 2. `find_bot` checks nobody already fits. 3. Bot Creator drafts the definition; Jasper creates it (Tier 2 approval); it starts in **probation**. 4. Within about a minute it is interviewed by its division lead (6 questions) and benchmarked (instruction following, escalation, hallucination, injection resistance, role task). 5. Both scores ≥ 70 → **active**; otherwise it stays in probation and an alert says why. 6. Weekly, bots below 60 with at least 10 turns get an improvement plan: a better prompt is proposed, benchmarked, and applied only if it scores at least 5 points higher and you approve. Nothing is deleted or disabled automatically.
Every interview, benchmark, clearance and plan is stored append-only (`shared.bot_evaluations`) and shown on the bot's ID card.

## Compliance guardrails baked into the staff prompts
India context (Companies Act 2013, GST, Income-tax, TDS, PF/ESI, POSH). Each compliance statement must name the section or form, give the due-date rule and say how certain it is; if unsure the bot says "verify with the official source". Bots prepare drafts and checklists; **no bot files, pays, signs, hires or fires**. These are drafting aids, not legal or tax advice: a qualified professional should review filings.

## Open items for the founder
Real names and contact details for the human counterparts (company secretary, CA, counsel) so approvals can be routed to them (`core/hitl.py` approver placeholders); thresholds for spending approvals; which statutory calendar to follow per entity (financial-year end, AGM dates).
