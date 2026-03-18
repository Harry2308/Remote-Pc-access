import { Injectable, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { AuthService } from './auth';
import { environment } from '../../environments/environment';

export interface ScreenSettings {
  fps: number;
  quality: number;
}

@Injectable({ providedIn: 'root' })
export class ScreenWsService implements OnDestroy {
  private ws: WebSocket | null = null;

  // Emits decoded ImageBitmap objects — caller must call .close() after drawing
  readonly frame$     = new Subject<ImageBitmap>();
  readonly connected$ = new Subject<boolean>();
  readonly fps$       = new Subject<number>();

  private frameCount  = 0;
  private fpsTimer: ReturnType<typeof setInterval> | null = null;
  // Prevent queuing frames when the previous is still decoding
  private decoding    = false;

  constructor(private auth: AuthService) {}

  connect(fps = 10, quality = 70): void {
    if (this.ws) return;
    const token = this.auth.getAccessToken();
    if (!token) return;

    const url = `${environment.wsUrl}/screen?token=${encodeURIComponent(token)}&fps=${fps}&quality=${quality}`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen  = () => { this.connected$.next(true);  this.startFpsMeter(); };
    this.ws.onclose = () => { this.connected$.next(false); this.stopFpsMeter(); this.ws = null; };
    this.ws.onerror = () => { this.connected$.next(false); this.stopFpsMeter(); };

    this.ws.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return;

      // Drop frame if still decoding the previous one — avoids queuing lag
      if (this.decoding) return;
      this.decoding = true;

      const blob = new Blob([event.data], { type: 'image/jpeg' });
      createImageBitmap(blob)
        .then((bitmap) => {
          this.frameCount++;
          this.frame$.next(bitmap);
        })
        .catch(() => { /* malformed frame — ignore */ })
        .finally(() => { this.decoding = false; });
    };
  }

  updateSettings(settings: ScreenSettings): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'screen.settings', ...settings }));
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendInput(payload: Record<string, any>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.stopFpsMeter();
  }

  private startFpsMeter(): void {
    this.frameCount = 0;
    this.fpsTimer = setInterval(() => {
      this.fps$.next(this.frameCount);
      this.frameCount = 0;
    }, 1000);
  }

  private stopFpsMeter(): void {
    if (this.fpsTimer) { clearInterval(this.fpsTimer); this.fpsTimer = null; }
  }

  ngOnDestroy(): void { this.disconnect(); }
}
