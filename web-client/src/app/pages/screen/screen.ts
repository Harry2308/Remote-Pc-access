import {
  Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit,
  ChangeDetectorRef, HostListener,
} from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, interval } from 'rxjs';
import { ScreenWsService } from '../../services/screen-ws';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';

type ConnStatus = 'checking' | 'offline' | 'waking' | 'connecting' | 'vnc-connected' | 'agent-ready';

// Map browser KeyboardEvent.code → Windows Virtual Key code
function codeToVK(code: string): number {
  if (/^Key([A-Z])$/.test(code))    return code.charCodeAt(3);
  if (/^Digit(\d)$/.test(code))     return 0x30 + parseInt(code[5]);
  if (/^Numpad(\d)$/.test(code))    return 0x60 + parseInt(code[6]);
  if (/^F(\d{1,2})$/.test(code)) {
    const n = parseInt(code.slice(1));
    return n >= 1 && n <= 12 ? 0x6F + n : 0;
  }
  if (code === 'Enter' || code === 'NumpadEnter') return 13;
  if (code === 'Backspace') return 8;
  const m: Record<string, number> = {
    Tab:9, ShiftLeft:16, ShiftRight:16,
    ControlLeft:17, ControlRight:17, AltLeft:18, AltRight:18,
    Pause:19, CapsLock:20, Escape:27, Space:32,
    PageUp:33, PageDown:34, End:35, Home:36,
    ArrowLeft:37, ArrowUp:38, ArrowRight:39, ArrowDown:40,
    PrintScreen:44, Insert:45, Delete:46,
    MetaLeft:91, MetaRight:92, ContextMenu:93,
    NumpadMultiply:106, NumpadAdd:107, NumpadSubtract:109,
    NumpadDecimal:110, NumpadDivide:111,
    NumLock:144, ScrollLock:145,
    Semicolon:186, Equal:187, Comma:188, Minus:189, Period:190,
    Slash:191, Backquote:192, BracketLeft:219, Backslash:220,
    BracketRight:221, Quote:222,
  };
  return m[code] ?? 0;
}

