# Security

PiHomeHub is for a trusted LAN or Tailscale tailnet, never direct public exposure. Private-network placement is an outer control; local application authentication and server-side authorization remain mandatory.

## Phase 1 controls

- Opaque server sessions store SHA-256 token hashes, enforce 12-hour idle and 7-day absolute expiry, support revocation, and use `Secure`, `HttpOnly`, `SameSite=Strict`, host-only production cookies.
- Unsafe browser requests require an origin allowlist match and a per-session synchronizer token in `X-CSRF-Token`.
- Viewers can read dashboards and manage their own tasks/sessions. Device, Wake-on-LAN, Tailscale, service, user, and audit operations have explicit administrator dependencies. High-impact changes require authentication within the last 10 minutes.
- Passwords use Argon2id. Legacy PBKDF2 hashes upgrade after a successful login. Login failures are rate-limited by source IP and normalized username.
- The backend has no Docker socket or Docker CLI. It can request only allowlisted status/start/stop/restart operations from an HMAC-authenticated control agent on an internal Docker network.
- Production publishes only Caddy HTTPS, bound to loopback by default. Backend, web, and control-agent ports are private. FastAPI docs and debug mode are disabled.
- Caddy strips cookies, authorization, and CSRF headers before proxying static-file requests to the web container.
- MQTT is opt-in, rejects anonymous clients, and requires a password file plus per-device ACLs.
- Security events are stored in `audit_events`; secret-bearing fields are redacted.

## Remaining boundaries

The control agent necessarily holds host-equivalent Docker-socket privilege. Keep its code, image, network, and allowlist small. The SQLite database and Compose secrets must be protected by host filesystem permissions and backups. Hardware-specific firewall, Tailscale ACL, Docker socket ownership, Wake-on-LAN, and MQTT-client checks remain deployment responsibilities.

Do not enable Tailscale Funnel. Do not trust Tailscale identity headers for application authorization; PiHomeHub uses its own session.
