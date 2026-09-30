import pytest


@pytest.mark.anyio
async def test_save_custom_link_and_override_survive_reads(browser_client):
    client = browser_client
    await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
    created = await client.post("/api/services/links", json={"name": " Hall aircon ", "url": "http://aircon.local:8080/control"})
    assert created.status_code == 201
    link = created.json()
    assert link["name"] == "Hall aircon"
    assert link["url_override"] is True
    updated = await client.patch(f"/api/services/links/{link['slug']}", json={"name": "Aircon", "url": "https://aircon.local/control"})
    assert updated.status_code == 200
    override = await client.patch("/api/services/links/vaultwarden", json={"name": "Vaultwarden", "url": "https://vault.local/vault"})
    assert override.status_code == 200
    links = (await client.get("/api/services/links")).json()
    assert next(item for item in links if item["slug"] == "vaultwarden")["url"] == "https://vault.local/vault"
    assert next(item for item in links if item["slug"] == link["slug"])["url"] == "https://aircon.local/control"
    seeded = await client.patch("/api/services/links/gitea", json={"name": "Git", "url": "https://git.local"})
    assert seeded.status_code == 200
    assert seeded.json()["url_override"] is True


@pytest.mark.anyio
async def test_link_validation_and_permissions(browser_client, app):
    client = browser_client
    payload = {"name": "Aircon", "url": "https://aircon.local"}
    assert (await client.post("/api/services/links", json=payload)).status_code == 401
    await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
    for url in ["javascript:alert(1)", "file:///etc/passwd", "/relative", "https://user:secret@host.local"]:
        assert (await client.post("/api/services/links", json={**payload, "url": url})).status_code == 422
    assert (await client.post("/api/services/links", json={**payload, "name": "  "})).status_code == 422
    assert (await client.patch("/api/services/links/unknown", json=payload)).status_code == 404
    from app.models.user import User
    with app.state.testing_session_local() as db:
        db.query(User).filter(User.username == "admin").one().is_admin = False
        db.commit()
    assert (await client.post("/api/services/links", json=payload)).status_code == 403
    assert (await client.patch("/api/services/links/gitea", json=payload)).status_code == 403


def test_link_migration_preserves_existing_defaults(tmp_path):
    import os
    import sqlite3
    import subprocess
    import sys
    from pathlib import Path

    backend = Path(__file__).parents[2]
    database = tmp_path / "links.db"
    env = {**os.environ, "PYTHONPATH": str(backend), "PIHOMEHUB_ENV": "testing", "PIHOMEHUB_DATABASE_URL": f"sqlite:///{database}"}
    def migrate(revision):
        subprocess.run([sys.executable, "-m", "alembic", "upgrade", revision], cwd=backend, env=env, check=True, capture_output=True, timeout=30)
    migrate("0005_notification_center")
    with sqlite3.connect(database) as connection:
        connection.execute("INSERT INTO service_links (name, slug, url) VALUES (?, ?, ?)", ("Vaultwarden", "vaultwarden", "http://pi.local:3004"))
    migrate("head")
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT url, url_override FROM service_links").fetchone() == ("http://pi.local:3004", 0)
