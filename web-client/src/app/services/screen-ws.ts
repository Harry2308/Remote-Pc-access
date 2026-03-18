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
  private prevObjectUrl: string | null = null;

  readonly frame$     = new Subject<string>();   // revocable object URL
  readonly connected$ = new Subject<boolean>();
  readonly fps$       = new Subject<number>();    // actual measured fps

  private frameCount  = 0;
  private fpsTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private auth: AuthService) {}

  connect(fps = 10, quality = 70): void {
    if (this.ws) return;
    const token = this.auth.getAccessToken();
    if (!token) return;

    const url = `${environment.wsUrl}/screen?token=${encodeURIComponent(token)}&fps=${fps}&quality=${quality}`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen  = () => {
      this.connected$.next(true);
      this.startFpsMeter();
    };
    this.ws.onclose = () => {
      this.connected$.next(false);
      this.stopFpsMeter();
      this.ws = null;
    };
    this.ws.onerror = () => {
      this.connected$.next(false);
      this.stopFpsMeter();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const blob = new Blob([event.data], { type: 'image/jpeg' });
      const url  = URL.createObjectURL(blob);

      // Revoke the previous URL to free memory
      if (this.prevObjectUrl) URL.revokeObjectURL(this.prevObjectUrl);
      this.prevObjectUrl = url;

      this.frameCount++;
      this.frame$.next(url);
    };
  }

  updateSettings(settings: ScreenSettings): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'screen.settings', ...settings }));
    }
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.stopFpsMeter();
    if (this.prevObjectUrl) {
      URL.revokeObjectURL(this.prevObjectUrl);
      this.prevObjectUrl = null;
    }
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
