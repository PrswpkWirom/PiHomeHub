# Security

PiHomeHub v0.1 is designed for LAN or Tailscale access only.

## Controls

- Single admin account with password hash storage using `passlib` with `pbkdf2_sha256`
- HTTP-only session cookie for authenticated API access
- Auth enforced on all API routes except `/api/auth/login`
- Wake-on-LAN restricted to authenticated admin access
- Reverse-proxy TLS termination expected in front of the app for production access

## Non-Goals

- No public dashboard exposure
- No shell execution
- No arbitrary service start/stop/restart actions
- No secrets import from Vaultwarden
