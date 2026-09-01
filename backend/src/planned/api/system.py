"""System-level endpoint(s) for the local desktop launcher.

Currently just a "quit the app" action: kills the frontend dev server
(by port) and then this backend process itself, so both of
scripts/start-planned.bat's windows close from a single button in the UI.

Windows-only (matches the launcher script); harmless no-op elsewhere.
This is a local single-user dev tool, not something that should exist on
a server exposed beyond localhost.
"""
import os
import signal
import subprocess
import sys
import threading

from fastapi import APIRouter

router = APIRouter()

FRONTEND_PORT = 5173
BACKEND_PORT = 8000


def _kill_process_on_port(port: int) -> None:
    """Best-effort: find and force-kill whatever is listening on `port`."""
    if sys.platform != "win32":
        return
    try:
        # Capture raw bytes rather than text=True: netstat's console output
        # is not reliably decodable as the locale's default codepage (seen:
        # UnicodeDecodeError under cp1252 on French Windows). latin-1 maps
        # every byte to a codepoint and can never raise; we only need to
        # match plain-ASCII substrings below, so any mangled bytes elsewhere
        # in the output don't matter.
        result = subprocess.run(["netstat", "-ano"], capture_output=True, check=False)
        output = (result.stdout or b"").decode("latin-1", errors="replace")
        for line in output.splitlines():
            if f":{port} " in line and "LISTENING" in line:
                pid = line.split()[-1]
                subprocess.run(["taskkill", "/F", "/PID", pid], check=False)
    except Exception:
        # Best-effort only — never let this block the os.kill() fallback.
        pass


def _shutdown() -> None:
    _kill_process_on_port(FRONTEND_PORT)
    # Fall back to signalling ourselves in case the port-based kill above
    # doesn't apply (non-Windows) or somehow misses the backend's own PID.
    _kill_process_on_port(BACKEND_PORT)
    os.kill(os.getpid(), signal.SIGTERM)


@router.post("/shutdown")
def shutdown() -> dict[str, str]:
    # Respond to the client first, then exit shortly after — the shutdown
    # kills this process, so doing it before responding would drop the
    # request instead of returning a clean acknowledgement.
    threading.Timer(0.3, _shutdown).start()
    return {"status": "shutting down"}
