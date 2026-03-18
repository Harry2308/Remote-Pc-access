export interface GpuInfo {
  name: string;
  usagePercent: number;
  memTotalMB: number;
  memUsedMB: number;
  memUsagePercent: number;
  temperatureC: number | null;
}

export interface SysInfo {
  cpu: { model: string; cores: number; usagePercent: number };
  ram: { totalGB: number; usedGB: number; freeGB: number; usagePercent: number };
  disks: { drive: string; totalGB: number; usedGB: number; freeGB: number; usagePercent: number }[];
  gpu: GpuInfo | null;
  uptime: number;
  hostname: string;
  platform: string;
  processes: { pid: number; name: string; cpuPercent: number; memMB: number }[];
}
