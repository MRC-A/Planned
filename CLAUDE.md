# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Project

Planned is a local, single-user task and project management app. Four views (Table, To-Do, Calendar, Timeline) share one task record, and a chat panel talks to a locally-run LLM (LM Studio or Ollama, OpenAI-compatible API) that proposes tasks and edits.

**This repository is English-only.** Code, identifiers, comments, UI text and docs are all in English, even though the maintainer and Claude converse in French. Only chat replies to the user are in French.

**Commit workflow.** Before committing, fold any needed update to this file into the same commit. After committing, give the user a short written summary of what was actually done — not just the hash and message.

## Architecture

Monorepo, two independent projects:

- `backend/` — FastAPI + SQLModel/SQLite, package `planned` under `backend/src/planned/`.
- `frontend/` — React + TypeScript + Tailwind v4 + shadcn/ui (Vite), under `frontend/src/`.

Wired over HTTP; no mock data anywhere.

### The task record

`backend/src/planned/models.py::Task` is the single source of truth (title, status, priority, start/due dates, duration, `depends_on`, `parent_id`, tags, timestamps). **Adding or renaming a field means touching four places:** the model, `frontend/src/types/task.ts` (hand-mirrored, camelCase, `tags` as `string[]`), `frontend/src/lib/api.ts`'s `fromApi`/`toApiPayload`, and `db.py::_COLUMN_MIGRATIONS` — `create_all()` only creates missing *tables*, never missing columns.

### Subtasks

- `parent_id` is hierarchy; `depends_on` is an unrelated dependency link. Both are nullable FKs to `task.id`.
- There is no subtask model — a task *is* a subtask by having a non-null `parent_id`. **One level deep**, enforced by restricting what can be *picked* as a parent, not by the schema.
- **Both directions are illegal:** a task that already has a parent can't be picked as one, and a task that already has children can't be given one. Enforced twice: `TaskFormDialog`'s picker only offers `parentId === null` candidates and hides itself entirely when the edited task has children; `api/tasks.py::_validate_parent` rejects both directions plus self-parenting server-side (400).
  - Two real bugs came from missing half of this: a client-only check on direct children let a subtask-of-a-subtask exist (invisible in Table, which renders one level), and later a version that validated the chosen parent but not the edited task let a `PATCH` form a 3-level chain. To find survivors: `parent_id IS NOT NULL AND parent_id IN (SELECT id FROM task WHERE parent_id IS NOT NULL)`.
- **Visibility differs per view on purpose:** hidden in Calendar entirely; shown in Table only under an expanded parent; shown in To-Do as ordinary flat items; shown in Timeline indented under their parent.
- **Deleting never leaves a dangling reference.** `DELETE /api/tasks/{id}` and bulk delete promote children to top-level (`parent_id = NULL` — losing a parent shouldn't lose the child's data) and clear `depends_on` on anything pointing at the deleted task. To repair an orphan by hand, `PATCH` its `parent_id` to `null`.

**Tests.** Backend (pytest, from `backend/`): `test_tasks.py` (CRUD, subtask integrity, delete semantics, C5 value validation), `test_db.py` (migration path), `test_chat.py` (tool-call sanitizers, S2 fencing), `test_system.py` (S1 CSRF guard), `test_limits.py` (S3/S4). Frontend (vitest, `npm test` from `frontend/`): `lib/task-dates.test.ts`, `lib/api.test.ts`, `lib/backup.test.ts`, `views/CalendarView.test.ts`, `views/TableView.test.tsx`.
  - The frontend suite is weighted toward **regressions of bugs that actually happened** rather than coverage for its own sake — C4's lost day, the self-contradicting Table filter, the converters CLAUDE.md warns must move in lockstep, and import parsing after the 35-duplicate incident. Both of those first two were mutation-checked: reintroducing C4 fails 17 tests, removing the carrier-row logic fails 3.
  - **The test timezone is pinned to Europe/Paris** in `vite.config.ts`, because C4 only reproduced ahead of UTC and passes cleanly in UTC — a suite running in UTC would assert nothing about the bug it exists to prevent. `task-dates.test.ts` asserts the offset really is negative, so a failed pin is a loud failure rather than a silent tautology.
  - No CI yet — that's F13, now unblocked.

