# COOS AI-Native IDE — Agent Roster Specification

**Last Updated:** 2026-08-11  
**Orchestrator:** Jazper  
**Specialized Agent Fleet:** 7 Engineering Agents

---

## 1. Jazper (Chief AI Orchestrator)
- **Role:** Central entry point and task dispatcher.
- **Responsibilities:** Parses user request, creates implementation plan, delegates sub-tasks to specialized agents, monitors progress, requests human approvals, summarizes results.
- **Model:** Default high-reasoning model (e.g. `llama-3.3-70b-versatile` / `qwen3.5-9b`).

---

## 2. Software Architect Agent
- **Role:** Requirements analysis and system design.
- **Responsibilities:** Analyzes project requirements, selects technology stack, defines file structure, designs database schema and API contracts.
- **Tools:** `read_file`, `list_files`, `search_code`, `write_plan`.

---

## 3. Developer Agent (Forge)
- **Role:** Primary code implementation.
- **Responsibilities:** Writes code, applies patches, refactors existing modules, fixes bugs, creates new feature files.
- **Tools:** `read_file`, `write_file`, `apply_patch`, `search_code`, `list_files`.

---

## 4. QA Agent (Shield)
- **Role:** Automated testing and validation.
- **Responsibilities:** Executes unit/integration test suites, runs linter and typechecker, validates code fixes, flags regressions.
- **Tools:** `run_tests`, `run_typecheck`, `run_linter`, `inspect_logs`.

---

## 5. Code Review Agent (Verdict)
- **Role:** Static code review and security inspection.
- **Responsibilities:** Inspects git diffs, checks code quality standards, identifies security risks and memory leaks, enforces architectural guidelines.
- **Tools:** `git_diff`, `read_file`, `submit_review`.

---

## 6. UI/UX Agent (Pixel)
- **Role:** Frontend visual component design and styling.
- **Responsibilities:** Implements component layouts, tailwind styling, responsive design adjustments, accessibility compliance.
- **Tools:** `read_file`, `write_file`, `inspect_dom`.

---

## 7. DevOps Agent (Commander)
- **Role:** Environment management and build orchestration.
- **Responsibilities:** Manages dependencies (`npm install`, `pip install`), configures Docker environments, monitors dev server logs, handles git commits.
- **Tools:** `run_command`, `git_commit`, `git_status`, `docker_run`.

---

## 8. Research Agent (Oracle)
- **Role:** Codebase investigation and technical research.
- **Responsibilities:** Diagnoses complex error tracebacks, searches documentation, performs semantic code search, identifies dependency compatibility.
- **Tools:** `search_codebase`, `read_logs`, `read_traceback`, `web_search`.
