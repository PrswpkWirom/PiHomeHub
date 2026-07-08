# Service port configuration source of truth

PiHomeHub lets users edit managed service host ports from the UI, but the durable desired configuration is stored in `infra/.env` and consumed by Docker Compose. Running Docker port bindings remain the source of truth for what is currently active, so a running service whose bindings differ from `infra/.env` has a pending service port change that requires explicit user confirmation before recreation.

## Consequences

Port edits are validated before saving, written to `infra/.env` immediately, and never applied by trying to patch a running container. PiHomeHub must compare desired ports from deployment config with actual Docker bindings to show pending state and prevent duplicate or split service instances.