## Views

Shared label/colour helpers live in `frontend/src/lib/task-display.ts`; **date arithmetic lives in `frontend/src/lib/task-dates.ts`**. Use them rather than re-deriving per view — the date module exists precisely because the same helpers were written twice, once per view, and C4 lived in one copy while the other had it right.

### Table (`views/TableView.tsx`)

The exhaustive view — one row per task, every field. Create and edit both go through `components/task-form-dialog.tsx` (`task` prop present = edit/`PATCH`, absent = create/`POST`). Status cycles by clicking its badge; a chevron expands a parent's subtasks (`expanded: Set<number>`).

- **Delete + bulk select.** The trash icon opens `components/delete-confirm-dialog.tsx` rather than deleting. Its prop is `Task[]`, not a single task, so one dialog serves both the per-row icon (`[task]`) and bulk delete. It *reports* that children outside the selection get promoted to top-level — it does not offer a cascade option, because none exists server-side. Row checkboxes plus a header checkbox that selects every *currently visible* row (top-level + expanded children, not every task), with Radix's `indeterminate` state.
- **One delete codepath.** Everything routes through `POST /api/tasks/bulk-delete` via `useTasks().bulkRemove`; the single-row icon just passes a one-element array. `DELETE /api/tasks/{id}` still exists and is tested server-side but has no frontend caller.
- **Sorting** (`sortTasks`) applies identically to the top-level list and to each parent's children, so expanded subtasks follow the same order. `PRIORITY_WEIGHT` (most urgent first) is deliberately separate from `STATUS_WEIGHT` (workflow order) — status isn't a scale of urgency. Undated tasks sort last.
- **Search + Status/Priority/Tag filters**, applied like sorting to both levels. The tag dropdown is built from tags actually in use and only renders once something is tagged. Filtering to status "Done" deliberately overrides the "show completed" default (`showDone = showCompleted || statusFilter === 'done'`) — an explicit filter is a stronger signal than a default. Empty states distinguish "nothing matches your filters" from "everything's hidden because it's done".
- **A matching subtask stays reachable when its parent doesn't match.** Only top-level rows are mapped, so a first version showed "1 task" in the counter and "No tasks match" in the table simultaneously. With filters on, `rootTasks` keeps a non-matching parent as a **carrier row** when a child matches, and promotes a matching subtask to a standalone row when no parent is on screen to carry it. `isRowExpanded` auto-reveals matching children, at the cost of collapsing being inert until filters clear. With filters off the row list is byte-for-byte what it always was.

### To-Do (`views/TodoView.tsx`)

Simplified list, sortable by priority or due date; the checkbox toggles `done`/`todo`. Renders the list it's handed unfiltered — the one view where subtasks always appear — apart from completed-task hiding.

### Calendar (`views/CalendarView.tsx`)

FullCalendar month view, **pinned to v6.1.21 across all three `@fullcalendar/*` packages** (`daygrid` has no stable v7; mixing majors breaks the TS types). Tasks place on their start–due range, or a single day if they have one date; undated tasks aren't shown, and neither are subtasks. Colours come from `PRIORITY_BG_COLOR`/`PRIORITY_TEXT_COLOR` — real CSS colour strings, not Tailwind classes, because that's what FullCalendar's event props take. Themed in `src/styles/calendar.css`.

