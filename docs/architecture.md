# Architecture

PiHomeHub v0.1 is a local-first React PWA, FastAPI API, SQLite database, and Docker deployment for a Raspberry Pi.

## Production flow

```text
Browser
  -> Tailscale Serve HTTPS (recommended)
  -> loopback Caddy HTTPS (only published Compose port)
     -> static frontend container
     -> FastAPI container
        -> SQLite
        -> Tailscale API / host metrics
        -> HMAC-authenticated WOL agent on the private bridge gateway
           -> host LAN broadcast
        -> HMAC-authenticated private control network
           -> restricted control agent
              -> Docker socket
```

The frontend is a multi-stage static build; Vite is absent from runtime. FastAPI runs as an unprivileged user without Docker CLI/socket. The control agent is isolated, not host-published, and accepts only status/start/stop/restart for five fixed services. A separate unprivileged Wake-on-LAN agent has host networking so broadcasts reach the physical LAN, listens only on the private Docker bridge gateway, and has no Docker socket or host mounts. MQTT and home services are optional profiles.

Authentication uses opaque hashed server sessions, a strict host-only cookie, per-session CSRF synchronizer token, origin checks, idle/absolute expiration, and revocation. Authorization is enforced by route dependencies rather than the frontend. Audit events are structured rows in SQLite.

Tailscale machines are distinct from manual devices. Sync stores stable machine identity and status; local aliases, MAC addresses, broadcast addresses, and WOL settings remain in PiHomeHub. Missing remote devices retain local metadata and are marked missing.
