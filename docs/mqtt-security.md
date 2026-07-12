# MQTT security

MQTT is disabled unless the `mqtt` Compose profile is selected. Before enabling it:

```bash
cp infra/mosquitto/acl.example infra/mosquitto/generated/acl
./scripts/create-mqtt-credentials.sh sensor-bedroom
docker compose -f infra/docker-compose.yml --profile mqtt up -d mosquitto
```

Create a distinct username per device. Grant only exact telemetry topics and deny `home/control/#`; never let one sensor publish another sensor's prefix. Generated password/ACL files are ignored by Git and must be mode 600 where practical. MQTT binds to loopback by default; set a specific trusted LAN address only when devices need it. Validate from each real device that allowed publishes work and cross-device/control publishes fail.
