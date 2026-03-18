import { Component, OnInit, OnDestroy, ViewChild, ChangeDetectorRef } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { MatSidenav } from '@angular/material/sidenav';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { AuthService } from '../services/auth';
import { ApiService } from '../services/api';
import { SysinfoService } from '../services/sysinfo';

@Component({
  selector: 'app-shell',
  standalone: false,
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell implements OnInit, OnDestroy {
  @ViewChild('sidenav') sidenav!: MatSidenav;

  agentConnected = false;
  cpuPercent: number | null = null;
  gpuPercent: number | null = null;
  pageTitle = 'Dashboard';
  isMobile = false;
  private subs = new Subscription();

  navItems = [
    { path: '/screen',     icon: 'desktop_windows',    label: 'Screen'     },
    { path: '/dashboard',  icon: 'dashboard',          label: 'Dashboard'  },
    { path: '/terminal',   icon: 'terminal',           label: 'Terminal'   },
    { path: '/files',      icon: 'folder',             label: 'Files'      },
    { path: '/ai',         icon: 'smart_toy',          label: 'Local AI'   },
    { path: '/processes',  icon: 'monitor_heart',      label: 'Processes'  },
  ];

  private titleMap: Record<string, string> = {
    '/connect':    'Connect',
    '/dashboard':  'Dashboard',
    '/terminal':   'Terminal',
    '/files':      'Files',
    '/ai':         'Local AI',
    '/screen':     'Screen',
    '/processes':  'Processes',
  };

  constructor(
    private auth: AuthService,
    private api: ApiService,
    private sysinfoService: SysinfoService,
    private router: Router,
    private bp: BreakpointObserver,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.subs.add(
      this.bp.observe([Breakpoints.Handset]).subscribe((r) => {
        this.isMobile = r.matches;
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.router.events
        .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
        .subscribe((e) => {
          const base = '/' + e.urlAfterRedirects.split('/')[1];
          this.pageTitle = this.titleMap[base] || 'Remote PC';
          if (this.isMobile && this.sidenav?.opened) this.sidenav.close();
        })
    );

    // Check agent status once at startup
    this.api.getStatus().subscribe({
      next: (s) => { this.agentConnected = s.agentConnected; this.cdr.detectChanges(); },
      error: () => {},
    });

    // Live sysinfo updates via WebSocket
    this.sysinfoService.connect();
    this.subs.add(
      this.sysinfoService.live$.subscribe((info) => {
        this.agentConnected = true;
        this.cpuPercent = info.cpu.usagePercent;
        this.gpuPercent = info.gpu?.usagePercent ?? null;
        this.cdr.detectChanges();
      })
    );
  }

  logout(): void { this.auth.logout(); }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.sysinfoService.disconnect();
  }
}
