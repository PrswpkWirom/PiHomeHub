# Tailscale Serve

With production Caddy bound to `127.0.0.1:443`, expose it only inside the tailnet:

```bash
sudo tailscale serve --bg https+insecure://127.0.0.1:443
tailscale serve status
```

Tailscale terminates the browser-facing HTTPS certificate; `https+insecure` is limited to the local hop because Caddy uses its internal certificate. Set `PIHOMEHUB_PUBLIC_BASE_URL` and `PIHOMEHUB_ALLOWED_ORIGINS` to the exact `https://node.tailnet.ts.net` URL reported by Serve. Use tailnet ACLs to restrict users/devices.

Do not run `tailscale funnel`. PiHomeHub does not authorize from Tailscale identity headers, so spoofed headers cannot replace application login. Reset an accidental configuration with `sudo tailscale serve reset` and verify no Funnel entry exists.

## Identifying the viewing device

The Devices page puts the viewing machine first and marks it **This device**.
PiHomeHub compares the verified request address to the synced Tailscale IPv4/IPv6
addresses, then to an explicitly configured LAN address. It accepts only a
unique match among devices still in the tailnet. In direct development, a local
browser can also be matched to the host's actual network interfaces. The lookup
is linear in the number of saved addresses and makes no cloud calls, subprocess
calls, DNS lookups, or network scans. It refreshes on load, after sync, once per
minute, and when the browser reconnects or the tab becomes visible again.
Names, operating systems, users, and online status are never used to guess identity.

Tailscale Serve forwards the source address, but Caddy must trust the exact Serve
proxy hop to preserve it. With the bundled Docker edge network, connections from
the host normally reach Caddy from `172.30.0.1`. For loopback-only ingress served
by Tailscale, set this in `infra/.env` and recreate Caddy:

```dotenv
PIHOMEHUB_TRUSTED_INGRESS_PROXY_IPS=172.30.0.1
```

Verify that address for your deployment; trust only actual proxy addresses.
Caddy replaces the upstream forwarding header with its verified client address,
and FastAPI trusts only the configured Caddy hop. Uvicorn forwarding is disabled
to prevent the original peer address from being lost before verification.

If LAN addresses are missing, a proxy conceals the source, or several records
match, automatic detection returns no device. The page then offers **Identify
this device**. The selection is remembered only in that browser, follows the
stable Tailscale device ID through renames, and stops applying when the device
is removed from the tailnet. A subsequent automatic match takes precedence.
This indicator is informational and does not affect permissions or login.
