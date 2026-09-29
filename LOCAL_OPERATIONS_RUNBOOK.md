# PiHomeHub local operations runbook

This is a local operator reference for running PiHomeHub, administering accounts, and troubleshooting the Docker deployment. For stable home-server deployment, backups, upgrades, restore, and host acceptance checks, use the maintained [production deployment guide](docs/production-deployment.md) and [README](README.md). This runbook is tracked in Git; keep host secrets out of it.

## Development versus production

| Area | Development | Production |
|---|---|---|
| Compose files | `infra/docker-compose.yml` plus `infra/docker-compose.dev.yml` | `infra/docker-compose.yml` only |
| Browser URL | `http://localhost:5173` | Your configured HTTPS URL |
| Frontend | Vite development server with source bind mount and HMR | Static build served by Caddy |
| Backend | Published on host port `8000`; source bind-mounted | Private container port only; not published |
| Control agent | Private Docker network | Private Docker network |
| Main ingress | Direct Vite/backend development ports | Caddy HTTPS on `127.0.0.1:443` by default |
| Session cookie | Development cookie without `Secure` | `Secure`, `HttpOnly`, `SameSite=Strict`, host-only cookie |
| FastAPI docs | Available at `http://localhost:8000/docs` | Disabled |
| Secrets | Explicit development-only values from the dev override | Strong unique values required in `infra/.env` |
| Intended use | Local coding and testing only | Raspberry Pi LAN/Tailscale deployment |

Never expose the development stack to the public internet. Do not enable Tailscale Funnel.

## Important files

- `infra/.env`: local Docker deployment settings and production secrets. Never commit it.
- `infra/.env.example`: safe template for `infra/.env`.
- `apps/backend/.env`: settings for running the backend directly outside Docker. The development bind mount also makes it visible inside the backend container, but legacy administrator values are no longer used for account creation.
- `infra/docker-compose.yml`: secure production deployment.
- `infra/docker-compose.dev.yml`: development-only overrides.
- `apps/backend/alembic/versions`: database migrations.

## Development: first run

Run all commands from the repository root.

Validate the merged configuration:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml config -q
```

Build the backend and control-agent images:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml build
```

Apply database migrations:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml run --rm --no-deps backend alembic upgrade head
```

Create the first administrator interactively:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml run --rm --no-deps backend python -m app.cli create-admin
```

The command asks for a username and password. The password is not printed and must contain at least 12 characters. Do not store it in `.env` or Compose.

Start the development stack in the foreground:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up
```

Open:

```text
http://localhost:5173
```

Press `Ctrl+C` to stop a foreground stack.

## Development: normal daily use

Start in the background:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d
```

Show status:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml ps
```

Follow backend and frontend logs:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml logs -f backend web
```

Restart the backend after changing Python code. The frontend uses Vite HMR, but the backend development command does not currently use Uvicorn reload:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml restart backend
```

Stop containers while preserving the database volume:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml down
```

Do not add `-v` unless you intentionally want to delete the database and all named-volume data.

## Production: prepare configuration

Create the local production environment file:

```bash
cp infra/.env.example infra/.env
```

Generate two independent secrets:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Place different generated values in `infra/.env`:

```dotenv
PIHOMEHUB_SECRET_KEY=<first-generated-secret>
PIHOMEHUB_CONTROL_AGENT_SECRET=<second-generated-secret>
PIHOMEHUB_PUBLIC_BASE_URL=https://your-pi.your-tailnet.ts.net
PIHOMEHUB_ALLOWED_ORIGINS=https://your-pi.your-tailnet.ts.net
PIHOMEHUB_INGRESS_BIND_ADDRESS=127.0.0.1
PIHOMEHUB_HTTPS_PORT=443
```

Production rejects missing or weak secrets, HTTP public URLs, insecure origins, environment-supplied administrator passwords, and insecure cookie settings.

## Production: first run

Validate configuration:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml config -q
```

Build production images:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml build
```

Apply migrations before starting the application:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml run --rm --no-deps backend alembic upgrade head
```

Create the first administrator:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml run --rm --no-deps backend python -m app.cli create-admin
```

Start production in the background:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml up -d
```

Do not run the initial `up` before applying migrations and creating the administrator.

## Production through Tailscale Serve

Production Caddy binds to loopback by default. Publish it privately inside the tailnet:

```bash
sudo tailscale serve --bg https+insecure://127.0.0.1:443
tailscale serve status
```

Open the HTTPS URL reported by Tailscale. Keep `PIHOMEHUB_PUBLIC_BASE_URL` and `PIHOMEHUB_ALLOWED_ORIGINS` equal to that exact origin.

To remove the Serve configuration:

```bash
sudo tailscale serve reset
```

Do not use `tailscale funnel`.

## Production: normal operations

Show status:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml ps
```

Follow logs:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml logs -f backend web caddy control-agent
```

Restart only the backend:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml restart backend
```

