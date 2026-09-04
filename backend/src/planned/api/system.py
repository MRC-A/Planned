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

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()

FRONTEND_PORT = 5173
BACKEND_PORT = 8000

# S1 — CSRF on the shutdown route.
#
# With no body and no custom header this was a CORS "simple request": no
# preflight, so any page the user happened to have open could fire
# fetch('http://localhost:8000/api/system/shutdown', {method: 'POST',
# mode: 'no-cors'}) and close the app. CORS blocks *reading* a cross-origin
# response; it never blocked sending the request.
#
# Two independent guards, both required:
#   1. A custom request header. Its presence is what makes the browser treat
#      the call as non-simple and send a preflight first, which CORSMiddleware
#      answers with our origin allowlist — so the cross-site request is
#      refused before it is ever sent. The header value is not a secret;
#      requiring it server-side as well just keeps the rule testable.
#   2. An Origin allowlist. A browser always attaches Origin to a cross-site
#      request, so this catches the same attack independently of (1).
#
# Scope, stated plainly: this closes the documented vector — a random website
# in the user's browser. It does NOT defend against a malicious process
# already running on this machine, and it cannot: such a process can kill the
# ports directly without going near this API. A startup token wouldn't change
# that either, since any local process could read it the same way the UI does.
CLIENT_HEADER = "X-Planned-Client"
ALLOWED_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}


def _reject_cross_site(request: Request) -> None:
    if CLIENT_HEADER.lower() not in (h.lower() for h in request.headers):
        raise HTTPException(status_code=403, detail=f"Missing {CLIENT_HEADER} header.")
    origin = request.headers.get("origin")
    # No Origin at all means it isn't a browser cross-site call — curl and
    # the launcher script land here, and they're already local processes.
    if origin is not None and origin not in ALLOWED_ORIGINS:
        raise HTTPException(status_code=403, detail="Cross-site shutdown requests are refused.")


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
def shutdown(request: Request) -> dict[str, str]:
    _reject_cross_site(request)
    # Respond to the client first, then exit shortly after — the shutdown
    # kills this process, so doing it before responding would drop the
    # request instead of returning a clean acknowledgement. Pass the function
    # by reference, not via a lambda: the reference is resolved now, while a
    # test's monkeypatch is still in place, whereas a lambda would look it up
    # when the timer fires — potentially after the patch is gone, killing the
    # developer's real dev servers.
    threading.Timer(0.3, _shutdown).start()
    return {"status": "shutting down"}
