# Service port configuration source of truth

When the backend runs directly as the developer's user, PiHomeHub can edit managed service host ports from the UI, with durable desired configuration stored in `infra/.env`. Docker deployments, including Docker development, mount that file read-only and expose read-only port values in the UI; this avoids granting the container write access to a host-owned file that may also contain secrets. The backend sees operator changes live but cannot modify Compose configuration. Running or stopped-container Docker port bindings remain the source of truth for what is currently configured. A mismatch is shown as a pending operator-managed change with a fixed allowlisted Compose command; the web backend never accepts or executes an arbitrary Compose command.

While the Services page is open, pending bindings are checked every five seconds for up to two minutes. A warning is cleared only when a fresh control-agent snapshot shows that every running binding matches the desired value. Healthy resolution produces a contextual success message for eight seconds; matching ports on an unhealthy service remain a warning. The operator can copy the command or request an immediate status check, but recreation stays outside the web trust boundary.

## Consequences

Port edits are validated before saving, written to `infra/.env` immediately, and never applied by trying to patch a running container. PiHomeHub must compare desired ports from deployment config with actual Docker bindings to show pending state and prevent duplicate or split service instances.
