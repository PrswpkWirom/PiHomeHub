# Dependency security

The Phase 1 audit upgraded FastAPI `0.115.0 -> 0.139.0` (bringing Starlette `0.38.6 -> 1.3.1`), python-multipart `0.0.12 -> 0.0.32`, cryptography `43.0.1 -> 48.0.1`, and pytest `8.3.3 -> 9.0.3`. Argon2-cffi `23.1.0` was added for password hashing. These versions clear the advisories reported by `pip-audit` on 2026-07-10; compatibility is covered by API, migration, and control-agent tests.

Frontend production and full dependency audits must be rerun whenever the lockfile changes. Do not use forced major-version audit fixes. Record any remaining advisory with affected code path, exploitability, compensating controls, and an owner/review date.

The frontend moved Vite `5.4.21 -> 6.4.3`, Vitest `2.1.9 -> 3.2.6`, and `@vitejs/plugin-react` `4.3.2 -> 4.7.0`. These are the first audited releases beyond the vulnerable ranges while retaining Node 18 compatibility for the existing development host; the production builder uses Node 20.

Production container images use exact release tags plus immutable multi-architecture OCI index digests: Python `3.12.13-slim`, Node `20.19.5-alpine`, Caddy `2.11.4-alpine`, AdGuard Home `v0.107.77`, Gitea `1.26.4`, Uptime Kuma `2.4.0`, Vaultwarden `1.36.0`, and Mosquitto `2.1.2-alpine`. Review and update each tag and digest together; never reintroduce a floating or tag-only production image reference.
