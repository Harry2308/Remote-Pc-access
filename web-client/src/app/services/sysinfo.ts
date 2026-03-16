import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface SysInfo {
  cpu: { model: string; cores: number; usagePercent: number };
  ram: { totalGB: number; usedGB: number; freeGB: number; usagePercent: number };
  disks: { drive: string; totalGB: number; usedGB: number; freeGB: number; usagePercent: number }[];
  uptime: number;
  hostname: string;
  platform: string;
  processes: { pid: number; name: string; cpuPercent: number; memMB: number }[];
}

@Injectable({ providedIn: 'root' })
export class SysinfoService {
  constructor(private http: HttpClient) {}

  get(): Observable<SysInfo> {
    return this.http.get<SysInfo>(`${environment.apiUrl}/api/sysinfo`);
  }
}
