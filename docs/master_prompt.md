# Sir Jazper — Master Prompt

You are an AI engineering agent working on the Sir Jazper project.

Sir Jazper is a modular AI operating system designed for:
- automation
- reasoning
- memory
- workflow orchestration
- browser control
- personal productivity
- autonomous execution

The architecture must remain:
- modular
- scalable
- maintainable
- local-first
- open-source-first

---

# Core Engineering Rules

Always prioritize:
1. clean architecture
2. modularity
3. scalability
4. maintainability
5. type safety
6. observability
7. security
8. performance

Never:
- create monolithic files
- tightly couple services
- duplicate logic
- hardcode secrets
- bypass typing systems
- introduce unnecessary abstractions

---

# Development Workflow

Always follow:

1. Understand context
2. Inspect architecture
3. Plan implementation
4. Implement incrementally
5. Validate changes
6. Refactor if needed
7. Update project_status.md

Never directly jump into coding without planning.

---

# Required Files To Read First

Always inspect:
- project_status.md
- prompts.md

before making architectural decisions.

---

# Frontend Stack

Use:
- Next.js
- React
- TailwindCSS
- Shadcn UI
- TypeScript

Frontend responsibilities:
- dashboard
- AI chat
- logs viewer
- task visualization
- memory explorer
- realtime updates

---

# Backend Stack

## Node.js Responsibilities

Use Node.js for:
- Playwright automation
- websocket communication
- realtime orchestration
- browser control
- session persistence
- event streaming

## FastAPI Responsibilities

Use FastAPI for:
- AI orchestration
- embeddings
- memory retrieval
- Whisper integration
- semantic search
- RAG pipelines

---

# AI Stack

Primary orchestration model:
- Qwen3 9B

Model providers:
- LM Studio
- Ollama
- OpenAI-compatible APIs

The model layer MUST remain swappable.

---

# Memory Architecture

Short-term memory:
- Redis

Long-term memory:
- PostgreSQL + pgvector

File memory:
- MinIO

---

# Automation Stack

Use:
- Playwright

Avoid:
- Selenium

---

# Voice Stack

Speech-to-text:
- Faster Whisper

Voice Activity Detection:
- Silero VAD

Text-to-speech:
- Piper TTS

---

# Security Rules

Never:
- store raw passwords
- expose secrets
- disable validation

Always:
- encrypt sensitive data
- isolate sessions
- validate inputs
- log important actions

---

# Coding Standards

Requirements:
- TypeScript everywhere possible
- strongly typed APIs
- reusable services
- structured logging
- proper error handling

Avoid:
- giant files
- hidden side effects
- poor naming conventions

---

# API Contracts

## POST /api/chat

Request:

{
  "message": "Hello",
  "sessionId": "123"
}

Response:

{
  "response": "Hello from Sir Jazper"
}

---

## POST /api/tasks

Request:

{
  "title": "Open LinkedIn",
  "type": "automation"
}

Response:

{
  "taskId": "task_001"
}

---

# WebSocket Events

## TASK_CREATED

{
  "taskId": "task_001"
}

## TASK_COMPLETED

{
  "taskId": "task_001",
  "status": "success"
}

---

# Database Schema

## users
- id
- email
- name
- created_at

## conversations
- id
- user_id
- title
- created_at

## messages
- id
- conversation_id
- role
- content
- created_at

## tasks
- id
- title
- status
- payload
- created_at

## memories
- id
- content
- embedding
- metadata
- created_at

---

# Tool Registry

## browser.navigate
Navigate browser to URL.

## browser.click
Click browser elements.

## browser.type
Type into browser fields.

## browser.screenshot
Capture screenshots.

## browser.upload
Upload files to websites.

## memory.store
Store long-term memory.

## memory.retrieve
Retrieve memories.

---

# UI Philosophy

The UI should feel like:
- an AI operating system
- a command center
- an execution dashboard

NOT:
- a chatbot clone

---

# Long-Term Goal

Build a self-hosted AI operating system capable of:
- memory
- automation
- execution
- orchestration
- browser control
- voice interaction
- autonomous workflows