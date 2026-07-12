# Authentication and sessions

Create the first administrator interactively; production never reads an administrator password from environment variables:

```bash
docker compose -f infra/docker-compose.yml run --rm backend python -m app.cli create-admin
```

Passwords must contain at least 12 characters and cannot be a known default. Argon2id is used for new hashes. Login failure responses are generic and rate limits expire automatically.

Sessions use 48-byte random opaque tokens. Only SHA-256 hashes are stored. Defaults are 12 hours idle, 7 days absolute, and 10 minutes for recent authentication. Changing a password, disabling an account, changing privileges, or logging out all devices revokes affected sessions. `/api/auth/sessions` lists devices; a user can revoke one session or all sessions. `/api/auth/reauthenticate` rotates the current session after password re-entry.

Production cookies are `__Host-pihomehub_session` and `__Host-pihomehub_csrf`, with `Secure`, `SameSite=Strict`, path `/`, and no Domain. The session cookie is HttpOnly. The frontend copies the readable synchronizer token into `X-CSRF-Token`; the backend also validates Origin/Referer.

For a forgotten password, stop the app, use an offline administrative procedure to set a new Argon2id hash or create a replacement administrator with the CLI, then revoke the old account's sessions. Never place passwords in Compose, shell history, or logs.
