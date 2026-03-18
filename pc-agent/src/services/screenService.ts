// node-screenshots uses Windows Graphics Capture API.
// NOTE: WGC still requires an interactive desktop session — running in Session 0
// (Windows Service) produces a black screen. The agent must run as a Scheduled Task
// with LogonType=Interactive to capture the real desktop.
import { Monitor } from 'node-screenshots';
import { appendFileSync } from 'fs';
import { join } from 'path';

const SCREEN_LOG = join(process.cwd(), 'screen-capture.log');
function slog(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log('[screen] ' + msg);
  try { appendFileSync(SCREEN_LOG, line); } catch { /* ignore */ }
}

export interface ScreenOptions {
  fps: number;
  quality: number; // 1–100, JPEG quality
}

export type FrameCallback = (jpeg: Buffer) => void;

export class ScreenService {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(onFrame: FrameCallback, opts: ScreenOptions = { fps: 10, quality: 70 }): void {
    this.stop();
    const intervalMs = Math.max(33, Math.round(1000 / opts.fps)); // cap at ~30fps

    let monitor: Monitor;
    try {
      const monitors = Monitor.all();
      if (!monitors.length) {
        slog('ERROR: No monitors found — is this an interactive session?');
        return;
      }
      monitor = monitors[0]; // primary monitor
      slog(`Started — ${opts.fps}fps quality:${opts.quality} monitor:${monitor.width}x${monitor.height}`);
    } catch (err) {
      slog(`ERROR: Failed to initialise monitor capture: ${err}`);
      return;
    }

    let frameCount = 0;
    const capture = async () => {
      try {
        const image = monitor.captureImageSync();
        // node-screenshots types incorrectly declare the quality param as boolean;
        // the runtime function accepts a number — suppress the type error.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const jpeg: Buffer = await (image as any).toJpeg(opts.quality);
        frameCount++;
        if (frameCount === 1 || frameCount % 100 === 0) {
          slog(`Frame #${frameCount} — ${jpeg.length} bytes`);
        }
        onFrame(jpeg);
      } catch (err) {
        slog(`ERROR capturing frame #${frameCount}: ${err}`);
      }
    };

    capture();
    this.timer = setInterval(capture, intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      slog('Stopped');
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }
}
