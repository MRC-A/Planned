# Planned

Planned is a task and project management app built around one shared set of tasks, viewed through a Table, a To-Do list, a Calendar, and a Gantt chart. A built-in assistant, powered by a local LLM (LM Studio or Ollama), can turn what you tell it into tasks — including breaking a project into subtasks — for you to review before anything is created.

## Features

- **Table** — the exhaustive view: every field, inline status/priority, create/edit/delete (delete asks for confirmation first), expandable subtasks, sortable by priority, start date, due date, or status, with a search box and status/priority/tag filters to cut down a long list.
- **To-Do** — a simplified list, sortable by priority or due date.
- **Calendar** — month view, tasks colored by priority.
- **Gantt** — Day/Week/Month zoom, priority-colored bars.
- **Subtasks** — one level deep, hidden by default except in Table (expand a task to see them) and To-Do (always visible).
- **Completed tasks** — hidden by default in every view, with a "Show completed" toggle (remembered per view) to bring them back; once visible, they get a light green highlight so they stand out at a glance.
- **Local LLM assistant** — chat sidebar that proposes tasks (and subtasks) for you to review before anything is created; scheduling accounts for your existing tasks and deadlines. Runs entirely against a model on your machine — no cloud dependency.
- **Backup** — Export/Import buttons (top nav) to move your tasks in and out as a JSON file; the backend also copies the database on every startup, keeping the last 10 automatic backups, so a bad edit or a bug isn't the end of your data.

## Getting started

The chat assistant needs LM Studio or Ollama running locally with a model loaded; the rest of the app works without it.

**First-time setup:**

```
cd backend && pip install -e .[dev]
cd frontend && npm install
```

**Daily use (Windows):** double-click the "Planned" desktop shortcut, or run `scripts/start-planned.bat` — it starts both servers and opens the app in your browser. Use the in-app "Quit app" button when you're done.

**Manual / development:**

```
cd backend && uvicorn planned.main:app --reload   # http://localhost:8000
cd frontend && npm run dev                         # http://localhost:5173
```

See `CLAUDE.md` for architecture details.
