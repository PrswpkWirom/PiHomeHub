# Restricted Docker control agent

The backend signs each request with HMAC-SHA256 over timestamp, nonce, method, path, and body hash. The agent accepts a 30-second clock window, rejects replayed nonces, is reachable only on the internal `control` network, and is never published to the host.

The fixed service set is AdGuard Home, Gitea, Uptime Kuma, Vaultwarden, and Mosquitto. Operations are only status, start, stop, and restart. The agent builds fixed argument arrays such as `docker restart adguard-home`; it accepts no command, image, Compose path, mount, environment variable, or free-form argument. Unknown and shell-like identifiers are rejected before subprocess execution. Errors and logs contain only the allowlisted slug/action and a generic result.

The Docker socket makes the agent host-privileged. Do not add general Docker proxying, shell endpoints, debug routes, or unrelated packages. Production port-binding changes are explicitly disabled in the API; edit `infra/.env` and perform an operator-controlled Compose redeploy.
