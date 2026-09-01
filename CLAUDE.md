# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Planned is a task and project management app. Multiple views (Table, To-Do, Calendar, Gantt) share the same underlying task data, and a chat panel talks to a locally-run LLM (LM Studio or Ollama, OpenAI-compatible API) that creates and schedules tasks.

**Convention: this repository is English-only.** All code, identifiers, comments, UI text, and documentation must be written in English, even though the maintainer and Claude converse in French. Only chat responses to the user should be in French when the user writes in French.

## Architecture

Monorepo with two independent projects:

- `backend/` — FastAPI + SQLModel/SQLite (Python), package `planned` under `backend/src/planned/`.
- `frontend/` — React + TypeScript + Tailwind v4 + shadcn/ui (Vite), under `frontend/src/`.

The frontend is wired to the backend over HTTP (see below) — there is no more mock data.

### Shared data model

`backend/src/planned/models.py::Task` is the single source of truth for what a task is (title, status, priority, start/due dates, duration, progress, dependency, tags, timestamps). `frontend/src/types/task.ts` mirrors it by hand (camelCase, `tags` as `string[]`) — when a field is added/renamed on one side, update the other and `frontend/src/lib/api.ts`'s `fromApi`/`toApiPayload` converters. Every view reads from this same shape:

- **Table** (`frontend/src/views/TableView.tsx`) — the main view: one row per task, every field exposed. This is the exhaustive view; other views only surface a subset. Supports creating a task with every field (`NewTaskDialog`), cycling status by clicking the status badge, and deleting a row.
- **To-Do** (`frontend/src/views/TodoView.tsx`) — simplified list, sortable by priority or due date (done tasks always sink to the bottom either way). The checkbox toggles status between `done` and `todo`.
- **Calendar** (`frontend/src/views/CalendarView.tsx`) — FullCalendar (`@fullcalendar/react` + `daygrid`, pinned to **v6.1.21 across all three `@fullcalendar/*` packages** — `daygrid` has no stable v7 yet, mixing majors breaks the TS types), month view. Tasks place on their start–due range (or a single day, whichever date they have); tasks with neither date aren't shown. Themed via `src/styles/calendar.css` overriding FullCalendar's CSS with our `--color-*` tokens.
- **Gantt** (`frontend/src/views/GanttView.tsx`) — hand-rolled with CSS Grid, no external Gantt library. Two libraries were tried and dropped: `gantt-task-react` (hashed CSS-module classnames, couldn't be themed) and `frappe-gantt` (its internal SVG-width-measurement logic never produced a working horizontal scrollbar in this app's layout, and it wasn't worth debugging blind without browser access). The hand-rolled version gives full control over layout and the sticky task-name column (`position: sticky; left: 0`, one level deep — the nested-sticky-inside-a-sticky-parent pattern is what broke frappe-gantt's own header).
  - Bars are always positioned at day granularity (accurate at any zoom); Day/Week/Month zoom only changes how the header and divider lines are *grouped* (`buildGroups`) — one column per day/week/month — so it doesn't turn into illegible 4px-wide day cells when zoomed out.
  - A plain mouse wheel only produces vertical delta and this widget has no vertical overflow, so wheel is remapped to horizontal scroll (`onWheel` → `scrollLeft`) — without this, wheel/trackpad users have no way to move through the timeline.
  - A "Today" button scrolls the chart itself (not the page) to center on today.
  - No dependency arrows yet. Same date-availability rule as Calendar: undated tasks aren't shown.
  - Dates from the API are full datetimes (`"2026-09-30T00:00:00"`), not bare dates — `parseDate` takes `iso.slice(0, 10)` before parsing; forgetting that once already produced silent `Invalid Date`s and a blank chart.

Shared display helpers (priority/status labels, badge variants, date formatting) live in `frontend/src/lib/task-display.ts` — use these rather than re-deriving labels/colors per view.

`App.tsx` owns the single `useTasks()` call (`frontend/src/hooks/use-tasks.ts`) and passes `tasks`/`loading`/`error` plus `add`/`edit`/`remove` callbacks down to the views as props — views themselves don't fetch. `use-tasks` refetches the full list after every mutation rather than updating state optimistically; fine while the list is small and local.

### Backend

- `main.py` — FastAPI app, CORS for the Vite dev server (`http://localhost:5173`), mounts routers, runs `init_db()` on startup.
- `db.py` — SQLite engine; DB file lives at `~/.planned/planned.db` (outside the repo). Dev DB, not seeded — delete the file to reset.
- `api/tasks.py` — task CRUD: `GET /api/tasks/`, `POST /api/tasks/` (body: `TaskCreate`), `PATCH /api/tasks/{id}` (body: `TaskUpdate`, partial), `DELETE /api/tasks/{id}`. `TaskCreate`/`TaskUpdate` (in `models.py`) exclude server-owned fields (`id`, `created_at`, `updated_at`).
- `api/chat.py` — chat endpoint, forwards messages to `llm/client.py::LocalLLMClient`.
- `llm/client.py` — thin wrapper around the `openai` SDK pointed at a local base URL (LM Studio: `http://localhost:1234/v1`, Ollama: `http://localhost:11434/v1`); works for either since both expose an OpenAI-compatible chat-completions API. Tool-calling for task creation/scheduling is not implemented yet (see TODO in that file).
- Dev venv lives at `backend/.venv` (gitignored); use `./.venv/Scripts/python.exe` (Windows) to run commands inside it without activating.

### Frontend

- `App.tsx` — owns the active-view state, the shared task data (via `useTasks`), and the top nav; add new views here.
- `lib/api.ts` — fetch wrapper for the task API; the only place that knows about the backend's snake_case JSON shape.
- shadcn/ui is configured for Tailwind v4 (`components.json`, no `tailwind.config.ts` — theme tokens live in `src/index.css` via `@theme inline`). Add components with `npx shadcn@latest add <name>` from `frontend/`.
- Path alias `@/*` → `frontend/src/*` (configured in both `tsconfig.json` and `vite.config.ts`).
- `vite.config.ts` proxies `/api` to `http://localhost:8000` — run the backend on port 8000 for the frontend dev server to reach it.

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

Run both servers to use the app: the backend on port 8000, the frontend dev server on 5173 (proxies `/api` to the backend).

## Commit workflow

- Before committing, check whether this file needs updating (new architecture, convention, or command) and fold the update into the same commit.
- After every commit, give the user a short written summary of what was actually done — not just the commit hash/message.
