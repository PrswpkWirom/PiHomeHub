# Authorization matrix

| Routes | Classification |
|---|---|
| `POST /api/auth/login` | Public, trusted Origin required |
| `GET /health` | Public liveness on private backend network |
| `GET /api/auth/me`, `GET /api/auth/sessions` | Authenticated read |
| `POST /api/auth/logout`, `POST /api/auth/reauthenticate`, `DELETE /api/auth/sessions/{id}` | Authenticated write + CSRF |
| Auth logout-all, change-password | Authenticated write + recent authentication + CSRF |
| System, service status/capabilities/links/ports, device/Tailscale reads, task reads | Authenticated read |
| Task create/update/delete | Authenticated write + CSRF |
| Device create/update/delete, WOL, Tailscale test/sync/device changes/wake | Admin + CSRF |
| Tailscale credentials/settings | Recent admin + CSRF |
| Service start/stop/restart and port configuration/apply | Recent admin + CSRF |
| `GET /api/admin/users`, `GET /api/admin/audit-events`, `GET /api/admin/audit-events/page` | Admin |
| User enable/disable/role changes | Recent admin + CSRF |

All routes inherit server-side dependencies; the React protected route is usability only. Unsupported Docker services/actions are rejected before reaching the control agent.

The paginated audit route accepts `limit` (1–100), optional `before_id`, and
`category` (`all`, `authentication`, `users`, `services`, or `system`). It
returns safe summaries and never exposes raw audit metadata. The original
`/api/admin/audit-events` response remains available for existing clients.

Viewer navigation hides Users and Security, and direct visits render an
administrator-required message without mounting those screens or requesting
their data. Frontend role checks improve usability only: every protected
operation is still authorized by the backend.

In the UI, Settings → Access contains Tailscale status and administrator-only
credential/sync controls. Service links and service port values and controls
remain on the Services page. Viewers can read service status, links, and port
values but cannot change them.
