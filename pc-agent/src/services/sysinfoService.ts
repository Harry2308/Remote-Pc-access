import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface GpuInfo {
  name: string;
  usagePercent: number;
  memTotalMB: number;
  memUsedMB: number;
  memUsagePercent: number;
  temperatureC: number | null;
}

export interface SysInfo {
  cpu: {
    model: string;
    cores: number;
    usagePercent: number;
  };
  ram: {
    totalGB: number;
    usedGB: number;
    freeGB: number;
    usagePercent: number;
  };
  disks: DiskInfo[];
  gpu: GpuInfo | null;
  uptime: number; // seconds
  hostname: string;
  platform: string;
  processes: ProcessInfo[];
}

export interface DiskInfo {
  drive: string;
  totalGB: number;
  usedGB: number;
  freeGB: number;
  usagePercent: number;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpuPercent: number;
  memMB: number;
}

export class SysInfoService {
  private lastCpuInfo = os.cpus();
  private lastCpuTime = Date.now();

  async get(): Promise<SysInfo> {
    const [cpuUsage, disks, processes, gpu] = await Promise.all([
      this.getCpuUsage(),
      this.getDiskInfo(),
      this.getProcesses(),
      this.getGpuInfo(),
    ]);

    const totalMem = os.totalmem();
    const freeMem  = os.freemem();
    const usedMem  = totalMem - freeMem;

    return {
      cpu: {
        model: os.cpus()[0]?.model ?? 'Unknown',
        cores: os.cpus().length,
        usagePercent: cpuUsage,
      },
      ram: {
        totalGB:      round(totalMem / 1e9),
        usedGB:       round(usedMem  / 1e9),
        freeGB:       round(freeMem  / 1e9),
        usagePercent: round((usedMem / totalMem) * 100),
      },
      disks,
      gpu,
      uptime:   os.uptime(),
      hostname: os.hostname(),
      platform: os.platform(),
      processes,
    };
  }

  private async getCpuUsage(): Promise<number> {
    // Sample CPU over 500ms for accurate reading
    return new Promise((resolve) => {
      const start = os.cpus().map(cpu => ({ ...cpu.times }));
      setTimeout(() => {
        const end = os.cpus();
        let totalIdle = 0, totalTick = 0;
        end.forEach((cpu, i) => {
          const startTimes = start[i];
          const diff = {
            idle:  cpu.times.idle  - startTimes.idle,
            user:  cpu.times.user  - startTimes.user,
            sys:   cpu.times.sys   - startTimes.sys,
            nice:  cpu.times.nice  - startTimes.nice,
            irq:   cpu.times.irq   - startTimes.irq,
          };
          const total = Object.values(diff).reduce((a, b) => a + b, 0);
          totalIdle += diff.idle;
          totalTick += total;
        });
        resolve(round(((totalTick - totalIdle) / totalTick) * 100));
      }, 500);
    });
  }

  private async getDiskInfo(): Promise<DiskInfo[]> {
    try {
      const { stdout } = await execAsync(
        'wmic logicaldisk get DeviceID,Size,FreeSpace /format:csv',
        { timeout: 5000 }
      );
      const lines = stdout.trim().split('\n').filter(l => l.includes(','));
      const disks: DiskInfo[] = [];

      for (const line of lines) {
        const parts = line.trim().split(',');
        // CSV format: Node,DeviceID,FreeSpace,Size
        if (parts.length < 4) continue;
        const drive    = parts[1]?.trim();
        const freeB    = parseInt(parts[2]?.trim() || '0');
        const totalB   = parseInt(parts[3]?.trim() || '0');
        if (!drive || !totalB) continue;
        const usedB = totalB - freeB;
        disks.push({
          drive,
          totalGB:      round(totalB / 1e9),
          usedGB:       round(usedB  / 1e9),
          freeGB:       round(freeB  / 1e9),
          usagePercent: round((usedB / totalB) * 100),
        });
      }
      return disks;
    } catch {
      return [];
    }
  }

  private async getGpuInfo(): Promise<GpuInfo | null> {
    // Try NVIDIA first
    try {
      const { stdout } = await execAsync(
        'nvidia-smi --query-gpu=name,utilization.gpu,memory.total,memory.used,temperature.gpu --format=csv,noheader,nounits',
        { timeout: 3000 }
      );
      const line = stdout.trim().split('\n')[0];
      if (!line) return null;
      const parts = line.split(',').map((p) => p.trim());
      if (parts.length < 5) return null;
      const [name, usagePct, memTotal, memUsed, tempStr] = parts;
      const memTotalMB = parseInt(memTotal);
      const memUsedMB  = parseInt(memUsed);
      return {
        name,
        usagePercent:    parseInt(usagePct),
        memTotalMB,
        memUsedMB,
        memUsagePercent: round((memUsedMB / memTotalMB) * 100),
        temperatureC:    !isNaN(parseInt(tempStr)) ? parseInt(tempStr) : null,
      };
    } catch { /* nvidia-smi not available */ }

    // Fallback: basic info via wmic (no usage stats — AMD / Intel / no driver)
    try {
      const { stdout } = await execAsync(
        'wmic path Win32_VideoController get Name,AdapterRAM /format:csv',
        { timeout: 3000 }
      );
      const lines = stdout.trim().split('\n').filter((l) => l.includes(',') && !/^Node/.test(l.trim()));
      if (!lines.length) return null;
      const parts = lines[0].trim().split(',');
      if (parts.length < 3) return null;
      const adapterRam  = parseInt(parts[1]?.trim() || '0');
      const name        = parts[2]?.trim() || 'Unknown GPU';
      const memTotalMB  = Math.round(adapterRam / (1024 * 1024));
      return { name, usagePercent: 0, memTotalMB, memUsedMB: 0, memUsagePercent: 0, temperatureC: null };
    } catch {
      return null;
    }
  }

  private async getProcesses(): Promise<ProcessInfo[]> {
    try {
      const cpuCount = os.cpus().length;
      const { stdout } = await execAsync(
        'wmic path Win32_PerfFormattedData_PerfProc_Process get IDProcess,Name,PercentProcessorTime,WorkingSet64 /format:csv',
        { timeout: 6000 }
      );
      const lines = stdout.trim().split('\n').filter(l => l.includes(',') && !/^Node/i.test(l.trim()));
      const processes: ProcessInfo[] = [];
      for (const line of lines) {
        const parts = line.trim().split(',');
        // CSV: Node, IDProcess, Name, PercentProcessorTime, WorkingSet64
        if (parts.length < 5) continue;
        const pid        = parseInt(parts[1]);
        const name       = parts[2]?.trim();
        const rawCpu     = parseFloat(parts[3]);
        const memBytes   = parseInt(parts[4]);
        if (!name || name === '_Total' || name === 'Idle' || isNaN(pid) || pid === 0) continue;
        // Normalize to 0-100% across all cores (matches Task Manager)
        const cpuPercent = Math.min(100, round(rawCpu / cpuCount));
        processes.push({ pid, name, cpuPercent, memMB: Math.round(memBytes / (1024 * 1024)) });
      }
      // Sort by CPU first, then RAM
      return processes.sort((a, b) => b.cpuPercent - a.cpuPercent || b.memMB - a.memMB).slice(0, 25);
    } catch {
      return [];
    }
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
