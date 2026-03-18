import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subscription } from 'rxjs';
import { ApiService, StatusResponse } from '../../services/api';
import { AuthService } from '../../services/auth';
import { SysinfoService, SysInfo } from '../../services/sysinfo';

@Component({
  selector: 'app-dashboard',
  standalone: false,
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements OnInit, OnDestroy {
  status: StatusResponse | null = null;
  sysinfo: SysInfo | null = null;
  loading = false;
  actionInProgress: string | null = null;
  private subs = new Subscription();

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private sysinfoService: SysinfoService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.refreshStatus();
    this.sysinfoService.connect();
    this.subs.add(
      this.sysinfoService.live$.subscribe((info) => (this.sysinfo = info))
    );
  }

  refreshStatus(): void {
    this.loading = true;
    this.api.getStatus().subscribe({
      next: (s) => { this.status = s; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  wake():     void { this.runAction('wake',     () => this.api.wake()); }
  sleep():    void { this.runAction('sleep',    () => this.api.sleep()); }
  shutdown(): void { this.runAction('shutdown', () => this.api.shutdown()); }
  restart():  void { this.runAction('restart',  () => this.api.restart()); }

  openTerminal(): void { this.router.navigate(['/terminal']); }
  openAiChat():   void { this.router.navigate(['/ai']); }
  logout():       void { this.auth.logout(); }

  formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  private runAction(name: string, fn: () => ReturnType<ApiService['wake']>): void {
    if (this.actionInProgress) return;
    this.actionInProgress = name;
    fn().subscribe({
      next: (res) => {
        this.actionInProgress = null;
        this.snackBar.open(res.message, 'Close', { duration: 3000 });
        setTimeout(() => this.refreshStatus(), 2000);
      },
      error: (err) => {
        this.actionInProgress = null;
        this.snackBar.open(err?.error?.error || `${name} failed`, 'Close', { duration: 4000 });
      },
    });
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.sysinfoService.disconnect();
  }
}