- **Never round-trip a date-only value through `toISOString()`** (bug C4). `new Date(iso)` parses the API's timezone-less datetimes as *local* midnight; `.toISOString()` converts back to *UTC*, silently losing a day for anyone ahead of UTC. A task due 2026-09-30 got an exclusive `end` of `"2026-09-30"`, so — `end` being exclusive — the due date never rendered. Parse as local midnight, format back with `getFullYear`/`getMonth`/`getDate`. `start` is also fed as a bare `YYYY-MM-DD` to keep FullCalendar's own parsing out of it.
- `.fc .fc-button-primary:disabled` outspecifies `calendar.css`'s `.fc .fc-button`, so disabled buttons keep FullCalendar's default navy unless overridden explicitly.

### Timeline (`views/GanttView.tsx`, still labelled "Gantt")

Hand-rolled with CSS Grid. Two libraries were tried and dropped: `gantt-task-react` (hashed CSS-module classnames, unthemeable) and `frappe-gantt` (its SVG width measurement never produced a working horizontal scrollbar here).

**Deliberately not a strict Gantt.** The strict reading is what made it useless: plotting only top-level tasks that already had dates meant 3 rows out of 40 on the real backlog. Three rules relaxed on purpose:

1. Subtasks get rows, indented under their parent.
2. A parent with no dates of its own draws a thin **rollup** bar spanning its dated children — visually distinct, and not draggable, since it has no dates to move.
3. Undated tasks aren't dropped to a footnote; they sit in a **tray** under the chart.

- **Drag to schedule/reschedule** (the timeline half of F7): tray pill onto a day sets start = due = that day; a bar drags to move (span preserved); either edge drags to resize. Each gesture registers `pointermove`/`pointerup` on `window` and tears them down on the `pointerup` that ends it, so the pointer can leave the bar mid-drag. `draggedRef` suppresses the click that ends a drag so it doesn't also open the detail dialog. Releasing anywhere but over the chart cancels.
- **Rows build in two passes** — parents with their scheduled children, then any scheduled child whose parent isn't on the chart at all promoted to its own row. **A collapsed parent's children must still be marked seen in the first pass**, or the promotion pass re-adds them as top-level rows and collapsing appears to do nothing.
- Bars are positioned at day granularity at every zoom; Day/Week/Month only changes how the header and dividers are *grouped* (`buildGroups`). Dividers and weekend shading are **one background layer spanning all rows**, not a cell per group per row — the latter was thousands of divs once subtasks got rows.
- The chart is its own scroll container on **both** axes, so the date header stays put (`sticky top-0`) and the task-name column too (`sticky left-0`). The month label is itself sticky, with its clipping on the inner `span` (`max-w-full truncate`) rather than the cell: **an ancestor with `overflow-hidden` cancels a descendant's `sticky` outright.**
- **`App.tsx`'s `<main>` needs `min-w-0`.** As a flex item it defaults to `min-width: auto`, letting a wide child stretch it past the viewport so the child's own `overflow-auto` never clips and the whole *page* scrolls sideways. Applies to any wide child, not just this view.
- No `onWheel` → `scrollLeft` remap: it existed when the chart had no vertical overflow, which stopped being true once every subtask could have a row. Horizontal movement is the scrollbar, shift+wheel, or trackpad deltaX.
- "Today" scrolls the chart (not the page) to centre on today; it also auto-centres on first layout and zoom change, but deliberately **not** after a date edit, which would yank the view back after every drag.
- No dependency arrows yet.
- API dates are full datetimes — `parseDate` slices to 10 chars first (forgetting that once produced silent `Invalid Date`s and a blank chart). Writes go through `formatISODate`, local getters only (the C4 trap above).

### Behaviours shared by every view

