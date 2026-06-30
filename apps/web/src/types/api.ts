export type AuthUser = {
  id: number;
  username: string;
  is_admin: boolean;
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
  detail: string;
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
