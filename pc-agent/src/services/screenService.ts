/**
 * ScreenService — captures the desktop and streams JPEG frames via a callback.
 *
 * Uses a persistent PowerShell child process that compiles a C# GDI wrapper once,
 * then runs a continuous capture loop. Frames are written to stdout as:
 *   [4-byte LE length][JPEG bytes]
 *
 * This avoids spawning a new process per frame (the old screenshot-desktop approach
 * had ~150 ms overhead per frame, limiting FPS to ~4-5). With a persistent process
 * the actual GDI capture + JPEG encode takes ~20-40 ms, allowing 15-25 fps.
 */
import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';

const SCREEN_LOG = join(process.cwd(), 'screen-capture.log');
function slog(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log('[screen] ' + msg);
  try { appendFileSync(SCREEN_LOG, line); } catch { /* ignore */ }
}

// PowerShell script: compiles C# GDI capture once, then loops at target FPS.
// Captures at native resolution, scales down to $maxW wide (default 1280) before
// JPEG encoding — this cuts encode time from ~40 ms to ~12 ms, enabling 20+ fps.
// Frames are written to stdout as 4-byte LE length + JPEG bytes.
const PS_CAPTURE_SCRIPT = String.raw`
param([int]$fps = 20, [int]$quality = 70, [int]$maxW = 1280)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$screen     = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$rawOut     = [System.Console]::OpenStandardOutput()
$intervalMs = [int][Math]::Max(33, [Math]::Round(1000.0 / $fps))

# Scale target: keep aspect ratio, cap width at $maxW
if ($maxW -gt 0 -and $screen.Width -gt $maxW) {
    $tW = $maxW
    $tH = [int]($screen.Height * $maxW / $screen.Width)
} else {
    $tW = $screen.Width
    $tH = $screen.Height
}

# Full-res capture bitmap (reused every frame)
$capBmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppRgb)
$capG   = [System.Drawing.Graphics]::FromImage($capBmp)

# Scaled output bitmap (what gets JPEG-encoded)
$outBmp = New-Object System.Drawing.Bitmap($tW, $tH)
$outG   = [System.Drawing.Graphics]::FromImage($outBmp)
$outG.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Bilinear
$needsScale = ($tW -ne $screen.Width)

$encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
    [System.Drawing.Imaging.Encoder]::Quality, [long]$quality)
$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1

while ($true) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()

    try {
        $capG.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
    } catch {
        Start-Sleep -Milliseconds 500
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        continue
    }

    if ($needsScale) {
        $outG.DrawImage($capBmp, 0, 0, $tW, $tH)
    }

    $ms    = New-Object System.IO.MemoryStream
    $encBmp = if ($needsScale) { $outBmp } else { $capBmp }
    $encBmp.Save($ms, $jpegCodec, $encParams)
    $bytes = $ms.ToArray()
    $ms.Dispose()

    $lenBuf = [System.BitConverter]::GetBytes([int32]$bytes.Length)
    $rawOut.Write($lenBuf, 0, 4)
    $rawOut.Write($bytes, 0, $bytes.Length)
    $rawOut.Flush()

    $sw.Stop()
    $sleep = $intervalMs - $sw.ElapsedMilliseconds
    if ($sleep -gt 0) { Start-Sleep -Milliseconds $sleep }
}

$capG.Dispose(); $capBmp.Dispose()
$outG.Dispose(); $outBmp.Dispose()
`;

export interface ScreenOptions {
  fps: number;
  quality: number;
}

export type FrameCallback = (jpeg: Buffer) => void;

export class ScreenService {
  private ps: ChildProcess | null = null;
  private scriptPath: string;
  private frameCallback: FrameCallback | null = null;
  private readBuf = Buffer.alloc(0);
  private frameCount = 0;

  constructor() {
    this.scriptPath = join(process.cwd(), '.screen-capture.ps1');
  }

  start(onFrame: FrameCallback, opts: ScreenOptions = { fps: 10, quality: 70 }): void {
    this.stop();
    this.frameCallback = onFrame;
    this.readBuf = Buffer.alloc(0);
    this.frameCount = 0;

    const fps     = Math.min(30, Math.max(1, opts.fps));
    const quality = Math.min(95, Math.max(20, opts.quality));
    const maxW    = 1280; // scale down to 1280px wide before JPEG encode (~3× faster)

    slog(`Started — target ${fps} fps, quality ${quality}, maxW ${maxW} (persistent GDI mode)`);

    try {
      writeFileSync(this.scriptPath, PS_CAPTURE_SCRIPT, { encoding: 'utf-8' });

      this.ps = spawn('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', this.scriptPath,
        '-fps',     String(fps),
        '-quality', String(quality),
        '-maxW',    String(maxW),
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      this.ps.stdout!.on('data', (chunk: Buffer) => this.handleData(chunk));

      this.ps.stderr!.on('data', (d: Buffer) => {
        slog('PS stderr: ' + d.toString().trim());
      });

      this.ps.on('exit', (code) => {
        if (this.frameCallback) {
          // Only log + restart if we're still supposed to be running
          slog(`Capture process exited (${code}) — restarting in 2 s`);
          setTimeout(() => {
            if (this.frameCallback) this.start(this.frameCallback, opts);
          }, 2000);
        }
      });

    } catch (err) {
      slog('ERROR starting capture process: ' + err);
    }
  }

  private handleData(chunk: Buffer): void {
    this.readBuf = Buffer.concat([this.readBuf, chunk]);

    while (this.readBuf.length >= 4) {
      const frameLen = this.readBuf.readUInt32LE(0);

      if (frameLen <= 0 || frameLen > 10_000_000) {
        slog(`WARN: bad frame length ${frameLen} — resetting buffer`);
        this.readBuf = Buffer.alloc(0);
        break;
      }

      if (this.readBuf.length < 4 + frameLen) break;

      const frame = Buffer.from(this.readBuf.subarray(4, 4 + frameLen));
      this.readBuf = this.readBuf.subarray(4 + frameLen);

      this.frameCount++;
      if (this.frameCount === 1 || this.frameCount % 100 === 0) {
        slog(`Frame #${this.frameCount} — ${frame.length} bytes`);
      }

      this.frameCallback?.(frame);
    }
  }

  stop(): void {
    this.frameCallback = null;
    if (this.ps) {
      try { this.ps.kill(); } catch { /* ignore */ }
      this.ps = null;
      slog('Stopped');
    }
  }

  isRunning(): boolean {
    return this.ps !== null;
  }
}