- **Task detail dialog** (`components/task-detail-dialog.tsx`) — clicking a task anywhere opens a read-only summary centred on the description, which no view shows in full. Controlled (`task`/`open`/`onOpenChange`) rather than trigger-wrapped like `TaskFormDialog`, because each view's trigger is a different kind of element; each view holds its own `detailTask` state. Views with per-row controls need `stopPropagation` on them (chevron, status badge, edit/delete, checkbox) so those don't also open the summary.
- **Completed tasks** are hidden by default everywhere, each view remembering its own preference — `hooks/use-show-completed.ts` persists to `localStorage` under `planned:showCompleted:{view}`, in try/catch since storage can throw. The control is `components/show-completed-toggle.tsx`, rendered identically in all four views for recognizability even though state isn't shared. Filtering is client-side on the fetched list. Table filters both levels so a done subtask doesn't linger under an expanded parent. **Every view shows an explanatory message rather than a silent empty state** when its only content is hidden-because-done — an unexplained empty view looks broken. Once revealed, done items get a green tint (`--done`/`--done-foreground`; Tailwind `bg-done` in Table/To-Do/Timeline, `DONE_BG_COLOR`/`DONE_TEXT_COLOR` strings in Calendar).
- **Light/dark theme** — `hooks/use-theme.ts` + `components/theme-toggle.tsx`, one nav button cycling System → Light → Dark. Same hook/presentational split as `useShowCompleted`, but the preference is global rather than per-view (`localStorage` key `planned:theme`). "System" keeps following the OS live via a `matchMedia` change listener.
  - Applied by toggling `dark` on `<html>`, which is what `index.css`'s `@custom-variant dark` and `.dark` token block key off. Because every colour resolves through a `--color-*` token — including `task-display.ts`'s CSS colour strings and `calendar.css`'s overrides — **no view needs per-component dark styling.**
  - `index.html` runs the same resolution inline **before first paint** to avoid a flash of light. It necessarily duplicates the storage key and the follow-the-OS fallback; keep the two in sync.
  - `:root`/`.dark` set `color-scheme` so scrollbars and native controls follow.
  - **Palette rule for both themes:** surface chroma in the 0.010–0.034 band, and a visible `--background` ↔ `--card` lightness gap (~0.02 light, ~0.04 dark). The light side originally sat at 0.006–0.025 chroma with a 0.010 gap, which read as flat white and melted nav, content and sidebar into one sheet. Lowest contrast pair after re-tuning is `muted-foreground` on `muted` at 5.44 (light) / 4.82 (dark); the rest clear AAA.
  - **Measuring contrast: `getComputedStyle` returns the `oklch()` string untouched**, so parsing its three numbers as RGB reports ~1.0 for every pair. Rasterize each token through a canvas to get real sRGB.

### Backup (`components/backup-controls.tsx`)

Global, in the top nav. Export builds `planned-backup-<date>.json` client-side from the already-fetched list (no endpoint needed). Import creates in two passes — every row flat first, collecting old id → new id, then `PATCH`ing `parentId`/`dependsOn` back in — dropping references to ids absent from the file. A `window.confirm` gates it; one `refresh()` at the end.

- **Each row's call is individually try/caught, not the batch.** With a single outer try/catch, an import that raced a backend restart threw on the first failure and left 35 already-created rows behind as flat unlinked duplicates, silently, under a generic "failed" message. Failures are now collected per row and reported as `Imported X/N` plus which rows failed.
- The other half of F2 is `db.py::_backup_db`: copies the DB to `~/.planned/backups/planned-<UTC timestamp>.db` once per backend startup, before migrations touch it, keeping the last `BACKUP_RETENTION` (10). No scheduler — this is a local app restarted often.

### State ownership

`App.tsx` makes the single `useTasks()` call and passes `tasks`/`loading`/`error` plus `add`/`edit`/`bulkRemove`/`refresh` down as props; views never fetch. `ChatPanel` also gets `tasks` (it needs live values to diff a proposed update against) and `edit` as `onUpdateTask`. `use-tasks` refetches the whole list after every mutation rather than updating optimistically — fine while the list is small and local.

## Backend

