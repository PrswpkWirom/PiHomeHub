# MQTT security

MQTT is disabled until an administrator completes setup. The Services page reports **Setup required** and blocks creation until the generated password file and ACL contain a matching username:

```bash
./scripts/create-mqtt-credentials.sh sensor-bedroom
# Review generated/acl and allow only the exact topics for this device.
# Then select Create and start for Mosquitto on the Services page.
```

The helper creates an ACL from the example only when none exists. The Services page enables Mosquitto creation only after the ACL contains the same username as the generated password file; run `python3 scripts/generate-service-config.py` after changing the ACL. It retains your host user as owner and grants the broker group (numeric GID 1883) read access: directory mode 750, files mode 640. This lets the unprivileged broker read the read-only bind mount while keeping credentials inaccessible to other host users. Keep that numeric group reserved for the broker; run the helper again after changing an ACL if your editor changes its permissions.

Create a distinct username per device. Grant only exact telemetry topics and deny `home/control/#`; never let one sensor publish another sensor's prefix. Generated password/ACL files are ignored by Git. The setup helper regenerates the non-secret service catalog after credential changes. MQTT binds only to `PIHOMEHUB_BIND_ADDRESS`, which must be the server's Tailscale IP. Validate from each tailnet device that allowed publishes work and cross-device/control publishes fail.
