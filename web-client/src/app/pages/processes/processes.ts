import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { SysinfoService, SysInfo, ProcessInfo } from '../../services/sysinfo';

type SortKey = 'name' | 'cpuPercent' | 'memMB';
type SortDir = 'asc' | 'desc';

@Component({
  selector: 'app-processes',
  standalone: false,
  templateUrl: './processes.html',
  styleUrl: './processes.scss',
})
export class Processes implements OnInit, OnDestroy {
  sysinfo: SysInfo | null = null;
  sortKey: SortKey = 'cpuPercent';
  sortDir: SortDir = 'desc';
  filter = '';
  private subs = new Subscription();

  constructor(private sysinfoService: SysinfoService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.sysinfoService.connect();
    this.subs.add(
      this.sysinfoService.live$.subscribe((info) => {
        this.sysinfo = info;
        this.cdr.detectChanges();
      })
    );
  }

  get processes(): ProcessInfo[] {
    if (!this.sysinfo?.processes) return [];
    let list = this.sysinfo.processes;
    if (this.filter.trim()) {
      const q = this.filter.trim().toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      const mul = this.sortDir === 'asc' ? 1 : -1;
      if (this.sortKey === 'name') return mul * a.name.localeCompare(b.name);
      return mul * (a[this.sortKey] - b[this.sortKey]);
    });
  }

  setSort(key: SortKey): void {
    if (this.sortKey === key) {
      this.sortDir = this.sortDir === 'desc' ? 'asc' : 'desc';
    } else {
      this.sortKey = key;
      this.sortDir = 'desc';
    }
  }

  sortIcon(key: SortKey): string {
    if (this.sortKey !== key) return 'unfold_more';
    return this.sortDir === 'desc' ? 'arrow_downward' : 'arrow_upward';
  }

  cpuColor(pct: number): string {
    if (pct >= 50) return 'warn';
    if (pct >= 20) return 'accent';
    return 'primary';
  }

  trackByPid(_: number, p: ProcessInfo): number { return p.pid; }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.sysinfoService.disconnect();
  }
}