- `main.py` — FastAPI app, CORS for `http://localhost:5173`, mounts routers, `init_db()` on startup.
- `db.py` — SQLite at `~/.planned/planned.db`, outside the repo. Dev DB, not seeded; delete the file to reset.
  - `_COLUMN_MIGRATIONS` gained `("task", "recurrence", "TEXT")` for F6 — same ADD-COLUMN path as `parent_id`, no new mechanism.
  - **Foreign keys are enforced explicitly (C5).** SQLite defaults the `foreign_keys` pragma to OFF, *per connection*, so the FKs on `parent_id` and `depends_on` were declared and never applied — a real dangling row was found in the live database. A `connect` listener turns the pragma on, registered on the `Engine` class rather than this one engine so the test engines get it too: a guard the tests don't exercise is one you find out about in production.
  - `_COLUMN_MIGRATIONS` (`ADD COLUMN`) needs a new tuple whenever a field is *added* to an existing model. `_COLUMN_DROPS` (`DROP COLUMN`, SQLite ≥3.35) is the symmetric case for a field *removed*, **and it isn't optional**: when `progress` was dropped from `Task`, existing DBs kept a `NOT NULL` column with no default and every `INSERT` 500'd, while a brand-new DB was fine. **`test_tasks.py`'s fixture builds its schema straight from the current model, bypassing `init_db()`'s migration path — pytest passing proves nothing here.** Exercise a real pre-existing DB.
- `api/tasks.py` — value validation on write (C5): `duration_hours` is `ge=0` (a task took `-5`), `_validate_depends_on` mirrors `_validate_parent` for the other nullable FK (`depends_on: 999999` used to return 200 and store a reference to nothing), and `_validate_dates` rejects a due date before the start date — on `PATCH` against the dates the task will *end up* with, not just those in the payload. Cycle detection on `depends_on` is deliberately still absent: that's C6, and it needs a graph walk rather than a lookup.
  - **Recurring tasks (F6).** `Task.recurrence: Optional[RecurrenceRule]` — `daily`/`weekly`/`monthly`, nothing fancier (no custom intervals, no end date or occurrence count; same "don't add scope this app doesn't need" call as the `progress` removal). **Not tracked as a rule plus generated instances** — completing a recurring task (a `PATCH` transitioning `status` from not-done to done, captured as `was_done` *before* the update loop applies) calls `_spawn_next_occurrence`, which creates one new `todo` task with every date shifted forward by `_shift_by_recurrence` and everything else copied: same title/description/priority/duration/tags/`parent_id`. The check runs against the dates the task ends up with post-update, so completing and rescheduling in the same `PATCH` spawns from the new dates.
    - A no-op without at least one date — recurrence is a schedule, and there's nothing to shift from; spawning an undated duplicate on every completion would be clutter, not a schedule.
    - `depends_on` is **not** carried onto the clone: it names a specific instance, almost certainly the one just completed, and carrying it forward would create a task depending on something already done. `parent_id` **is** carried over — the new occurrence is a sibling under the same parent. Subtasks of a recurring parent are **not** cloned; the new occurrence is a childless shell. Both are stated limitations, not oversights.
    - Monthly clamps day-of-month to whatever the target month has (`Jan 31` → `Feb 28`, or `29` in a leap year) via `min(day, calendar.monthrange(...))`, which is monotonic non-decreasing — that's what guarantees a shifted `due >= start` still holds when the source pair did, reasoned through in `_shift_by_recurrence`'s docstring. `_validate_dates` still re-checks the clone before it's added anyway (belt and suspenders, C5's habit): reasoning about an invariant is cheap to verify, not a reason to skip verifying it.
    - Not exposed to the chat assistant — `propose_tasks`/`propose_task_updates` don't mention `recurrence` at all. Deliberately out of scope for this pass, not a gap found and left; revisit if the assistant creating recurring tasks turns out to matter.
  - `_detach_references` no longer skips rows that are themselves being deleted. That skip was a harmless optimisation until foreign keys started being enforced — SQLAlchemy has no declared relationship here to order deletes by, so deleting a parent before its child in one batch would trip the constraint. Clearing every reference and flushing first removes the ordering question.
  - Endpoints: `GET /api/tasks/`, `POST /api/tasks/`, `PATCH /api/tasks/{id}` (partial), `DELETE /api/tasks/{id}`, `POST /api/tasks/bulk-delete` (`{"ids": [...]}` → `{"deleted": [...]}`, unknown ids dropped rather than failing the request). `TaskCreate`/`TaskUpdate` exclude server-owned fields. Single and bulk delete share `_detach_references(session, ids, keep_ids)`; `keep_ids` is the set also being deleted, so bulk-deleting a parent with its child doesn't try to promote a child that's going away too.
