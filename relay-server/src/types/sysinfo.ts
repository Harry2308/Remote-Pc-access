export interface SysInfo {
  cpu: { model: string; cores: number; usagePercent: number };
  ram: { totalGB: number; usedGB: number; freeGB: number; usagePercent: number };
  disks: { drive: string; totalGB: number; usedGB: number; freeGB: number; usagePercent: number }[];
  uptime: number;
  hostname: string;
  platform: string;
  processes: { pid: number; name: string; cpuPercent: number; memMB: number }[];
}
