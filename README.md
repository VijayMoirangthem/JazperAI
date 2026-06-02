# Sir Jazper OS

A modular AI Operating System for automation, memory, reasoning, and browser control.

## Quick Start

1. Copy environment file:
   cp .env.example .env

2. Start infrastructure:
   docker-compose up -d

3. Start frontend:
   cd frontend && npm run dev

4. Start Node.js gateway:
   cd backend/node && npm run dev

5. Start FastAPI service:
   cd backend/python && uvicorn main:app --reload

## Services

| Service    | Port |
|------------|------|
| Frontend   | 3000 |
| Node API   | 3001 |
| FastAPI    | 8000 |
| PostgreSQL | 5432 |
| Redis      | 6379 |
| MinIO      | 9000 |
| MinIO UI   | 9001 |
