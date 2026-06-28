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

export type ServiceStatus = {
  name: string;
  slug: string;
  status: string;
  detail: string;
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
