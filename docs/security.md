# Security

PiHomeHub v0.1 is designed for LAN or Tailscale access only.

## Controls

- Single admin account with password hash storage using `passlib` with `pbkdf2_sha256`
- HTTP-only session cookie for authenticated API access
- Auth enforced on all API routes except `/api/auth/login`
- Wake-on-LAN restricted to authenticated admin access
- Tailscale API token is stored encrypted by the backend and is never returned to the frontend
- Tailscale token UI is write-only: users can save or replace a token, but cannot view the stored value
- Reverse-proxy TLS termination expected in front of the app for production access

## Non-Goals

- No public dashboard exposure
- No shell execution
- No arbitrary service start/stop/restart actions
- No secrets import from Vaultwarden
- No interactive Tailscale OAuth/device login in the first Tailscale integration
