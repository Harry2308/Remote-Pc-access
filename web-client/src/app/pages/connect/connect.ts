import {
  Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef,
} from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, interval } from 'rxjs';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';

type Status = 'checking' | 'offline' | 'waking' | 'connecting' | 'vnc-connected' | 'agent-ready';

@Component({
  selector: 'app-connect',
  standalone: false,
  templateUrl: './connect.html',
  styleUrl: './connect.scss',
})
export class Connect implements OnInit, OnDestroy {
  @ViewChild('vncContainer') vncContainer!: ElementRef<HTMLDivElement>;

  status: Status = 'checking';
  statusMessage = 'Checking PC status...';
  wakeProgress = 0;
  wakeCountdown = 60;

  get isVncVisible(): boolean {
    return this.status === 'connecting' || this.status === 'vnc-connected';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private rfb: any = null;
  private subs = new Subscription();
  private wakeInterval: ReturnType<typeof setInterval> | null = null;
  private vncRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private navigateTimer: ReturnType<typeof setTimeout> | null = null;
  private pollSub: Subscription | null = null;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.startStatusPoll();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.pollSub?.unsubscribe();
    if (this.wakeInterval) clearInterval(this.wakeInterval);
    if (this.vncRetryTimer) clearTimeout(this.vncRetryTimer);
    if (this.navigateTimer) clearTimeout(this.navigateTimer);
    this.disconnectVnc();
  }

  // ── Status polling ──────────────────────────────────────────────────────────

  private startStatusPoll(): void {
    this.pollSub?.unsubscribe();
    this.checkStatus();
    this.pollSub = interval(3000).subscribe(() => this.checkStatus());
  }

  private checkStatus(): void {
    this.api.getStatus().subscribe({
      next: (s) => {
        if (s.agentConnected && this.status !== 'agent-ready' && this.status !== 'vnc-connected') {
          this.setStatus('agent-ready', 'PC agent connected!');
          this.stopWake();
        } else if (!s.agentConnected && this.status === 'checking') {
          this.setStatus('offline', 'PC is offline');
        }
      },
      error: () => {
        if (this.status === 'checking') this.setStatus('offline', 'PC is offline');
      },
    });
  }

  // ── Wake Up ─────────────────────────────────────────────────────────────────

  wakeUp(): void {
    this.setStatus('waking', 'Sending Wake-on-LAN...');
    this.wakeProgress = 0;
    this.wakeCountdown = 60;

    this.api.wake().subscribe({
      next: () => this.setStatus('waking', 'WoL packet sent — waiting for PC to boot (~60s)...'),
      error: () => this.setStatus('waking', 'WoL sent — waiting for PC to boot (~60s)...'),
    });

    let elapsed = 0;
    this.wakeInterval = setInterval(() => {
      elapsed++;
      this.wakeCountdown = Math.max(0, 60 - elapsed);
      this.wakeProgress = Math.min(100, Math.round((elapsed / 60) * 100));
      this.cdr.detectChanges();
      if (elapsed >= 60) {
        this.stopWake();
        this.setStatus('connecting', 'PC should be up — connecting via VNC...');
        this.tryConnectVnc();
      }
    }, 1000);
  }

  connectNow(): void {
    if (this.navigateTimer) { clearTimeout(this.navigateTimer); this.navigateTimer = null; }
    this.setStatus('connecting', 'Connecting via VNC...');
    this.tryConnectVnc();
  }

  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  private stopWake(): void {
    if (this.wakeInterval) { clearInterval(this.wakeInterval); this.wakeInterval = null; }
  }

  // ── VNC ─────────────────────────────────────────────────────────────────────

  private tryConnectVnc(): void {
    if (this.vncRetryTimer) { clearTimeout(this.vncRetryTimer); this.vncRetryTimer = null; }
    this.api.getVncCredentials().subscribe({
      next: (creds) => this.connectVnc(creds.password),
      error: () => this.scheduleVncRetry(),
    });
  }

  private connectVnc(password: string): void {
    if (!this.vncContainer?.nativeElement) {
      this.scheduleVncRetry();
      return;
    }
    this.disconnectVnc();

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost  = environment.apiUrl.replace(/^https?:\/\//, '');
    const token   = this.auth.getAccessToken() || '';
    const wsUrl   = `${wsProto}//${wsHost}/vnc?token=${encodeURIComponent(token)}`;

    import('@novnc/novnc/lib/rfb').then((mod) => {
      const RFB = mod.default;
      const container = this.vncContainer.nativeElement;
      container.innerHTML = '';

      this.rfb = new RFB(container, wsUrl, { credentials: { password } });
      this.rfb!.scaleViewport = true;
      this.rfb!.resizeSession = false;

      this.rfb!.addEventListener('connect', () => {
        this.setStatus('vnc-connected', 'VNC connected — log in to Windows to start the agent');
      });

      this.rfb!.addEventListener('disconnect', (e: Event) => {
        const clean = (e as CustomEvent).detail?.clean as boolean;
        if (this.status === 'vnc-connected' || this.status === 'connecting') {
          this.setStatus('connecting', clean ? 'VNC session ended — retrying...' : 'VNC connection lost — retrying...');
          this.scheduleVncRetry();
        }
      });

      this.rfb!.addEventListener('credentialsrequired', () => {
        this.rfb!.sendCredentials({ password });
      });

    }).catch(() => this.scheduleVncRetry());
  }

  private scheduleVncRetry(): void {
    this.vncRetryTimer = setTimeout(() => this.tryConnectVnc(), 5000);
  }

  private disconnectVnc(): void {
    if (this.rfb) {
      try { this.rfb.disconnect(); } catch { /* ignore */ }
      this.rfb = null;
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private setStatus(s: Status, msg: string): void {
    this.status = s;
    this.statusMessage = msg;
    this.cdr.detectChanges();
  }
}
