# Authentication and sessions

Create the first administrator interactively. Production never reads an
administrator password from environment variables:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml \
  run --rm backend python -m app.cli create-admin
```

Passwords must contain 12–1024 characters and cannot be one of the known
defaults. PiHomeHub counts Unicode code points consistently in the browser and
backend, does not trim password values, and uses Argon2id for new hashes. Login
failure responses are generic and rate limits expire automatically.

## Account settings

The Settings page has General, Account, Access, Users, Security, and System
sections. Account shows the username and Administrator/Viewer role, the
**Last recorded password update**, active sessions, and sign-out controls. The
password timestamp can reflect a legacy hash upgrade or migration; it is the
last timestamp PiHomeHub recorded, not proof of the exact time a person chose
the password.

Changing a password requires the current password and recent authentication.
After confirmation, PiHomeHub updates the password hash and timestamp, revokes
all of that user's sessions (including the current one), and clears the current
browser cookies after the database transaction succeeds. The user then signs
in again with the new password. A failed database transaction does not change
the password or revoke sessions.

“Log out everywhere” also requires recent authentication and revokes every
session, including the browser performing the action. “Sign out this session”
ends only the current session. A user can revoke another session without
ending their current one. The account page lists server-recorded creation,
last-active, expiry, source IP, and reported client information; absent values
are left unavailable rather than inferred.

Recent authentication lasts 10 minutes by default. If it expires, the existing
confirmation dialog asks for the password and rotates the current session and
CSRF token. The user must retry the interrupted action after confirmation;
PiHomeHub does not replay it automatically.

## Sessions and cookies

Sessions use 48-byte random opaque tokens. Only SHA-256 hashes are stored.
Defaults are 12 hours idle, 7 days absolute, and 10 minutes for recent
authentication. Disabling an account or changing its role revokes all of that
account's sessions. Administrators cannot demote or disable their own account,
and the backend rejects any change that would leave no enabled administrator.
These protections are enforced atomically by the backend.

Production cookies are `__Host-pihomehub_session` and
`__Host-pihomehub_csrf`, with `Secure`, `SameSite=Strict`, path `/`, and no
Domain. The session cookie is HttpOnly. The frontend copies the readable
synchronizer token into `X-CSRF-Token`; the backend also validates
Origin/Referer.

## Local role testing and recovery

The local setup uses the interactive CLI rather than a web signup screen. To
create another account for Viewer testing, run:

```bash
PYTHONPATH=apps/backend .venv/bin/python -m app.cli create-admin --allow-additional-admin
```

Then demote it in Settings → Users. New accounts are administrators because
the CLI intentionally creates the initial operator account type; account
creation does not happen in the Users screen.

For a forgotten password, stop the app, use an offline administrative
procedure to set a new Argon2id hash or create a replacement administrator
with the CLI, then revoke the old account's sessions. Never place passwords in
Compose, shell history, or logs.
