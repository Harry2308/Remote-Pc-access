import {
  Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, ChangeDetectorRef,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { ScreenWsService } from '../../services/screen-ws';

@Component({
  selector: 'app-screen',
  standalone: false,
  templateUrl: './screen.html',
  styleUrl: './screen.scss',
})
export class Screen implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  connected  = false;
  actualFps  = 0;
  fps        = 10;
  quality    = 70;
  fullscreen = false;
  latencyMs  = 0;

  private sub    = new Subscription();
  private ctx!: CanvasRenderingContext2D;
  private lastFrameTs = 0;

  constructor(private screenWs: ScreenWsService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.sub.add(
      this.screenWs.connected$.subscribe((c) => {
        this.connected = c;
        this.cdr.detectChanges();
      })
    );
    this.sub.add(
      this.screenWs.fps$.subscribe((f) => {
        this.actualFps = f;
        this.cdr.detectChanges();
      })
    );
    this.sub.add(
      this.screenWs.frame$.subscribe((url) => this.drawFrame(url))
    );

    this.screenWs.connect(this.fps, this.quality);
  }

  ngAfterViewInit(): void {
    this.ctx = this.canvasRef.nativeElement.getContext('2d')!;
  }

  private drawFrame(url: string): void {
    const sentTs = this.lastFrameTs;
    this.lastFrameTs = performance.now();
    if (sentTs > 0) this.latencyMs = Math.round(this.lastFrameTs - sentTs);

    const img = new Image();
    img.onload = () => {
      const canvas = this.canvasRef.nativeElement;
      if (canvas.width !== img.width)   canvas.width  = img.width;
      if (canvas.height !== img.height) canvas.height = img.height;
      this.ctx.drawImage(img, 0, 0);
      // Object URL already revoked by the service after next frame
    };
    img.src = url;
  }

  applySettings(): void {
    this.screenWs.updateSettings({ fps: this.fps, quality: this.quality });
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

  reconnect(): void {
    this.screenWs.disconnect();
    setTimeout(() => this.screenWs.connect(this.fps, this.quality), 500);
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
    this.screenWs.disconnect();
  }
}