- `api/system.py` — `POST /api/system/shutdown` kills the frontend dev server by port then itself. Windows-only, local-dev-only; **do not expose beyond localhost.**
  - **CSRF-guarded (S1).** With no body and no custom header this was a CORS "simple request" — no preflight — so any site open in the user's browser could POST it and close the app; CORS blocks *reading* a cross-origin response, never sending the request. Two guards, both required: a custom `X-Planned-Client` header (its presence is what makes the browser preflight, which the origin allowlist then refuses) and an `Origin` allowlist (a browser always sends `Origin` cross-site). A request with **no** `Origin` is allowed — that's curl or the launcher, not a browser. **Scope, stated plainly:** this closes the browser vector and nothing else. A malicious local process can kill the ports directly without touching this API, and a startup token wouldn't change that, since any local process could read it exactly the way the UI does. `lib/api.ts::shutdownApp` sends the header.
  - Tests monkeypatch `_shutdown` — the real one kills whatever holds ports 5173 and 8000, i.e. the maintainer's own dev servers. Pass the function to `threading.Timer` **by reference, not via a lambda**: a lambda resolves it when the timer fires, possibly after the patch is gone. Any `netstat`/`taskkill` subprocess here must decode as `latin-1`, not `text=True`'s locale guess — its output isn't reliably valid cp1252, and the failure surfaces as an `AttributeError` on the caller side that an `except OSError` won't catch.
- `llm/client.py` — thin `openai` SDK wrapper against a local base URL (LM Studio `:1234/v1`, Ollama `:11434/v1`); either works, both being OpenAI-compatible. `LLM_MODEL` (`"local-model"`) is a placeholder LM Studio ignores, serving whatever is loaded; Ollama needs a real name. `chat()` surfaces only the **first** tool call.
  - `timeout`/`max_retries` are set explicitly (`config.py`: 120s, 1 retry). The SDK defaults — 600s and 2 retries — let a wedged local server hold one request for ~30 minutes.

### `api/chat.py`

