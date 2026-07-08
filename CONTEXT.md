# PiHomeHub

PiHomeHub is a local-first home dashboard for managing private Raspberry Pi services, devices, access, and maintenance from one trusted interface.

## Language

**Service Host Port**:
The port on the Raspberry Pi host that forwards traffic into a managed service container. This is the user-facing port PiHomeHub should validate and configure before service creation.
_Avoid_: Container port, exposed port, live port patch

**Managed Service**:
A home service that PiHomeHub can inspect and control through Docker Compose, such as AdGuard Home, Gitea, Uptime Kuma, Vaultwarden, or Mosquitto.
_Avoid_: App, container, integration

**Service Port Configuration**:
The desired set of service host ports for a managed service. PiHomeHub may edit it through the UI, but it remains deployment configuration rather than runtime container state.
_Avoid_: Runtime port fix, container networking patch

**Valid Service Port Configuration**:
A service port configuration that uses numeric host ports in range, avoids disallowed duplicates, and does not conflict with known host listeners. PiHomeHub must reject invalid service port configurations before saving them.
_Avoid_: Best-effort port config, save-then-fail config

**Pending Service Port Change**:
A saved service port configuration that differs from the ports currently used by a running managed service. It must be made visually explicit and requires user confirmation before PiHomeHub recreates the service.
_Avoid_: Silent port update, live port edit, background recreate
