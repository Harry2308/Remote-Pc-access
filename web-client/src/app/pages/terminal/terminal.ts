import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Subscription } from 'rxjs';
import { TerminalWsService } from '../../services/terminal-ws';

@Component({
  selector: 'app-terminal',
  standalone: false,
  templateUrl: './terminal.html',
  styleUrl: './terminal.scss',
})
export class Terminal implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('termContainer') termContainer!: ElementRef<HTMLDivElement>;

  connected = false;
  private xterm!: XTerm;
  private fitAddon!: FitAddon;
  private subs = new Subscription();

  constructor(private ws: TerminalWsService, private router: Router) {}

  ngOnInit(): void {
    this.subs.add(
      this.ws.connected$.subscribe((c) => {
        this.connected = c;
        if (!c) {
          this.xterm?.writeln('\r\n\x1b[31m[disconnected]\x1b[0m');
        }
      })
    );

    this.subs.add(
      this.ws.data$.subscribe((data) => {
        this.xterm?.write(data);
      })
    );
  }

  ngAfterViewInit(): void {
    this.xterm = new XTerm({
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
      },
      fontFamily: '"Cascadia Code", "Fira Code", monospace',
      fontSize: 14,
      cursorBlink: true,
      convertEol: true,
    });

    this.fitAddon = new FitAddon();
    this.xterm.loadAddon(this.fitAddon);
    this.xterm.loadAddon(new WebLinksAddon());
    this.xterm.open(this.termContainer.nativeElement);
    this.fitAddon.fit();

    this.xterm.onData((data) => this.ws.send(data));
    this.xterm.onResize(({ cols, rows }) => this.ws.resize(cols, rows));

    window.addEventListener('resize', () => this.fitAddon.fit());

    this.ws.connect();
  }

  goBack(): void {
    this.ws.disconnect();
    this.router.navigate(['/dashboard']);
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.xterm?.dispose();
    window.removeEventListener('resize', () => this.fitAddon.fit());
  }
}