`POST /api/chat/` prepends a system prompt (today's date and weekday, plus a summary of open tasks so the model can schedule around real workload) and offers two tools: `propose_tasks` and `propose_task_updates` (F5). Stateless — the client resends the whole conversation each time. LLM errors become **503** when the server is unreachable and **504** on `APITimeoutError`, kept distinct because "is LM Studio running?" misdirects when it *is* running and merely slow. The 503 body is deliberately generic and the exception is logged instead (S4) — it used to be interpolated into the response, leaking the configured base URL and port.

Bounds (S3): `MAX_CHAT_MESSAGES` (100) and `MAX_MESSAGE_CHARS` (20 000) cap the history, which is resent whole on every message and forwarded verbatim to the model. `ChatMessage.role` is a `Literal["user", "assistant"]`, so a caller can't slip in a system-role message of its own. Task text is capped in `models.py` (`MAX_TITLE_LEN`/`MAX_DESCRIPTION_LEN`/`MAX_TAGS_LEN`) on `TaskCreate`/`TaskUpdate` rather than on `Task`: a `table=True` SQLModel skips validation and SQLite ignores `VARCHAR` lengths, so a constraint there would be decorative.

- **Task text is data, never instruction (S2).** Titles, descriptions and tags are free text the user typed, pasted or imported, and they are shown to the model on every request. They are therefore *not* in the system prompt — that role is where a model looks for operator instructions. `_tasks_context_message` puts the snapshot in a **user**-role message fenced between `<current_tasks>` and `</current_tasks>`, and the system prompt states that everything inside is data and must never be acted on however it is phrased. `_strip_delimiters` removes those tags from task text, since a fence whose contents can write the closing tag is no fence at all. This is defence in depth, not a proof: the actual security boundary remains the propose-confirm step below.
- **This endpoint never writes to the database.** A tool call returns `proposed_tasks`/`proposed_updates` unpersisted; the frontend shows them and only the user's confirmation applies them via the normal `POST`/`PATCH`. **This confirmation step, not the model's judgment, is the security boundary** — it's what made F5 safe to build before S2 landed, and it remains the real defence now that S2's fencing is in place above.
- **Field coercion at the tool-call boundary.** Tool-call arguments are the one place free-form model output becomes an API payload, so anything a later `POST`/`PATCH` would reject is caught here rather than reaching the user as a raw 422 about a request they never knowingly made. Shared coercers (`_coerce_text`/`_coerce_date`/`_coerce_number`/`_coerce_tags`/`_coerce_priority`/`_coerce_status`) return `(usable, normalized)`. **What "unusable" means differs by tool, and that difference is load-bearing:**
  - `propose_tasks` falls back to the field's default (`ProposedTask`'s `field_validator(mode="before")` hooks) — one bad field costs that field, not the task.
  - `propose_task_updates` omits the key entirely, because there an explicit `null` is a real "clear this field" instruction, so defaulting would itself *become* an edit.
  - Caught this way, each reproduced first: relative dates (`"next Friday"`) and impossible ones (`2026-13-45`); a priority outside the enum (`propose_tasks` had no enum guard at all); `tags: null`, worse than a 422 because `ChatPanel`'s `diffLines` calls `u.tags.join()` and threw while *rendering*; and `title: null`, which would have reached `setattr` in the `PATCH` handler and blanked the stored title. Full datetimes are narrowed to their date part rather than dropped.
- **`propose_task_updates` (F5)** takes `{task_id, ...only changed fields}`. `_existing_tasks_summary` prefixes each open task with `[id N]` so the model has real ids. `_build_proposed_updates` drops any update whose `task_id` isn't in the currently-open set queried for that same request — a hallucinated, done, or deleted id is dropped rather than trusted, since these ids come from the model reading free-form context. `ChatResponse.proposed_updates` is a loose `list[dict]` on purpose: a fixed-field Pydantic model would serialize every field as `null`, collapsing "leave it alone" into "clear it". `ChatPanel` renders each as one `field: before → after` line per change, reading the *live* current value so the diff is real, and skips (not errors on) targets deleted since the reply.
- **`propose_tasks` subtasks** carry `parent_ref` — a 0-based index into the *same* batch, since no real ids exist yet. `_sanitize_parent_refs` drops refs that are out of range, self-referential, or point at another subtask (the one-level rule), degrading to top-level rather than corrupting the batch. **`_validated_tasks` must remap every `parent_ref` before that check runs:** dropping an untitled task renumbers the array the refs index into, and `[invalid, "Design", "Build", subtask(parent_ref=1)]` silently attached the subtask to `"Build"`. A ref whose parent was itself dropped resolves to `None`.
- A malformed tool call (seen live: a missing `title`) once 500'd the whole request. `_validated_tasks` drops just that task, falling back to plain `content` only if every task was malformed.
- **The system prompt is tuned, not casual prose — re-test against LM Studio if you change it.** Baseline testing across 6 varied prompts had the model leaving `description` empty and `duration_hours` null on 16/16 tasks, inventing inconsistent tag casing, miscomputing weekdays, and outright refusing a mundane personal task ("acheter du pain") after anchoring on the software-heavy examples in context. The prompt now spells out what each field means and requires, states today's weekday by name, says explicitly that Planned tracks any kind of task and short ones are never refused, and names de-escalating cues (`"pas urgent"`) so priority isn't a one-way ratchet. `_existing_tasks_summary` also surfaces tags already in use as a style reference. All fixed on re-test; some run-to-run variance remains and prompt wording won't remove it.
- The model uses `parent_ref` correctly when the user is explicit ("create X with subtasks Y and Z") but won't reliably structure a multi-step request that way on its own — a model-capability gap, not a mechanism bug.
- Frontend side: `ChatPanel.handleCreateProposed` creates in two passes (top-level first, collecting real ids, then subtasks). `toDraft()` builds a clean `TaskDraft` rather than spreading, since `ProposedTask` carries `parentRef`, which isn't a `TaskDraft` field.

