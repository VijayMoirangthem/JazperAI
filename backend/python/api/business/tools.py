"""COOS — Business Platform: LLM tool bridge for Client management.

Exposes OpenAI-format tool specs (BUSINESS_TOOLS) and a dispatcher
(execute_business_tool) that the business chat endpoint feeds into
ai_provider.stream_with_tools(...). This is intentionally decoupled from the
personal-OS agent orchestrator / agent_tools.py — separate product track.
"""

from __future__ import annotations

import asyncio
import json

import structlog

from api.business import client_service, finance_service, project_service, team_service

log = structlog.get_logger()

_STATUS_ENUM = ["prospect", "active", "paused", "churned"]
_PROJECT_STATUS_ENUM = ["planning", "active", "on_hold", "completed", "cancelled"]
_MEMBER_TYPE_ENUM = ["employee", "freelancer", "intern", "contractor"]
_RATE_UNIT_ENUM = ["hourly", "daily", "monthly", "fixed"]
_TEAM_STATUS_ENUM = ["active", "on_leave", "inactive"]
_INVOICE_STATUS_ENUM = ["draft", "sent", "paid", "overdue", "cancelled"]
_EXPENSE_CATEGORY_ENUM = ["software", "contractor", "travel", "office", "other"]

BUSINESS_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "create_client",
            "description": (
                "Create a new client record in the COOS business platform. Use this when the "
                "user asks to add, register, or onboard a new client, customer, or prospect."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "The client's company or individual name. Required.",
                    },
                    "contact_name": {
                        "type": "string",
                        "description": "Name of the primary point of contact at the client, if known.",
                    },
                    "contact_email": {
                        "type": "string",
                        "description": "Email address of the primary contact, if known.",
                    },
                    "phone": {
                        "type": "string",
                        "description": "Phone number for the client or its primary contact, if known.",
                    },
                    "notes": {
                        "type": "string",
                        "description": "Any free-form notes about the client (context, source, deal details).",
                    },
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_clients",
            "description": (
                "List clients in the COOS business platform, most recently created first. "
                "Use this when the user asks to see, review, or count their clients, optionally "
                "filtered to a specific pipeline stage."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": _STATUS_ENUM,
                        "description": (
                            "Optional filter: only return clients currently in this stage. "
                            "'prospect' = not yet won, 'active' = currently engaged, "
                            "'paused' = temporarily inactive, 'churned' = relationship ended. "
                            "Omit to return clients in every stage."
                        ),
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_client",
            "description": (
                "Fetch full details for a single client by its ID. Use this when the user "
                "references a specific client and you need its current data before answering "
                "or before performing an update."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "client_id": {
                        "type": "string",
                        "description": "The UUID of the client to fetch. Required.",
                    },
                },
                "required": ["client_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_client",
            "description": (
                "Update one or more fields on an existing client. Only the fields the user "
                "actually wants changed should be provided — omitted fields are left untouched. "
                "Use this to change contact details, add notes, or move a client to a new "
                "pipeline stage (status)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "client_id": {
                        "type": "string",
                        "description": "The UUID of the client to update. Required.",
                    },
                    "name": {
                        "type": "string",
                        "description": "New name for the client, if it should change.",
                    },
                    "contact_name": {
                        "type": "string",
                        "description": "New primary contact name, if it should change.",
                    },
                    "contact_email": {
                        "type": "string",
                        "description": "New primary contact email, if it should change.",
                    },
                    "phone": {
                        "type": "string",
                        "description": "New phone number, if it should change.",
                    },
                    "status": {
                        "type": "string",
                        "enum": _STATUS_ENUM,
                        "description": (
                            "New pipeline stage for the client: 'prospect', 'active', 'paused', "
                            "or 'churned'. Only set this when the user explicitly wants to move "
                            "the client to a new stage."
                        ),
                    },
                    "notes": {
                        "type": "string",
                        "description": "Replacement notes text for the client, if it should change.",
                    },
                },
                "required": ["client_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_client",
            "description": (
                "Permanently remove a client record from the COOS business platform. Use this "
                "only when the user explicitly asks to delete or remove a client — this cannot "
                "be undone."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "client_id": {
                        "type": "string",
                        "description": "The UUID of the client to delete. Required.",
                    },
                },
                "required": ["client_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_project",
            "description": (
                "Create a new project record under a client in the COOS business platform. "
                "Use this when the user asks to start, add, or set up a new project, engagement, "
                "or piece of work for a client. Requires the client's UUID — if you only have the "
                "client's name, first call list_clients or get_client to look up its id before "
                "calling this."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "client_id": {
                        "type": "string",
                        "description": "The UUID of the client this project belongs to. Required.",
                    },
                    "title": {
                        "type": "string",
                        "description": "Short name/title for the project. Required.",
                    },
                    "description": {
                        "type": "string",
                        "description": "Longer description of the project's scope or goals, if known.",
                    },
                    "start_date": {
                        "type": "string",
                        "description": "Planned or actual start date, in ISO format YYYY-MM-DD, if known.",
                    },
                    "due_date": {
                        "type": "string",
                        "description": "Target completion/due date, in ISO format YYYY-MM-DD, if known.",
                    },
                    "notes": {
                        "type": "string",
                        "description": "Any free-form notes about the project.",
                    },
                },
                "required": ["client_id", "title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_projects",
            "description": (
                "List projects in the COOS business platform, most recently created first. "
                "Use this when the user asks to see, review, or count projects, optionally "
                "scoped to a specific client and/or filtered to a specific status."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "client_id": {
                        "type": "string",
                        "description": "Optional filter: only return projects belonging to this client UUID.",
                    },
                    "status": {
                        "type": "string",
                        "enum": _PROJECT_STATUS_ENUM,
                        "description": (
                            "Optional filter: only return projects currently in this status. "
                            "'planning' = not yet started, 'active' = in progress, "
                            "'on_hold' = paused, 'completed' = finished, 'cancelled' = abandoned. "
                            "Omit to return projects in every status."
                        ),
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_project",
            "description": (
                "Fetch full details for a single project by its ID. Use this when the user "
                "references a specific project and you need its current data before answering "
                "or before performing an update."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "project_id": {
                        "type": "string",
                        "description": "The UUID of the project to fetch. Required.",
                    },
                },
                "required": ["project_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_project",
            "description": (
                "Update one or more fields on an existing project. Only the fields the user "
                "actually wants changed should be provided — omitted fields are left untouched. "
                "Use this to change the title, description, dates, notes, or move a project to a "
                "new status."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "project_id": {
                        "type": "string",
                        "description": "The UUID of the project to update. Required.",
                    },
                    "title": {
                        "type": "string",
                        "description": "New title for the project, if it should change.",
                    },
                    "description": {
                        "type": "string",
                        "description": "New description for the project, if it should change.",
                    },
                    "status": {
                        "type": "string",
                        "enum": _PROJECT_STATUS_ENUM,
                        "description": (
                            "New status for the project: 'planning', 'active', 'on_hold', "
                            "'completed', or 'cancelled'. Only set this when the user explicitly "
                            "wants to move the project to a new status."
                        ),
                    },
                    "start_date": {
                        "type": "string",
                        "description": "New start date, in ISO format YYYY-MM-DD, if it should change.",
                    },
                    "due_date": {
                        "type": "string",
                        "description": "New due date, in ISO format YYYY-MM-DD, if it should change.",
                    },
                    "notes": {
                        "type": "string",
                        "description": "Replacement notes text for the project, if it should change.",
                    },
                },
                "required": ["project_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_project",
            "description": (
                "Permanently remove a project record from the COOS business platform. Use this "
                "only when the user explicitly asks to delete or remove a project — this cannot "
                "be undone."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "project_id": {
                        "type": "string",
                        "description": "The UUID of the project to delete. Required.",
                    },
                },
                "required": ["project_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_team_member",
            "description": (
                "Add a new team member to the COOS business platform — covers employees, "
                "freelancers, interns, and contractors alike. Use this when the user asks to "
                "add, hire, onboard, or register a new person working for the business."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "The team member's full name. Required.",
                    },
                    "email": {
                        "type": "string",
                        "description": "The team member's email address, if known.",
                    },
                    "role": {
                        "type": "string",
                        "description": "Job title or role, e.g. 'Backend Engineer' or 'Designer', if known.",
                    },
                    "member_type": {
                        "type": "string",
                        "enum": _MEMBER_TYPE_ENUM,
                        "description": (
                            "What kind of team member this is: 'employee', 'freelancer', "
                            "'intern', or 'contractor'. Defaults to 'employee' if not specified."
                        ),
                    },
                    "rate": {
                        "type": "number",
                        "description": "Pay rate as a number, if known (interpreted per rate_unit).",
                    },
                    "rate_unit": {
                        "type": "string",
                        "enum": _RATE_UNIT_ENUM,
                        "description": (
                            "Unit for the rate: 'hourly', 'daily', 'monthly', or 'fixed'. "
                            "Defaults to 'hourly' if not specified."
                        ),
                    },
                    "start_date": {
                        "type": "string",
                        "description": "Start date, in ISO format YYYY-MM-DD, if known.",
                    },
                    "notes": {
                        "type": "string",
                        "description": "Any free-form notes about the team member.",
                    },
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_team_members",
            "description": (
                "List team members (employees, freelancers, interns, contractors) in the COOS "
                "business platform, most recently created first. Use this when the user asks to "
                "see, review, or count the team, optionally filtered by type or status."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "member_type": {
                        "type": "string",
                        "enum": _MEMBER_TYPE_ENUM,
                        "description": "Optional filter: only return team members of this type.",
                    },
                    "status": {
                        "type": "string",
                        "enum": _TEAM_STATUS_ENUM,
                        "description": (
                            "Optional filter: only return team members with this status. "
                            "'active' = currently working, 'on_leave' = temporarily away, "
                            "'inactive' = no longer working here. Omit to return every status."
                        ),
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_team_member",
            "description": (
                "Fetch full details for a single team member by their ID. Use this when the "
                "user references a specific person and you need their current data before "
                "answering or before performing an update."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "member_id": {
                        "type": "string",
                        "description": "The UUID of the team member to fetch. Required.",
                    },
                },
                "required": ["member_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_team_member",
            "description": (
                "Update one or more fields on an existing team member. Only the fields the user "
                "actually wants changed should be provided — omitted fields are left untouched. "
                "Use this to change contact details, rate, role, or move someone to a new status "
                "(e.g. on leave, inactive)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "member_id": {
                        "type": "string",
                        "description": "The UUID of the team member to update. Required.",
                    },
                    "name": {
                        "type": "string",
                        "description": "New name for the team member, if it should change.",
                    },
                    "email": {
                        "type": "string",
                        "description": "New email address, if it should change.",
                    },
                    "role": {
                        "type": "string",
                        "description": "New job title/role, if it should change.",
                    },
                    "member_type": {
                        "type": "string",
                        "enum": _MEMBER_TYPE_ENUM,
                        "description": "New type: 'employee', 'freelancer', 'intern', or 'contractor', if it should change.",
                    },
                    "rate": {
                        "type": "number",
                        "description": "New pay rate, if it should change.",
                    },
                    "rate_unit": {
                        "type": "string",
                        "enum": _RATE_UNIT_ENUM,
                        "description": "New rate unit: 'hourly', 'daily', 'monthly', or 'fixed', if it should change.",
                    },
                    "status": {
                        "type": "string",
                        "enum": _TEAM_STATUS_ENUM,
                        "description": (
                            "New status: 'active', 'on_leave', or 'inactive'. Only set this when "
                            "the user explicitly wants to change the person's working status."
                        ),
                    },
                    "end_date": {
                        "type": "string",
                        "description": "End date (e.g. contract/internship end), in ISO format YYYY-MM-DD, if it should change.",
                    },
                    "notes": {
                        "type": "string",
                        "description": "Replacement notes text for the team member, if it should change.",
                    },
                },
                "required": ["member_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_team_member",
            "description": (
                "Permanently remove a team member record from the COOS business platform. Use "
                "this only when the user explicitly asks to delete or remove someone — this "
                "cannot be undone."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "member_id": {
                        "type": "string",
                        "description": "The UUID of the team member to delete. Required.",
                    },
                },
                "required": ["member_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "assign_team_member_to_project",
            "description": (
                "Assign a team member to work on a project. Requires both the project's UUID "
                "and the team member's UUID — if you only have names, first call list_projects "
                "and/or list_team_members to look up the ids before calling this."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "project_id": {
                        "type": "string",
                        "description": "The UUID of the project to assign the team member to. Required.",
                    },
                    "team_member_id": {
                        "type": "string",
                        "description": "The UUID of the team member being assigned. Required.",
                    },
                    "role_on_project": {
                        "type": "string",
                        "description": "The team member's role on this specific project, if known (may differ from their general role).",
                    },
                },
                "required": ["project_id", "team_member_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_project_team",
            "description": "See who is assigned to a given project.",
            "parameters": {
                "type": "object",
                "properties": {
                    "project_id": {
                        "type": "string",
                        "description": "The UUID of the project to list assigned team members for. Required.",
                    },
                },
                "required": ["project_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "unassign_team_member_from_project",
            "description": (
                "Remove a team member's assignment from a project. Use this when the user says "
                "someone is no longer working on, or should be taken off, a given project."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "project_id": {
                        "type": "string",
                        "description": "The UUID of the project to unassign the team member from. Required.",
                    },
                    "team_member_id": {
                        "type": "string",
                        "description": "The UUID of the team member to remove from the project. Required.",
                    },
                },
                "required": ["project_id", "team_member_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_invoice",
            "description": (
                "Create a new draft invoice for a client in the COOS business platform. Use "
                "this when the user asks to bill, invoice, or start a new invoice for a client. "
                "Requires the client's UUID — if you only have the client's name, first call "
                "list_clients to look up its id before calling this. Optionally link it to a "
                "specific project."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "client_id": {
                        "type": "string",
                        "description": "The UUID of the client being invoiced. Required.",
                    },
                    "invoice_number": {
                        "type": "string",
                        "description": "The invoice number/reference (e.g. 'INV-2026-001'). Required.",
                    },
                    "project_id": {
                        "type": "string",
                        "description": "Optional UUID of the project this invoice relates to, if known.",
                    },
                    "issue_date": {
                        "type": "string",
                        "description": "Date the invoice is issued, in ISO format YYYY-MM-DD, if known.",
                    },
                    "due_date": {
                        "type": "string",
                        "description": "Date payment is due, in ISO format YYYY-MM-DD, if known.",
                    },
                    "notes": {
                        "type": "string",
                        "description": "Any free-form notes about the invoice.",
                    },
                },
                "required": ["client_id", "invoice_number"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_invoice_line_item",
            "description": (
                "Add a billable line item (a service, product, or hours worked) to an existing "
                "invoice. Use this when the user wants to add a charge to an invoice before "
                "sending it. Requires the invoice's UUID — if you only have the invoice number, "
                "first call list_invoices to look up its id."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "invoice_id": {
                        "type": "string",
                        "description": "The UUID of the invoice to add the line item to. Required.",
                    },
                    "description": {
                        "type": "string",
                        "description": "Description of the item or service being billed. Required.",
                    },
                    "quantity": {
                        "type": "number",
                        "description": "Quantity/hours/units for this line item. Defaults to 1 if not specified.",
                    },
                    "unit_price": {
                        "type": "number",
                        "description": "Price per unit for this line item. Required.",
                    },
                },
                "required": ["invoice_id", "description", "unit_price"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_invoices",
            "description": (
                "List invoices in the COOS business platform, most recently created first. Each "
                "result includes a computed 'total' (sum of its line items). Use this when the "
                "user asks to see, review, or count invoices, optionally scoped to a specific "
                "client and/or filtered to a specific status."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "client_id": {
                        "type": "string",
                        "description": "Optional filter: only return invoices belonging to this client UUID.",
                    },
                    "status": {
                        "type": "string",
                        "enum": _INVOICE_STATUS_ENUM,
                        "description": (
                            "Optional filter: only return invoices currently in this status. "
                            "'draft' = not yet sent, 'sent' = awaiting payment, 'paid' = settled, "
                            "'overdue' = past due date, 'cancelled' = voided. Omit to return "
                            "invoices in every status."
                        ),
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_invoice",
            "description": (
                "Fetch full details for a single invoice by its ID, including its full list of "
                "line items and computed total. Use this when the user references a specific "
                "invoice and you need its current data before answering or before performing an "
                "update."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "invoice_id": {
                        "type": "string",
                        "description": "The UUID of the invoice to fetch. Required.",
                    },
                },
                "required": ["invoice_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_invoice_status",
            "description": (
                "Change the status of an existing invoice, e.g. to mark it sent, paid, overdue, "
                "or cancelled. Setting the status to 'paid' automatically stamps today's date as "
                "the paid date if one isn't already set. Use this when the user says an invoice "
                "was sent, got paid, is overdue, or should be cancelled."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "invoice_id": {
                        "type": "string",
                        "description": "The UUID of the invoice to update. Required.",
                    },
                    "status": {
                        "type": "string",
                        "enum": _INVOICE_STATUS_ENUM,
                        "description": "New status for the invoice. Required.",
                    },
                },
                "required": ["invoice_id", "status"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_invoice",
            "description": (
                "Permanently remove an invoice (and its line items) from the COOS business "
                "platform. Use this only when the user explicitly asks to delete or remove an "
                "invoice — this cannot be undone."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "invoice_id": {
                        "type": "string",
                        "description": "The UUID of the invoice to delete. Required.",
                    },
                },
                "required": ["invoice_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_expense",
            "description": (
                "Record a new business expense in the COOS business platform. Use this when the "
                "user asks to log, track, or record a cost, purchase, or outgoing payment. "
                "Optionally link it to a specific project."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "description": {
                        "type": "string",
                        "description": "Description of what the expense was for. Required.",
                    },
                    "amount": {
                        "type": "number",
                        "description": "The expense amount. Required.",
                    },
                    "project_id": {
                        "type": "string",
                        "description": "Optional UUID of the project this expense relates to, if known.",
                    },
                    "category": {
                        "type": "string",
                        "enum": _EXPENSE_CATEGORY_ENUM,
                        "description": (
                            "Category for the expense: 'software', 'contractor', 'travel', "
                            "'office', or 'other'. Defaults to 'other' if not specified."
                        ),
                    },
                    "expense_date": {
                        "type": "string",
                        "description": "Date the expense was incurred, in ISO format YYYY-MM-DD, if known.",
                    },
                    "notes": {
                        "type": "string",
                        "description": "Any free-form notes about the expense.",
                    },
                },
                "required": ["description", "amount"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_expenses",
            "description": (
                "List business expenses, most recently created first. Use this when the user "
                "asks to see, review, or total up expenses, optionally scoped to a specific "
                "project and/or filtered to a specific category."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "project_id": {
                        "type": "string",
                        "description": "Optional filter: only return expenses belonging to this project UUID.",
                    },
                    "category": {
                        "type": "string",
                        "enum": _EXPENSE_CATEGORY_ENUM,
                        "description": "Optional filter: only return expenses in this category.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_expense",
            "description": (
                "Permanently remove an expense record from the COOS business platform. Use this "
                "only when the user explicitly asks to delete or remove an expense — this cannot "
                "be undone."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "expense_id": {
                        "type": "string",
                        "description": "The UUID of the expense to delete. Required.",
                    },
                },
                "required": ["expense_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_finance_summary",
            "description": (
                "Get a rollup of invoiced/paid/outstanding amounts and total expenses, "
                "optionally scoped to one client. Use this when the user asks about revenue, "
                "cash flow, how much a client owes, or overall financial status."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "client_id": {
                        "type": "string",
                        "description": "Optional UUID to scope the summary to a single client's invoices and their projects' expenses.",
                    },
                },
                "required": [],
            },
        },
    },
]

_HANDLERS = {
    "create_client": client_service.create_client,
    "list_clients": client_service.list_clients,
    "get_client": client_service.get_client,
    "update_client": client_service.update_client,
    "delete_client": client_service.delete_client,
    "create_project": project_service.create_project,
    "list_projects": project_service.list_projects,
    "get_project": project_service.get_project,
    "update_project": project_service.update_project,
    "delete_project": project_service.delete_project,
    "create_team_member": team_service.create_team_member,
    "list_team_members": team_service.list_team_members,
    "get_team_member": team_service.get_team_member,
    "update_team_member": team_service.update_team_member,
    "delete_team_member": team_service.delete_team_member,
    "assign_team_member_to_project": team_service.assign_to_project,
    "list_project_team": team_service.list_project_assignments,
    "unassign_team_member_from_project": team_service.unassign_from_project,
    "create_invoice": finance_service.create_invoice,
    "add_invoice_line_item": finance_service.add_invoice_line_item,
    "list_invoices": finance_service.list_invoices,
    "get_invoice": finance_service.get_invoice,
    "update_invoice_status": finance_service.update_invoice_status,
    "delete_invoice": finance_service.delete_invoice,
    "create_expense": finance_service.create_expense,
    "list_expenses": finance_service.list_expenses,
    "delete_expense": finance_service.delete_expense,
    "get_finance_summary": finance_service.get_finance_summary,
}


async def execute_business_tool(name: str, arguments: dict) -> str:
    """Dispatch a tool call to the matching client_service function.

    Runs the sync DB call via asyncio.to_thread (client_service is sync).
    Never raises — returns a short human-readable error string as tool output
    instead, so the LLM can see and react to failures.
    """
    handler = _HANDLERS.get(name)
    if handler is None:
        return f"Error: unknown tool '{name}'."

    try:
        result = await asyncio.to_thread(handler, **(arguments or {}))
    except ValueError as exc:
        return f"Error: {exc}"
    except TypeError as exc:
        return f"Error: invalid arguments for '{name}': {exc}"
    except Exception as exc:
        log.warning("execute_business_tool failed", tool=name, error=str(exc))
        return f"Error: failed to execute '{name}': {exc}"

    if name in ("get_client",) and result is None:
        return json.dumps({"found": False, "message": "No client found with that ID."})
    if name == "delete_client":
        return json.dumps({"deleted": bool(result)})
    if name in ("get_project",) and result is None:
        return json.dumps({"found": False, "message": "No project found with that ID."})
    if name == "delete_project":
        return json.dumps({"deleted": bool(result)})
    if name in ("get_team_member",) and result is None:
        return json.dumps({"found": False, "message": "No team member found with that ID."})
    if name == "delete_team_member":
        return json.dumps({"deleted": bool(result)})
    if name == "unassign_team_member_from_project":
        return json.dumps({"unassigned": bool(result)})
    if name in ("get_invoice",) and result is None:
        return json.dumps({"found": False, "message": "No invoice found with that ID."})
    if name == "delete_invoice":
        return json.dumps({"deleted": bool(result)})
    if name == "delete_expense":
        return json.dumps({"deleted": bool(result)})

    return json.dumps(result, default=str)
