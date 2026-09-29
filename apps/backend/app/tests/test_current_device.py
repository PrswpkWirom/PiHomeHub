import json
from types import SimpleNamespace

import pytest
from fastapi import Request
from httpx import ASGITransport

from app.models.tailscale_device import TailscaleDevice
from app.services import current_device_service as service
from app.tests.conftest import AsyncClient


def device(identity="a", ips=None, lan=None, sync="active"):
    return TailscaleDevice(
        tailscale_id=identity, machine_name="same-name", tailscale_ips=json.dumps(ips or []),
        lan_ip_address=lan, sync_status=sync,
    )


@pytest.mark.parametrize("source,addresses", [
    ("100.64.0.2", ["100.64.0.2"]),
    ("::ffff:100.64.0.2", ["100.64.0.2"]),
    ("fd7a:115c:a1e0::1", ["fd7a:115c:a1e0:0:0:0:0:1"]),
])
def test_exact_tailscale_addresses_are_normalized(source, addresses):
    result = service.identify_current_device([device(ips=addresses)], source)
    assert result.tailscale_id == "a"
    assert result.method == "tailscale_ip"


def test_duplicates_and_missing_records_do_not_claim_the_browser():
    assert service.identify_current_device([
        device(ips=["100.64.0.2"]), device("b", ["100.64.0.2"])
    ], "100.64.0.2").tailscale_id is None
    assert service.identify_current_device([
        device(ips=["100.64.0.2"], sync="missing_from_tailnet")
    ], "100.64.0.2").tailscale_id is None


def test_lan_matching_is_exact_unique_and_lower_priority_than_tailscale():
    rows = [device(ips=["100.64.0.2"], lan="192.168.1.20"), device("b", lan="100.64.0.2")]
    assert service.identify_current_device(rows, "100.64.0.2").tailscale_id == "a"
    assert service.identify_current_device(rows, "192.168.1.20").method == "lan_ip"
    rows.append(device("c", lan="192.168.1.20"))
    assert service.identify_current_device(rows, "192.168.1.20").tailscale_id is None


@pytest.mark.parametrize("source", ["unknown", "0.0.0.0", "ff02::1", "203.0.113.7"])
def test_no_identity_is_guessed_from_names_or_unmatched_addresses(source):
    assert service.identify_current_device([device()], source).tailscale_id is None


def test_localhost_detection_requires_local_browser_and_direct_development_host(monkeypatch):
    monkeypatch.setattr(service, "get_settings", lambda: SimpleNamespace(env="development"))
    monkeypatch.setattr(service.Path, "exists", lambda _: False)
    monkeypatch.setattr(service, "local_interface_addresses", lambda: {service.normalized_ip("100.64.0.2")})
    rows = [device(ips=["100.64.0.2"])]
    assert service.identify_current_device(rows, "127.0.0.1").tailscale_id is None
    assert service.identify_current_device(rows, "127.0.0.1", local_access=True).method == "local_host"
    monkeypatch.setattr(service.Path, "exists", lambda _: True)
    assert service.identify_current_device(rows, "127.0.0.1", local_access=True).tailscale_id is None
    monkeypatch.setattr(service.Path, "exists", lambda _: False)
    monkeypatch.setattr(service, "get_settings", lambda: SimpleNamespace(env="production"))
    assert service.identify_current_device(rows, "127.0.0.1", local_access=True).tailscale_id is None


@pytest.mark.parametrize("peer,header,expected", [
    ("192.168.1.20", "100.64.0.2", "192.168.1.20"),
    ("127.0.0.1", "100.64.0.2", "100.64.0.2"),
    ("::ffff:127.0.0.1", "100.64.0.2", "100.64.0.2"),
    ("127.0.0.1", "100.64.0.9, 192.168.1.20", "192.168.1.20"),
    ("127.0.0.1", "100.64.0.2, ::1", "100.64.0.2"),
    ("127.0.0.1", "invalid", "unknown"),
    ("127.0.0.1", ",".join(["127.0.0.1"] * 17), "unknown"),
])
def test_forwarded_addresses_cannot_skip_an_untrusted_hop(monkeypatch, peer, header, expected):
    from app.core import middleware
    monkeypatch.setattr(middleware, "get_settings", lambda: SimpleNamespace(trusted_proxy_ip_list=["127.0.0.1", "::1"]))
    request = Request({"type": "http", "client": (peer, 12345), "headers": [(b"x-forwarded-for", header.encode())]})
    assert middleware.observed_source_ip(request) == expected


@pytest.mark.anyio
@pytest.mark.parametrize("peer,expected", [("127.0.0.1", "https"), ("192.168.1.20", "http")])
async def test_https_scheme_is_preserved_only_from_a_trusted_proxy(app, peer, expected):
    @app.get("/test-request-scheme")
    def request_scheme(request: Request):
        return {"scheme": request.url.scheme}

    async with AsyncClient(transport=ASGITransport(app=app, client=(peer, 12345)), base_url="http://testserver") as client:
        response = await client.get("/test-request-scheme", headers={"X-Forwarded-Proto": "https"})
        assert response.json() == {"scheme": expected}


@pytest.mark.anyio
async def test_current_device_endpoint_is_authenticated_and_returns_request_specific_identity(app):
    db = app.state.testing_session_local()
    db.add(device(ips=["100.64.0.2"]))
    db.commit()
    db.close()
    async with AsyncClient(transport=ASGITransport(app=app, client=("100.64.0.2", 12345)), base_url="http://testserver") as client:
        assert (await client.get("/api/tailscale/current-device")).status_code == 401
        assert (await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})).status_code == 200
        response = await client.get("/api/tailscale/current-device")
        assert response.json() == {"tailscale_id": "a", "method": "tailscale_ip"}
        assert response.headers["cache-control"] == "no-store"
