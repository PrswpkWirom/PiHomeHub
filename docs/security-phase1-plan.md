# Phase 1 security plan and review record

## Architecture and trust boundaries

Browser traffic enters through Tailscale Serve HTTPS or the single Caddy HTTPS listener. Caddy serves the static React build and proxies `/api` to a non-published FastAPI container. FastAPI accesses SQLite and a private control network. Only the control agent mounts `/var/run/docker.sock`; it exposes a signed, replay-resistant, allowlisted API to FastAPI. MQTT and home services are optional profiles.

Trust boundaries are: browser to ingress, ingress to backend, backend to control agent, control agent to Docker Engine, backend to SQLite/Tailscale API, and MQTT devices to broker. An attacker may control a browser origin, steal a database copy, submit arbitrary route parameters, spoof forwarding headers on a directly reachable port, compromise the web process, or send malicious Docker-like identifiers.

## Confirmed adversarial findings

The pre-Phase-1 tree allowed every authenticated user to perform administrative writes; stored raw non-expiring session tokens; used a non-Secure Lax cookie; had no CSRF/origin checks; mounted Docker socket and Compose files into the root backend; exposed ports 5173/8000; ran Vite in production; logged Docker stderr; accepted placeholder credentials/secrets; enabled anonymous MQTT; and tested a reduced app without real middleware. These findings drove the implementation and regression tests.

## Route classification

The normative matrix is in [authorization-matrix.md](authorization-matrix.md). Deny behavior is 401 for anonymous/invalid sessions and 403 for authenticated users lacking role, recent authentication, CSRF, or trusted origin.

## Migration and rollout

Apply Alembic revision `0003_security_phase1` before starting the new app. It hashes legacy raw session tokens, assigns bounded expiry, invalidates legacy CSRF state, preserves users, adds account state, and creates audit storage. Existing users keep their password hashes and upgrade to Argon2id on login. Existing browser sessions must log in again because they do not possess the new CSRF token.

Risks are SQLite migration interruption, users losing sessions, Caddy internal CA trust for direct-LAN clients, and production service-port changes being explicitly operator-managed instead of web-applied. Back up the database and `.env` first. Rollback is: stop containers, restore the database and configuration backup, deploy the prior image set, and revoke/rotate application and control-agent secrets. The downgrade migration deliberately replaces session tokens with unusable values; users must log in again.