## Frontend notes

- `App.tsx` owns the active view and the top nav; add new views there.
- `lib/api.ts` is the only place that knows the backend's snake_case shape.
- `views/ChatPanel.tsx` + `hooks/use-chat.ts` — conversation lives in React state only (resets on reload) and the full history is resent every message. Proposal cards are tracked per message by array index in `resolvedProposals`. `use-chat` holds an `AbortController`; the Stop button beside "Thinking…" aborts the in-flight fetch, treated as a deliberate action rather than an error, keeping the user's message so it can be resent without retyping.
- shadcn/ui on Tailwind v4 — no `tailwind.config.ts`; tokens live in `src/index.css` via `@theme inline`. Add components with `npx shadcn@latest add <name>` from `frontend/`.
- Path alias `@/*` → `frontend/src/*`, set in both `tsconfig.json` and `vite.config.ts`. `vite.config.ts` proxies `/api` to `http://localhost:8000`.

## Dev-server gotchas

Both of these have wasted real debugging time. When something behaves as though your change didn't land, suspect them **before** suspecting the code.

- **Vite serves stale modules.** After a long session of many edits or branch switches, the dev server can keep serving an *older* version of a file with no error — a rebuilt view silently not appearing, or a `TypeError` from code that no longer exists. Confirm by fetching the module directly (`curl http://localhost:5173/src/path/File.tsx`) and looking for constants you know changed. Restart `npm run dev`; it has never been a code bug.
- **`uvicorn --reload` serves stale code too**, having logged `WatchFiles detected changes ... Reloading` and then answered the next request or two from the old module. Don't trust the log; stop and restart the process before concluding the code is wrong.

## Commands

Backend, from `backend/` (venv at `backend/.venv`, gitignored — use `./.venv/Scripts/python.exe` to run without activating):

```
pip install -e .[dev]              # dev extras: pytest, httpx
uvicorn planned.main:app --reload  # http://localhost:8000
pytest
pytest tests/test_health.py::test_health
```

Frontend, from `frontend/`:

```
npm install
npm run dev       # http://localhost:5173
npm run build     # tsc -b && vite build
npm run preview
```

No lint tooling is configured — `package.json`'s `lint` script references an uninstalled eslint (C15). Both servers must run: backend on 8000, frontend on 5173.

**Frontend tests.** `npm test` (vitest, one pass) or `npm run test:watch`.

**Dependency audit (S5).** `npm run audit` in `frontend/`, `python -m pip_audit` in `backend/` (pip-audit ships in the dev extras). `.github/dependabot.yml` watches npm, pip and GitHub Actions weekly, with build tooling grouped into one PR — Vite, its React and Tailwind plugins move as a set, and separate PRs would each fail peer resolution alone. The audit is what caught the Vite 5 dev-server advisories that prompted the move to Vite 7; `shadcn` is a CLI and belongs in `devDependencies`, not runtime. Still outstanding: `radix-ui` as a meta-package pulls in every primitive rather than the handful actually used (C16).

### Daily use (Windows)

`scripts/start-planned.bat` starts both servers in their own windows and opens the browser, force-freeing ports 5173/8000 first so it's safe to re-run. A desktop shortcut points to it. It assumes `backend/.venv` and `frontend/node_modules` exist. It runs the backend **without** `--reload`, because the in-app "Quit app" button (`POST /api/system/shutdown`, in `ChatPanel.tsx`) relies on there being exactly one backend process to kill by port — use the `--reload` command above when actively developing.
