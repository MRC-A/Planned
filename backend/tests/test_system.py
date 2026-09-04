"""CSRF hardening for POST /api/system/shutdown (S1).

The route takes no body and no custom header, which made it a CORS "simple
request": no preflight, so any site open in the user's browser while Planned
was running could fire it off with fetch(..., {mode: 'no-cors'}) and close
the app. CORS stops an attacker *reading* the response; it never stopped the
request being sent.

`_shutdown` is patched out in every test here — the real one kills whatever
is listening on ports 5173 and 8000, which during development is the
maintainer's own dev servers.
"""
import pytest
from fastapi.testclient import TestClient

from planned.api import system
from planned.main import app

UI_ORIGIN = "http://localhost:5173"
GOOD_HEADERS = {"Origin": UI_ORIGIN, "X-Planned-Client": "planned-ui"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(system, "_shutdown", lambda: None)
    with TestClient(app) as c:
        yield c


def test_a_request_from_the_app_itself_is_accepted(client):
    response = client.post("/api/system/shutdown", headers=GOOD_HEADERS)

    assert response.status_code == 200
    assert response.json() == {"status": "shutting down"}


def test_rejects_a_cross_site_origin():
    """The actual S1 attack: a page on some other site the user happens to
    have open. The browser sends Origin; the server has to look at it."""
    with TestClient(app) as c:
        response = c.post(
            "/api/system/shutdown",
            headers={"Origin": "https://evil.example", "X-Planned-Client": "planned-ui"},
        )

    assert response.status_code == 403


def test_rejects_a_request_with_no_custom_header(client):
    """Requiring a custom header is what forces a CORS preflight, which is
    what makes the browser refuse the cross-site call before it is even
    sent. Enforcing it server-side too keeps the rule testable."""
    response = client.post("/api/system/shutdown", headers={"Origin": UI_ORIGIN})

    assert response.status_code == 403


def test_allows_a_request_with_no_origin_at_all(client):
    """curl and the launcher script send no Origin. A browser always sends
    one on a cross-site request, so absence is not the attack being defended
    against here — and a local process could kill the ports directly anyway."""
    response = client.post("/api/system/shutdown", headers={"X-Planned-Client": "planned-ui"})

    assert response.status_code == 200
