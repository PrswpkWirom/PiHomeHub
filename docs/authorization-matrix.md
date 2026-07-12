# Authorization matrix

| Routes | Classification |
|---|---|
| `POST /api/auth/login` | Public, trusted Origin required |
| `GET /health` | Public liveness on private backend network |
| `GET /api/auth/me`, `GET /api/auth/sessions` | Authenticated read |
| Auth logout, reauthenticate, session revoke | Authenticated write + CSRF |
| Auth logout-all, change-password | Authenticated write + recent authentication + CSRF |
| System, service status/capabilities/links/ports, device/Tailscale reads, task reads | Authenticated read |
| Task create/update/delete | Authenticated write + CSRF |
| Device create/update/delete, WOL, Tailscale test/sync/device changes/wake | Admin + CSRF |
| Tailscale credentials/settings | Recent admin + CSRF |
| Service start/stop/restart and port configuration/apply | Recent admin + CSRF |
| Audit event reads | Admin |
| User enable/disable/role changes | Recent admin + CSRF |

All routes inherit server-side dependencies; the React protected route is usability only. Unsupported Docker services/actions are rejected before reaching the control agent.
