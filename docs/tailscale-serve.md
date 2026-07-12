# Tailscale Serve

With production Caddy bound to `127.0.0.1:443`, expose it only inside the tailnet:

```bash
sudo tailscale serve --bg https+insecure://127.0.0.1:443
tailscale serve status
```

Tailscale terminates the browser-facing HTTPS certificate; `https+insecure` is limited to the local hop because Caddy uses its internal certificate. Set `PIHOMEHUB_PUBLIC_BASE_URL` and `PIHOMEHUB_ALLOWED_ORIGINS` to the exact `https://node.tailnet.ts.net` URL reported by Serve. Use tailnet ACLs to restrict users/devices.

Do not run `tailscale funnel`. PiHomeHub does not authorize from Tailscale identity headers, so spoofed headers cannot replace application login. Reset an accidental configuration with `sudo tailscale serve reset` and verify no Funnel entry exists.