@Component({
  selector: 'app-screen',
  standalone: false,
  templateUrl: './screen.html',
  styleUrl: './screen.scss',
})
export class Screen implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('canvas')     canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('vncContainer') vncContainer!: ElementRef<HTMLDivElement>;

  // ── Connection state ───────────────────────────────────────────────────────
  connStatus: ConnStatus = 'checking';
  statusMessage = 'Checking PC status...';
  wakeProgress  = 0;
  wakeCountdown = 60;

  get isVncVisible(): boolean {
    return this.connStatus === 'connecting' || this.connStatus === 'vnc-connected';
  }

  // ── Screen-capture state ───────────────────────────────────────────────────
  connected   = false;
  actualFps   = 0;
  fps         = 15;
  quality     = 70;
  fullscreen  = false;
  latencyMs   = 0;
  interactMode = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private rfb: any = null;
  private sub          = new Subscription();
  private pollSub: Subscription | null = null;
  private wakeInterval: ReturnType<typeof setInterval>  | null = null;
  private vncRetryTimer: ReturnType<typeof setTimeout>  | null = null;

  private ctx!: CanvasRenderingContext2D;
  private lastFrameTs = 0;
  private moveThrottle = 0;

  constructor(
    private screenWs: ScreenWsService,
    private api: ApiService,
    private auth: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.sub.add(this.screenWs.connected$.subscribe((c) => {
      this.connected = c;
      this.cdr.detectChanges();
    }));
    this.sub.add(this.screenWs.fps$.subscribe((f) => {
      this.actualFps = f;
      this.cdr.detectChanges();
    }));
    this.sub.add(this.screenWs.frame$.subscribe((url) => this.drawFrame(url)));
    this.startStatusPoll();
  }

  ngAfterViewInit(): void {
    if (this.canvasRef?.nativeElement) {
      this.ctx = this.canvasRef.nativeElement.getContext('2d')!;
    }
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
    this.pollSub?.unsubscribe();
    if (this.wakeInterval)  clearInterval(this.wakeInterval);
    if (this.vncRetryTimer) clearTimeout(this.vncRetryTimer);
    this.disconnectVnc();
    this.screenWs.disconnect();
  }

  // ── Status polling ─────────────────────────────────────────────────────────

  private startStatusPoll(): void {
    this.pollSub?.unsubscribe();
    this.checkStatus();
    this.pollSub = interval(3000).subscribe(() => this.checkStatus());
  }

  private checkStatus(): void {
    this.api.getStatus().subscribe({
      next: (s) => {
        if (s.agentConnected) {
          // Don't interrupt an active VNC session or an in-progress connection
          const isVncActive = this.connStatus === 'connecting' || this.connStatus === 'vnc-connected';
          if (!isVncActive && this.connStatus !== 'agent-ready') {
            this.setConnStatus('agent-ready', 'Agent connected');
            this.stopWake();
            this.screenWs.connect(this.fps, this.quality);
          }
        } else {
          if (this.connStatus === 'agent-ready') {
            this.setConnStatus('offline', 'PC is offline');
            this.screenWs.disconnect();
          } else if (this.connStatus === 'checking') {
            this.setConnStatus('offline', 'PC is offline');
          }
        }
      },
      error: () => {
        if (this.connStatus === 'checking') this.setConnStatus('offline', 'PC is offline');
      },
    });
  }

  // ── Wake on LAN ────────────────────────────────────────────────────────────

  wakeUp(): void {
    this.setConnStatus('waking', 'Sending Wake-on-LAN...');
    this.wakeProgress = 0;
    this.wakeCountdown = 60;

    this.api.wake().subscribe({
      next:  () => this.setConnStatus('waking', 'WoL packet sent — waiting for PC to boot (~60s)...'),
      error: () => this.setConnStatus('waking', 'WoL sent — waiting for PC to boot (~60s)...'),
    });

    let elapsed = 0;
    this.wakeInterval = setInterval(() => {
      elapsed++;
      this.wakeCountdown = Math.max(0, 60 - elapsed);
      this.wakeProgress  = Math.min(100, Math.round((elapsed / 60) * 100));
      this.cdr.detectChanges();
      if (elapsed >= 60) {
        this.stopWake();
        this.setConnStatus('connecting', 'PC should be up — connecting via VNC...');
        this.tryConnectVnc();
      }
    }, 1000);
  }

  connectVncNow(): void {
    this.setConnStatus('connecting', 'Connecting via VNC...');
    this.tryConnectVnc();
  }

  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  private stopWake(): void {
    if (this.wakeInterval) { clearInterval(this.wakeInterval); this.wakeInterval = null; }
  }

  // ── VNC ────────────────────────────────────────────────────────────────────

  private tryConnectVnc(): void {
    if (this.vncRetryTimer) { clearTimeout(this.vncRetryTimer); this.vncRetryTimer = null; }
    this.api.getVncCredentials().subscribe({
      next:  (creds) => this.startVnc(creds.password),
      error: () => this.scheduleVncRetry(),
    });
  }

  private startVnc(password: string): void {
    if (!this.vncContainer?.nativeElement) { this.scheduleVncRetry(); return; }
    this.disconnectVnc();

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost  = environment.apiUrl.replace(/^https?:\/\//, '');
    const token   = this.auth.getAccessToken() || '';
    const wsUrl   = `${wsProto}//${wsHost}/vnc?token=${encodeURIComponent(token)}`;

    import('@novnc/novnc/lib/rfb').then((mod) => {
      const RFB = mod.default;
      this.vncContainer.nativeElement.innerHTML = '';
      this.rfb = new RFB(this.vncContainer.nativeElement, wsUrl, { credentials: { password } });
      this.rfb.scaleViewport = true;
      this.rfb.resizeSession = false;

      this.rfb.addEventListener('connect', () => {
        this.setConnStatus('vnc-connected', 'VNC connected');
      });
      this.rfb.addEventListener('disconnect', (e: Event) => {
        const clean = (e as CustomEvent).detail?.clean as boolean;
        if (this.connStatus === 'vnc-connected' || this.connStatus === 'connecting') {
          this.setConnStatus('connecting', clean ? 'VNC session ended — retrying...' : 'VNC lost — retrying...');
          this.scheduleVncRetry();
        }
      });
      this.rfb.addEventListener('credentialsrequired', () => {
        this.rfb.sendCredentials({ password });
      });
    }).catch(() => this.scheduleVncRetry());
  }

  disconnectVnc(): void {
    if (this.rfb) {
      try { this.rfb.disconnect(); } catch { /* ignore */ }
      this.rfb = null;
    }
    if (this.connStatus === 'vnc-connected' || this.connStatus === 'connecting') {
      this.setConnStatus('offline', 'PC is offline');
    }
  }

  private scheduleVncRetry(): void {
    this.vncRetryTimer = setTimeout(() => this.tryConnectVnc(), 5000);
  }

  // ── Screen capture ─────────────────────────────────────────────────────────

  private drawFrame(url: string): void {
    const sentTs = this.lastFrameTs;
    this.lastFrameTs = performance.now();
    if (sentTs > 0) this.latencyMs = Math.round(this.lastFrameTs - sentTs);

    if (!this.ctx && this.canvasRef?.nativeElement) {
      this.ctx = this.canvasRef.nativeElement.getContext('2d')!;
    }
    if (!this.ctx) return;

    const img = new Image();
    img.onload = () => {
      const canvas = this.canvasRef.nativeElement;
      if (canvas.width  !== img.width)  canvas.width  = img.width;
      if (canvas.height !== img.height) canvas.height = img.height;
      this.ctx.drawImage(img, 0, 0);
    };
    img.src = url;
  }

  private scale(event: MouseEvent): { x: number; y: number } {
    const canvas = this.canvasRef.nativeElement;
    const rect   = canvas.getBoundingClientRect();
    return {
      x: Math.round(event.offsetX * (canvas.width  / rect.width)),
      y: Math.round(event.offsetY * (canvas.height / rect.height)),
    };
  }

  onCanvasClick(event: MouseEvent): void {
    if (!this.interactMode || !this.connected) return;
    const { x, y } = this.scale(event);
    this.screenWs.sendInput({ type: 'input.mouse', action: 'click', x, y });
    this.canvasRef.nativeElement.focus();
  }

  onCanvasDblClick(event: MouseEvent): void {
    if (!this.interactMode || !this.connected) return;
    const { x, y } = this.scale(event);
    this.screenWs.sendInput({ type: 'input.mouse', action: 'dblclick', x, y });
  }

  onCanvasContextMenu(event: MouseEvent): void {
    if (!this.interactMode || !this.connected) return;
    event.preventDefault();
    const { x, y } = this.scale(event);
    this.screenWs.sendInput({ type: 'input.mouse', action: 'rclick', x, y });
  }

  onCanvasMouseMove(event: MouseEvent): void {
    if (!this.interactMode || !this.connected) return;
    const now = Date.now();
    if (now - this.moveThrottle < 40) return;
    this.moveThrottle = now;
    const { x, y } = this.scale(event);
    this.screenWs.sendInput({ type: 'input.mouse', action: 'move', x, y });
  }

  onCanvasWheel(event: WheelEvent): void {
    if (!this.interactMode || !this.connected) return;
    event.preventDefault();
    const delta = Math.round(-event.deltaY / Math.abs(event.deltaY || 1)) * 120;
    this.screenWs.sendInput({ type: 'input.mouse', action: 'scroll', x: 0, y: 0, delta });
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (!this.interactMode || !this.connected) return;
    if (event.ctrlKey && ['w','t','n','r'].includes(event.key.toLowerCase())) return;
    const vk = codeToVK(event.code);
    if (!vk) return;
    event.preventDefault();
    this.screenWs.sendInput({ type: 'input.key', vk, down: true });
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent): void {
    if (!this.interactMode || !this.connected) return;
    const vk = codeToVK(event.code);
    if (!vk) return;
    event.preventDefault();
    this.screenWs.sendInput({ type: 'input.key', vk, down: false });
  }

  // ── Controls ───────────────────────────────────────────────────────────────

  toggleInteract(): void {
    this.interactMode = !this.interactMode;
    if (this.interactMode) this.canvasRef.nativeElement.focus();
  }

  applySettings(): void {
    this.screenWs.updateSettings({ fps: this.fps, quality: this.quality });
  }

  reconnect(): void {
    this.screenWs.disconnect();
    setTimeout(() => this.screenWs.connect(this.fps, this.quality), 500);
  }

  toggleFullscreen(): void {
    const el = this.canvasRef.nativeElement;
    if (!document.fullscreenElement) {
      el.requestFullscreen();
      this.fullscreen = true;
    } else {
      document.exitFullscreen();
      this.fullscreen = false;
    }
  }

  private setConnStatus(s: ConnStatus, msg: string): void {
    this.connStatus = s;
    this.statusMessage = msg;
    this.cdr.detectChanges();
  }
}
