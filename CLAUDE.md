# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Planned is a task and project management app. Multiple views (Table, To-Do, Calendar, Gantt) share the same underlying task data, and a chat panel talks to a locally-run LLM (LM Studio or Ollama, OpenAI-compatible API) that creates and schedules tasks.

**Convention: this repository is English-only.** All code, identifiers, comments, UI text, and documentation must be written in English, even though the maintainer and Claude converse in French. Only chat responses to the user should be in French when the user writes in French.

## Architecture

Monorepo with two independent projects:

- `backend/` — FastAPI + SQLModel/SQLite (Python), package `planned` under `backend/src/planned/`.
- `frontend/` — React + TypeScript + Tailwind v4 + shadcn/ui (Vite), under `frontend/src/`.

They are not yet wired together: the frontend currently renders from `frontend/src/data/mock-tasks.ts`, not from the backend API.

### Shared data model

`backend/src/planned/models.py::Task` is the single source of truth for what a task is (title, status, priority, start/due dates, duration, progress, dependency, tags, timestamps). `frontend/src/types/task.ts` mirrors it by hand — when a field is added/renamed on one side, update the other. Every view reads from this same shape:

- **Table** (`frontend/src/views/TableView.tsx`) — the main view: one row per task, every field exposed. This is the exhaustive view; other views only surface a subset.
- **To-Do** (`frontend/src/views/TodoView.tsx`) — simplified, priority-first list (sorted by `PRIORITY_WEIGHT`, done tasks sink to the bottom).
- **Calendar** / **Gantt** — placeholders (`CalendarView.tsx`, `GanttView.tsx`), not yet implemented.

Shared display helpers (priority/status labels, badge variants, date formatting) live in `frontend/src/lib/task-display.ts` — use these rather than re-deriving labels/colors per view.

### Backend

- `main.py` — FastAPI app, CORS for the Vite dev server (`http://localhost:5173`), mounts routers, runs `init_db()` on startup.
- `db.py` — SQLite engine; DB file lives at `~/.planned/planned.db` (outside the repo).
- `api/tasks.py` — task CRUD.
- `api/chat.py` — chat endpoint, forwards messages to `llm/client.py::LocalLLMClient`.
- `llm/client.py` — thin wrapper around the `openai` SDK pointed at a local base URL (LM Studio: `http://localhost:1234/v1`, Ollama: `http://localhost:11434/v1`); works for either since both expose an OpenAI-compatible chat-completions API. Tool-calling for task creation/scheduling is not implemented yet (see TODO in that file).

### Frontend

- `App.tsx` — owns the active-view state and top nav; add new views here.
- shadcn/ui is configured for Tailwind v4 (`components.json`, no `tailwind.config.ts` — theme tokens live in `src/index.css` via `@theme inline`). Add components with `npx shadcn@latest add <name>` from `frontend/`.
- Path alias `@/*` → `frontend/src/*` (configured in both `tsconfig.json` and `vite.config.ts`).
- `vite.config.ts` proxies `/api` to `http://localhost:8000` for future backend integration.

## Commands

### Backend (run from `backend/`)

```
pip install -e .[dev]              # install with dev extras (pytest, httpx)
uvicorn planned.main:app --reload  # run the API on http://localhost:8000
pytest                             # run all tests
pytest tests/test_health.py::test_health  # run a single test
```

### Frontend (run from `frontend/`)

```
npm install
npm run dev       # Vite dev server, http://localhost:5173
npm run build     # tsc -b && vite build
npm run preview   # preview the production build
```

There is no lint tooling configured yet (the `lint` script in `package.json` references `eslint`, which isn't installed).
