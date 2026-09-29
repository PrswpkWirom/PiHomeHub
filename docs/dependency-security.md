# Dependency security

The Phase 1 audit upgraded FastAPI `0.115.0 -> 0.139.0` (bringing Starlette `0.38.6 -> 1.3.1`), python-multipart `0.0.12 -> 0.0.32`, cryptography `43.0.1 -> 48.0.1`, and pytest `8.3.3 -> 9.0.3`. Argon2-cffi `23.1.0` was added for password hashing. These versions clear the advisories reported by `pip-audit` on 2026-07-10; compatibility is covered by API, migration, and control-agent tests.

Frontend production and full dependency audits must be rerun whenever the lockfile changes. Do not use forced major-version audit fixes. Record any remaining advisory with affected code path, exploitability, compensating controls, and an owner/review date.

The frontend moved Vite `5.4.21 -> 6.4.3`, Vitest `2.1.9 -> 3.2.6`, and `@vitejs/plugin-react` `4.3.2 -> 4.7.0`. These are the first audited releases beyond the vulnerable ranges as part of the earlier compatibility update. The current builder and development image use Node 24 LTS; Node 18 and 20 are end-of-life. See [Node release support](https://nodejs.org/en/about/previous-releases).

Production container images use exact release tags plus immutable multi-architecture OCI index digests: Python `3.12.13-slim`, Node `24.21.0-alpine`, Caddy `2.11.4-alpine`, AdGuard Home `v0.107.77`, Gitea `1.26.4`, Uptime Kuma `2.4.0`, Vaultwarden `1.36.0`, and Mosquitto `2.1.2-alpine`. Review and update each tag and digest together; never reintroduce a floating or tag-only production image reference.

The deployment polish updated React Router DOM to `7.18.4` and Vitest to
`4.1.11`, with compatible transitive security fixes in the committed lockfile.
The app keeps its declarative routing, React 18, and Vite 6; it does not adopt
a server-rendering router. See the [router migration guide](https://reactrouter.com/7.18.4/upgrading/v6)
and [Vitest 4 migration prerequisites](https://raw.githubusercontent.com/vitest-dev/vitest/v4.1.11/docs/guide/migration.md).
Run `npm --prefix apps/web audit` and the full frontend tests/build after each
dependency change; a clean audit reflects current advisories, not a security guarantee.

Verification for this change: the full frontend dependency audit reports zero
known vulnerabilities; all 49 frontend tests and the TypeScript/Vite production
build pass on Node 24.21.0. The backend suite passes 134 tests.
