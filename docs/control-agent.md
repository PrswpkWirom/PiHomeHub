# Restricted Docker control agent

The backend signs each request with HMAC-SHA256 over timestamp, nonce, method, path, and body hash. The agent accepts a 30-second clock window, rejects replayed nonces, is reachable only on the internal `control` network, and is never published to the host.

The fixed service set is AdGuard Home, Gitea, Uptime Kuma, Vaultwarden, and Mosquitto. The agent accepts only create, start, stop, and restart for those names. Existing service containers must carry the `infra` Compose project and matching service labels before lifecycle actions are allowed. Creation uses the generated, fixed `infra` Compose manifest with pinned images, predefined ports, volumes, and bind mounts; callers cannot supply images, commands, project paths, mounts, or environment variables.

Every request has a client-generated idempotency ID. The agent records it in a persistent SQLite journal before starting Docker work and returns the same operation when the request is repeated. One operation can run per service at a time. Create and image download have a 10-minute bound; lifecycle actions and final verification are each bounded at two minutes. A timeout or agent restart is reconciled against the saved pre-action start time and Docker state. The agent never repeats an uncertain restart.

The agent runs as an unprivileged UID. Set `DOCKER_GID` in `infra/.env` to the numeric group ID that owns `/var/run/docker.sock` on the host. Compose grants only that supplemental group to the agent. The control-agent SQLite volume stores operation history and is included in verified host backups.

`infra/generated/services.json` and `services.compose.json` are regenerated from resolved Compose configuration by `scripts/compose.sh`. These artifacts contain only the allowlisted optional-service configuration and publish service ports only on the configured private Tailscale address. They exclude secrets. Mosquitto remains disabled in the UI until the generated password file and ACL contain a matching user.

The Docker socket remains host-equivalent control. Keep the fixed allowlist, validate generated configuration before deployment, and do not add general Docker proxying, shell routes, or debug routes.
