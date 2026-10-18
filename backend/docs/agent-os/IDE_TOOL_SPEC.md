# COOS AI-Native IDE — Tool Specification

**Last Updated:** 2026-08-11  
**Execution Engine:** FastAPI + Controlled Service Runners

---

## 1. File Tools

### `read_file(path: str) -> dict`
- **Description:** Read file content from project workspace.
- **Security:** Relative path checked against `_safe_resolve()`. Max 1 MB limit.

### `write_file(path: str, content: str) -> dict`
- **Description:** Create or overwrite a file.
- **Security:** Blocked for `.env` files. Triggers `_log_evolution()` audit.

### `apply_patch(path: str, old_string: str, new_string: str) -> dict`
- **Description:** Perform targeted string replacement on a file.
- **Conflict Check:** Fails if `old_string` is missing or ambiguous.

### `list_files(path: str = "") -> dict`
- **Description:** List files and subdirectories with filtering for ignored patterns (`node_modules`, `.git`).

---

## 2. Code Search Tools

### `search_code(query: str, is_regex: bool = False) -> list`
- **Description:** Fast codebase keyword search using ripgrep (`rg`).

### `semantic_search(query: str, top_k: int = 5) -> list`
- **Description:** Cosine similarity vector search over `semantic_memories` / code embeddings using pgvector.

---

## 3. Execution Tools

### `run_command(command: str, timeout: int = 30) -> dict`
- **Description:** Execute shell command inside workspace directory.
- **Return Contract:** `{"ok": bool, "exit_code": int, "stdout": str, "stderr": str, "duration_ms": int}`.
- **Blacklist:** `rm -rf`, `format`, `shutdown`, `reboot`, `fork bomb`.

---

## 4. Git Tools

### `git_status() -> str`
- **Description:** Get short git working tree status (`git status --short`).

### `git_diff() -> str`
- **Description:** Get unstaged and staged diff output.

### `git_commit(message: str, files: list = None) -> dict`
- **Description:** Stage files and create a commit.

---

## 5. Browser Automation Tools (Playwright)

### `open_browser_preview(url: str) -> dict`
- **Description:** Launch or attach headless browser to local dev server.

### `inspect_dom(selector: str) -> dict`
- **Description:** Query elements, attributes, and text contents in the active browser page.

### `capture_browser_screenshot(filename: str) -> str`
- **Description:** Take screenshot of browser preview for visual inspection.
