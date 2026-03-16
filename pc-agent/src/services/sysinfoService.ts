import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
    const [cpuUsage, disks, processes] = await Promise.all([
      this.getCpuUsage(),
      this.getDiskInfo(),
      this.getProcesses(),
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

  private async getProcesses(): Promise<ProcessInfo[]> {
    try {
      const { stdout } = await execAsync(
        'tasklist /fo csv /nh',
        { timeout: 5000 }
      );
      const processes: ProcessInfo[] = [];
      for (const line of stdout.trim().split('\n').slice(0, 20)) {
        // CSV: "Name","PID","Session Name","Session#","Mem Usage"
        const match = line.match(/"([^"]+)","(\d+)","[^"]+","[^"]+","([^"]+)"/);
        if (!match) continue;
        const memStr = match[3].replace(/[^0-9]/g, '');
        processes.push({
          name:       match[1],
          pid:        parseInt(match[2]),
          cpuPercent: 0, // tasklist doesn't include CPU% — would need wmic
          memMB:      Math.round(parseInt(memStr) / 1024),
        });
      }
      return processes.sort((a, b) => b.memMB - a.memMB).slice(0, 15);
    } catch {
      return [];
    }
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
