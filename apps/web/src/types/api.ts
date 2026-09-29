export type AuthUser = {
  id: number;
  username: string;
  is_admin: boolean;
  password_changed_at?: string | null;
};

export type AdminUser = {
  id: number;
  username: string;
  is_admin: boolean;
  is_active: boolean;
};

export type SessionRead = {
  id: number;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  authentication_time: string;
  user_agent: string | null;
  source_ip: string | null;
  current: boolean;
};

export type AuditEventSummary = {
  id: number;
  created_at: string;
  request_id: string | null;
  actor_user_id: number | null;
  actor_username: string | null;
  event: string;
  target_type: string | null;
  target_identifier: string | null;
  success: boolean;
  source_ip: string | null;
};

export type AuditEventPage = {
  items: AuditEventSummary[];
  next_cursor: number | null;
};

export type PiStatus = {
  hostname: string;
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  temperature_c: number | null;
  uptime_seconds: number;
  local_ip: string | null;
  platform: string;
};

export type DeviceSummary = {
  id: number | null;
  name: string;
  device_type: string;
  ip_address: string | null;
  tailscale_name: string | null;
  mac_address: string | null;
  broadcast_address: string | null;
  supports_wol: boolean;
  status: string;
  description: string | null;
};

export type DeviceWrite = {
  name: string;
  device_type: string;
  ip_address?: string | null;
  tailscale_name?: string | null;
  mac_address?: string | null;
  broadcast_address?: string | null;
  supports_wol: boolean;
  description?: string | null;
};

export type TailscaleStatus = {
  token_saved: boolean;
  tailnet: string | null;
  connected: boolean;
  last_sync_at: string | null;
  last_sync_error: string | null;
};

export type TailscaleConnectionResult = {
  ok: boolean;
  message: string;
};

export type CurrentTailscaleDevice = {
  tailscale_id: string | null;
  method: "tailscale_ip" | "lan_ip" | "local_host" | "unknown";
};

export type TailscaleDevice = {
  id: number;
  tailscale_id: string;
  node_id: string | null;
  machine_name: string;
  display_name: string;
  hostname: string | null;
  tailscale_ips: string[];
  os: string | null;
  online: boolean;
  last_seen: string | null;
  tags: string[];
  sync_status: string;
  last_synced_at: string | null;
  supports_wol: boolean;
  mac_address: string | null;
  lan_ip_address: string | null;
  broadcast_address: string | null;
  alias: string | null;
  note: string | null;
};

export type TailscaleWolWrite = {
  supports_wol: boolean;
  mac_address?: string | null;
  lan_ip_address?: string | null;
  broadcast_address?: string | null;
  alias?: string | null;
  note?: string | null;
};

export type TailscaleDeviceSettingsWrite = {
  display_name?: string | null;
  supports_wol: boolean;
  mac_address?: string | null;
  lan_ip_address?: string | null;
  broadcast_address?: string | null;
  note?: string | null;
};

export type ServiceStatus = {
  name: string;
  slug: string;
  status: string;
  health_status?: "healthy" | "unhealthy" | "starting" | null;
  detail: string;
};

export type NotificationSeverity = "info" | "success" | "warning" | "critical";
export type NotificationCategory = "device" | "service" | "system" | "security" | "tailscale" | "planner";
export type HubNotification = {
  id: number;
  event_type: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  message: string;
  source_type: string | null;
  source_id: string | null;
  target_path: string | null;
  created_at: string;
  resolved_at: string | null;
  read_at: string | null;
};
export type NotificationPageResponse = { items: HubNotification[]; next_before_id: number | null };
export type NotificationUnreadCount = { count: number };
export type NotificationPreferences = {
  device_offline: boolean;
  device_recovered: boolean;
  service_failure: boolean;
  service_recovered: boolean;
  temperature: boolean;
  disk: boolean;
  memory: boolean;
  monitoring: boolean;
  tailscale_sync: boolean;
};

export type ServiceCapability = {
  slug: string;
  actions: string[];
};

export type ServiceActionResult = {
  slug: string;
  action: string;
  ok: boolean;
  message: string;
};

export type ServicePort = {
  key: string;
  label: string;
  env_var: string;
  container_port: number;
  protocols: string[];
  default_host_port: number;
  desired_host_port: number;
  running_host_ports: Record<string, number | null>;
  pending: boolean;
};

export type ServicePortConfig = {
  slug: string;
  name: string;
  status: string;
  detail: string;
  has_pending_port_change: boolean;
  deployment_mode: "operator";
  configuration_mode: "web" | "operator";
  bindings_verified: boolean;
  operator_command: string;
  ports: ServicePort[];
};

export type ServiceLink = {
  id: number;
  name: string;
  slug: string;
  url: string;
  description: string | null;
};

export type TaskItem = {
  id: number;
  title: string;
  due_label: string | null;
  is_complete: boolean;
};
