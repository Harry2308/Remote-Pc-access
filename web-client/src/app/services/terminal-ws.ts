import { Injectable, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { AuthService } from './auth';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class TerminalWsService implements OnDestroy {
  private ws: WebSocket | null = null;

  readonly data$ = new Subject<string>();
  readonly connected$ = new Subject<boolean>();

  constructor(private auth: AuthService) {}

  connect(): void {
    if (this.ws) return;

    const token = this.auth.getAccessToken();
    if (!token) return;

    const url = `${environment.wsUrl}/terminal?token=${encodeURIComponent(token)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[terminal-ws] Connected');
      this.connected$.next(true);
    };

    this.ws.onmessage = (event) => {
      this.data$.next(event.data as string);
    };

    this.ws.onclose = () => {
      console.log('[terminal-ws] Disconnected');
      this.connected$.next(false);
      this.ws = null;
    };

    this.ws.onerror = (err) => {
      console.error('[terminal-ws] Error:', err);
    };
  }

  send(data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  resize(cols: number, rows: number): void {
    this.send(JSON.stringify({ type: 'terminal.resize', cols, rows }));
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
