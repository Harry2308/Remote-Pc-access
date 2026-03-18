import { Injectable, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { AuthService } from './auth';
import { environment } from '../../environments/environment';

export interface OllamaMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ModelInfo {
  name: string;
  sizeGB: number;
}

export interface RunningModel {
  name: string;
  sizeVramMB: number;
}

export type OllamaEvent =
  | { type: 'models'; models: ModelInfo[] }
  | { type: 'ps'; models: RunningModel[] }
  | { type: 'token'; data: string }
  | { type: 'done'; data: string }
  | { type: 'error'; error: string }
  | { type: 'connected' }
  | { type: 'disconnected' };

@Injectable({ providedIn: 'root' })
export class OllamaWsService implements OnDestroy {
  private ws: WebSocket | null = null;
  readonly events$ = new Subject<OllamaEvent>();

  constructor(private auth: AuthService) {}

  connect(): void {
    if (this.ws) return;
    const token = this.auth.getAccessToken();
    if (!token) return;

    const url = `${environment.wsUrl}/ollama?token=${encodeURIComponent(token)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen  = () => this.events$.next({ type: 'connected' });
    this.ws.onclose = () => { this.events$.next({ type: 'disconnected' }); this.ws = null; };
    this.ws.onerror = () => this.events$.next({ type: 'error', error: 'WebSocket error' });

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type: string;
          models?: ModelInfo[] | RunningModel[];
          data?: string;
          error?: string;
        };
        if (msg.type === 'ollama.models.response') {
          this.events$.next({ type: 'models', models: (msg.models ?? []) as ModelInfo[] });
        } else if (msg.type === 'ollama.ps.response') {
          this.events$.next({ type: 'ps', models: (msg.models ?? []) as RunningModel[] });
        } else if (msg.type === 'ollama.token') {
          this.events$.next({ type: 'token', data: msg.data ?? '' });
        } else if (msg.type === 'ollama.done') {
          this.events$.next({ type: 'done', data: msg.data ?? '' });
        } else if (msg.type === 'ollama.error') {
          this.events$.next({ type: 'error', error: msg.error ?? 'Unknown error' });
        }
      } catch { /* ignore */ }
    };
  }

  chat(model: string, messages: OllamaMessage[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'ollama.chat', model, messages }));
    }
  }

  cancel(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'ollama.cancel' }));
    }
  }

  requestPs(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'ollama.ps' }));
    }
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
