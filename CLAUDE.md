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

`backend/src/planned/models.py::Task` is the single source of truth for what a task is (title, status, priority, start/due dates, duration, progress, dependency, parent, tags, timestamps). `frontend/src/types/task.ts` mirrors it by hand (camelCase, `tags` as `string[]`) — when a field is added/renamed on one side, update the other, `frontend/src/lib/api.ts`'s `fromApi`/`toApiPayload` converters, and (for a new column on an existing table) `db.py::_COLUMN_MIGRATIONS`, since `create_all()` only creates missing tables, not missing columns. Every view reads from this same shape:

- **Subtasks**: `parent_id`/`parentId` — one level, self-referential (a task with `depends_on` set is unrelated: dependency vs. hierarchy are two separate relationships, both nullable FKs to `task.id`). No separate "subtask" type/model — a task *is* a subtask purely by having a non-null `parent_id`; the one-level-deep rule is enforced by restricting what can be *picked* as a parent, not by the schema. **A task that already has a parent can never itself be picked as a parent** — enforced in both places: `TaskFormDialog`'s "Parent task" picker only lists tasks with `parentId === null`, and `api/tasks.py::_validate_parent` rejects it server-side (400) as defense in depth. (An earlier version only excluded direct children client-side, which let a subtask-of-a-subtask be created — invisible in Table, since only one level is ever rendered. Fixed; if you ever find another one, `parent_id IS NOT NULL AND parent_id IN (SELECT id FROM task WHERE parent_id IS NOT NULL)` finds it.) Visibility rule, deliberately different from `dependsOn`: a subtask is hidden **everywhere except** (a) Table, once its parent row is expanded, and (b) To-Do, where it's just a normal flat list item — the "toggle" only exists in Table. Calendar and Gantt filter to `parentId === null` and never show subtasks at all, even with dates.
- **Table** (`frontend/src/views/TableView.tsx`) — the main view: one row per task, every field exposed. This is the exhaustive view; other views only surface a subset. Create and edit both go through `components/task-form-dialog.tsx` (same form; `task` prop present = edit mode, pre-filled and `PATCH`-ing via `onEdit`; absent = create mode, `POST`-ing via `onCreate`). Also: cycling status by clicking the status badge, deleting a row, expanding a parent row (chevron, `expanded: Set<number>` state) to reveal its subtasks indented directly below.
- **To-Do** (`frontend/src/views/TodoView.tsx`) — simplified list, sortable by priority or due date (done tasks always sink to the bottom either way). The checkbox toggles status between `done` and `todo`. Renders the full unfiltered task list handed to it — no subtask filtering, which is what makes it the one view where subtasks show up unconditionally.
- **Calendar** (`frontend/src/views/CalendarView.tsx`) — FullCalendar (`@fullcalendar/react` + `daygrid`, pinned to **v6.1.21 across all three `@fullcalendar/*` packages** — `daygrid` has no stable v7 yet, mixing majors breaks the TS types), month view. Tasks place on their start–due range (or a single day, whichever date they have); tasks with neither date aren't shown. Events are colored by priority (`PRIORITY_BG_COLOR`/`PRIORITY_TEXT_COLOR` in `task-display.ts` — real CSS color strings, e.g. `var(--color-primary)`, not Tailwind classes, since that's what FullCalendar's `backgroundColor`/`textColor` event props need). Themed via `src/styles/calendar.css` overriding FullCalendar's CSS with our `--color-*` tokens.
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
- `db.py` — SQLite engine; DB file lives at `~/.planned/planned.db` (outside the repo). Dev DB, not seeded — delete the file to reset. `init_db()` also runs `_COLUMN_MIGRATIONS`, a tiny startup migration (checks `PRAGMA table_info`, runs `ALTER TABLE ... ADD COLUMN` for anything missing) — `create_all()` alone only creates missing tables, not missing columns on ones that already exist. Add a tuple there whenever a field is added to an existing model, instead of telling people to delete their DB.
- `api/tasks.py` — task CRUD: `GET /api/tasks/`, `POST /api/tasks/` (body: `TaskCreate`), `PATCH /api/tasks/{id}` (body: `TaskUpdate`, partial), `DELETE /api/tasks/{id}`. `TaskCreate`/`TaskUpdate` (in `models.py`) exclude server-owned fields (`id`, `created_at`, `updated_at`).
- `api/chat.py` — `POST /api/chat/`: prepends a system prompt (today's date + a summary of the user's current open tasks, so the model can schedule around existing deadlines/workload) and offers the model one tool, `propose_tasks`. Forwards the full message history to `llm/client.py::LocalLLMClient`. Stateless — the client resends the whole conversation every time. Wraps LLM errors (e.g. LM Studio/Ollama not running) as `HTTPException(503, ...)` with a message meant to be shown as-is to the user.
  - This endpoint **never writes to the database**. When the model calls `propose_tasks`, the response carries `proposed_tasks` (unpersisted) instead of just `content`; the frontend shows them for the user to confirm, and only then creates them via the normal `POST /api/tasks/` (one call per task, reusing `useTasks().add`) — this is the "create only after preview/confirm" behavior the user asked for, not a technical constraint of the tool-calling mechanism itself.
  - Create-only for now: the model can't update, reschedule, or delete existing tasks from chat.
  - The tool schema requires absolute `YYYY-MM-DD` dates — without an explicit instruction + today's date in the prompt, the model (tested: Gemma via LM Studio) outputs relative phrases like `"next Friday"` instead.
