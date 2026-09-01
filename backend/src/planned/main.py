"""Planned API — FastAPI entry point.

Serves task data to the React frontend and exposes the chat endpoint that
lets the local LLM create and schedule tasks.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from planned.api import chat, system, tasks
from planned.db import init_db

app = FastAPI(title="Planned API")

# Allow the Vite dev server to call the API during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tasks.router, prefix="/api/tasks", tags=["tasks"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(system.router, prefix="/api/system", tags=["system"])


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
