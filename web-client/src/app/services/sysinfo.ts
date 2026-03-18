import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth';

export interface GpuInfo {
  name: string;
  usagePercent: number;
  memTotalMB: number;
  memUsedMB: number;
  memUsagePercent: number;
  temperatureC: number | null;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpuPercent: number;
  memMB: number;
}

export interface SysInfo {
  cpu: { model: string; cores: number; usagePercent: number };
  ram: { totalGB: number; usedGB: number; freeGB: number; usagePercent: number };
  disks: { drive: string; totalGB: number; usedGB: number; freeGB: number; usagePercent: number }[];
  gpu: GpuInfo | null;
  uptime: number;
  hostname: string;
  platform: string;
  processes: ProcessInfo[];
}

@Injectable({ providedIn: 'root' })
export class SysinfoService implements OnDestroy {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscribers = 0;

  private readonly _live$ = new Subject<SysInfo>();
  readonly live$: Observable<SysInfo> = this._live$.asObservable();

  constructor(private http: HttpClient, private auth: AuthService) {}

  /** Call when a component wants live updates. Returns an unsubscribe fn. */
  connect(): void {
    this.subscribers++;
    if (this.ws) return; // already connected
    this._openSocket();
  }

  disconnect(): void {
    this.subscribers = Math.max(0, this.subscribers - 1);
    if (this.subscribers > 0) return;
    this._closeSocket();
  }

  /** One-shot HTTP fetch (used by REST fallback if needed). */
  get(): Observable<SysInfo> {
    return this.http.get<SysInfo>(`${environment.apiUrl}/api/sysinfo`);
  }

  private _openSocket(): void {
    const token = this.auth.getAccessToken();
    if (!token) return;
    const url = `${environment.wsUrl}/sysinfo?token=${encodeURIComponent(token)}`;
    this.ws = new WebSocket(url);

    this.ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'sysinfo.push') this._live$.next(msg.data as SysInfo);
      } catch { /* ignore */ }
    };

    this.ws.onclose = () => {
      this.ws = null;
      if (this.subscribers > 0) {
        this.reconnectTimer = setTimeout(() => this._openSocket(), 3000);
      }
    };

    this.ws.onerror = () => { this.ws?.close(); };
  }

  private _closeSocket(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.close();
    this.ws = null;
  }

  ngOnDestroy(): void { this._closeSocket(); }
}