Pull/rebuild and redeploy after source changes:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml build
docker compose --env-file infra/.env -f infra/docker-compose.yml run --rm --no-deps backend alembic upgrade head
docker compose --env-file infra/.env -f infra/docker-compose.yml up -d
```

Stop while preserving data:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml down
```

## Administrator accounts

### Create the first administrator

Development:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml run --rm --no-deps backend python -m app.cli create-admin
```

Production:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml run --rm --no-deps backend python -m app.cli create-admin
```

### Create an additional administrator

The CLI refuses a second active administrator unless the operator explicitly acknowledges it.

Development:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml run --rm --no-deps backend python -m app.cli create-admin --allow-additional-admin
```

Production:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml run --rm --no-deps backend python -m app.cli create-admin --allow-additional-admin
```

Use additional administrators sparingly. Each person should have a distinct account rather than sharing a password.

### Viewer/non-administrator accounts

The authorization model supports active non-administrator users, but Phase 1 currently has no supported CLI or API for creating a viewer account. Do not insert users manually with SQLite commands because that bypasses password policy, Argon2id hashing, audit events, and session revocation rules.

Until a supported `create-user` workflow is implemented, `create-admin` is the only account-provisioning command.

### Enable, disable, or change administrator status

The backend provides a recent-authentication-protected administrator endpoint:

```text
PATCH /api/admin/users/{user_id}
```

Supported fields are `is_active` and `is_admin`. This operation is intended for the authenticated application/API flow because it requires the session cookie, trusted Origin, and CSRF token. Changing either field revokes the target user's sessions. An administrator cannot disable or demote their own current account.

### Password changes

Authenticated users can change their own password through:

```text
POST /api/auth/change-password
```

The endpoint requires recent authentication, the current password, a valid CSRF token, and a new password meeting policy. A successful password change revokes all sessions.

There is not yet a supported offline password-reset CLI. Do not edit password hashes manually.

## Session operations

The authenticated API supports:

| Operation | Endpoint |
|---|---|
| Current user | `GET /api/auth/me` |
| List sessions | `GET /api/auth/sessions` |
| Revoke one session | `DELETE /api/auth/sessions/{session_id}` |
| Log out current session | `POST /api/auth/logout` |
| Log out all devices | `POST /api/auth/logout-all` |
| Refresh recent authentication | `POST /api/auth/reauthenticate` |

Unsafe requests require the session CSRF token and a trusted Origin. Login requires a trusted Origin but is deliberately exempt from session-CSRF so stale cookies cannot block recovery.

## Database migrations

Check the current migration revision:

Development:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml run --rm --no-deps backend alembic current
```

Production:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml run --rm --no-deps backend alembic current
```

Upgrade to the latest revision using `alembic upgrade head` before starting newly built backend code.

Back up the SQLite database volume before a production upgrade. Never use `docker compose down -v` as a normal reset command.

## Optional managed services

Create the optional home-service containers before asking the control agent to manage them:

Development:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml --profile home-services up -d adguard-home gitea uptime-kuma vaultwarden
```

Production:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml --profile home-services up -d adguard-home gitea uptime-kuma vaultwarden
```

The restricted control agent can only inspect, start, stop, or restart fixed allowlisted services. It cannot create arbitrary containers, images, mounts, or commands.

Production service host port changes are operator-managed: edit `infra/.env`, validate Compose, and redeploy. The production API intentionally does not apply port changes.

## MQTT

MQTT is disabled unless its profile is selected. Prepare credentials and ACLs first:

```bash
cp infra/mosquitto/acl.example infra/mosquitto/generated/acl
./scripts/create-mqtt-credentials.sh sensor-bedroom
```

Start MQTT in development:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml --profile mqtt up -d mosquitto
```

Start MQTT in production:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml --profile mqtt up -d mosquitto
```

Use a separate MQTT identity and narrow ACL for every device.

## Troubleshooting

### `Missing CSRF token`

The current backend allows a trusted-origin login to recover from stale session cookies. Hard-refresh the browser with `Ctrl+Shift+R` and log in again. If an obsolete frontend bundle remains, clear site data for the PiHomeHub origin.

### `Untrusted or missing request origin`

Open the application through an origin listed exactly in `PIHOMEHUB_ALLOWED_ORIGINS`. Scheme, host, and port must match. For development, use `http://localhost:5173` or `http://127.0.0.1:5173`.

### Backend source changes are not visible

Restart the development backend:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml restart backend
```

### View recent logs

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml logs --tail 200 backend web control-agent
```

### Check health directly in development

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{"status":"ok"}
```

## Safety summary

- Never commit `.env`, database files, MQTT credentials, private keys, or tokens.
- Never use production secrets in development examples or shell history.
- Never expose ports `5173` or `8000` as production ingress.
- Never mount the Docker socket into the backend.
- Never enable Tailscale Funnel.
- Never use `docker compose down -v` unless permanent data deletion is intended.
- Never run real service lifecycle tests against unrelated host containers.
