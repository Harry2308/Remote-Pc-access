import { Component, OnInit, OnDestroy, ViewChild, ChangeDetectorRef } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { MatSidenav } from '@angular/material/sidenav';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Subscription, interval } from 'rxjs';
import { startWith, filter } from 'rxjs/operators';
import { AuthService } from '../services/auth';
import { ApiService } from '../services/api';

@Component({
  selector: 'app-shell',
  standalone: false,
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell implements OnInit, OnDestroy {
  @ViewChild('sidenav') sidenav!: MatSidenav;

  agentConnected = false;
  pageTitle = 'Dashboard';
  isMobile = false;
  private subs = new Subscription();

  navItems = [
    { path: '/dashboard', icon: 'dashboard',  label: 'Dashboard' },
    { path: '/terminal',  icon: 'terminal',   label: 'Terminal'  },
    { path: '/files',     icon: 'folder',     label: 'Files'     },
    { path: '/ai',        icon: 'smart_toy',  label: 'Local AI'  },
  ];

  private titleMap: Record<string, string> = {
    '/dashboard': 'Dashboard',
    '/terminal':  'Terminal',
    '/files':     'Files',
    '/ai':        'Local AI',
  };

  constructor(
    private auth: AuthService,
    private api: ApiService,
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

    this.subs.add(
      interval(15000).pipe(startWith(0)).subscribe(() => {
        this.api.getStatus().subscribe({
          next:  (s) => { this.agentConnected = s.agentConnected; this.cdr.detectChanges(); },
          error: ()  => { this.agentConnected = false; this.cdr.detectChanges(); },
        });
      })
    );
  }

  logout(): void { this.auth.logout(); }

  ngOnDestroy(): void { this.subs.unsubscribe(); }
}
