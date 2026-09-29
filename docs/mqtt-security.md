# MQTT security

MQTT is disabled unless the `mqtt` Compose profile is selected. Before enabling it:

```bash
./scripts/create-mqtt-credentials.sh sensor-bedroom
# Review generated/acl and enable only the exact topics for this device.
./scripts/compose.sh --profile mqtt up -d mosquitto
```

The helper creates an ACL from the example only when none exists. It retains your host user as owner and grants the broker group (numeric GID 1883) read access: directory mode 750, files mode 640. This lets the unprivileged broker read the read-only bind mount while keeping credentials inaccessible to other host users. Keep that numeric group reserved for the broker; run the helper again after changing an ACL if your editor changes its permissions.

Create a distinct username per device. Grant only exact telemetry topics and deny `home/control/#`; never let one sensor publish another sensor's prefix. Generated password/ACL files are ignored by Git. MQTT binds to loopback by default; set a specific trusted LAN address only when devices need it. Validate from each real device that allowed publishes work and cross-device/control publishes fail.