- `api/system.py` — `POST /api/system/shutdown`: kills the frontend dev server by port, then this process (Windows-only, local-dev-tool-only — do not expose this beyond localhost). Backing the in-app "Quit app" button. Any subprocess call that shells out to `netstat`/`taskkill` here must decode output as `latin-1`, not `text=True`'s locale-guessed default — `netstat`'s console output isn't reliably valid cp1252 (seen: a silent `UnicodeDecodeError` in a subprocess reader thread on French Windows, which an `except OSError` didn't even catch since it surfaces as `AttributeError` on the caller side).
- `llm/client.py` — thin wrapper around the `openai` SDK pointed at a local base URL (LM Studio: `http://localhost:1234/v1`, Ollama: `http://localhost:11434/v1`); works for either since both expose an OpenAI-compatible chat-completions API. The model name (`config.py::LLM_MODEL`, `"local-model"`) is a placeholder — LM Studio ignores it and serves whatever model is currently loaded, confirmed working; Ollama needs a real model name if you switch to it. `chat()` optionally takes an OpenAI-style `tools` list and surfaces the first tool call (if any) alongside the text content — confirmed working against LM Studio's default model (Gemma).
- Dev venv lives at `backend/.venv` (gitignored); use `./.venv/Scripts/python.exe` (Windows) to run commands inside it without activating.
- `uvicorn --reload` has, more than once in this environment, logged `WatchFiles detected changes ... Reloading` and then kept serving the *old* code for the next request or two — a real behavior seen while testing, not a one-off fluke. Don't trust "it reloaded" from the log alone when verifying a fix; if a request doesn't behave as the new code should, stop the process and start it fresh before concluding the code is wrong.

### Frontend

- `App.tsx` — owns the active-view state, the shared task data (via `useTasks`), and the top nav; add new views here.
- `lib/api.ts` — fetch wrapper for the task API (the only place that knows about the backend's snake_case JSON shape), plus `sendChatMessage` and `shutdownApp`.
- `views/ChatPanel.tsx` + `hooks/use-chat.ts` — the sidebar chat. Conversation lives only in React state (not persisted, resets on reload); `use-chat` resends the full history on every message since the backend is stateless. When a reply carries `proposedTasks`, `ChatPanel` renders a preview card (per message, tracked by array index in `resolvedProposals`) with Create/Discard — Create calls the `onCreateTask` prop (App.tsx passes `useTasks().add`) once per proposed task, sequentially.
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

### Daily use (Windows)

`scripts/start-planned.bat` starts both servers (each in its own window — close a window or Ctrl+C in it to stop that server) and opens the app in the browser. It force-frees ports 5173/8000 first, so it's safe to double-click again even if a previous run is still hanging around. A desktop shortcut ("Planned") points to it. Assumes `backend/.venv` and `frontend/node_modules` already exist (first-time setup still needs the manual install commands above). Runs the backend **without** `--reload` (single process — the in-app "Quit app" button relies on there being exactly one backend process to kill by port; use the `--reload` command above instead when actively developing). The "Quit app" button (in `ChatPanel.tsx`) calls `POST /api/system/shutdown` to stop both servers without touching either console window.

## Commit workflow

- Before committing, check whether this file needs updating (new architecture, convention, or command) and fold the update into the same commit.
- After every commit, give the user a short written summary of what was actually done — not just the commit hash/message.
