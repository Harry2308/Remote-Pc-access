/**
 * InputService — simulates mouse and keyboard input on Windows.
 * Uses a persistent PowerShell child process that compiles a C# Win32 wrapper once
 * on startup, then reads commands from stdin. No native npm modules required.
 */
import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// PowerShell script that stays alive and reads commands from stdin
const PS_SCRIPT = String.raw`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinInput {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, int data, IntPtr extra);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
    public const uint LDOWN=2,LUP=4,RDOWN=8,RUP=16,WHEEL=2048,MOVE=1;
    public const uint KUP=2;
}
"@
$reader = New-Object System.IO.StreamReader([System.Console]::OpenStandardInput())
while ($true) {
    $line = $reader.ReadLine()
    if ($null -eq $line) { break }
    $p = $line.Trim().Split(',')
    switch ($p[0]) {
        'move'     { [WinInput]::SetCursorPos([int]$p[1], [int]$p[2]) | Out-Null }
        'click'    {
            [WinInput]::SetCursorPos([int]$p[1], [int]$p[2]) | Out-Null
            [WinInput]::mouse_event([WinInput]::LDOWN, 0,0,0,[IntPtr]::Zero)
            [WinInput]::mouse_event([WinInput]::LUP,   0,0,0,[IntPtr]::Zero) }
        'rclick'   {
            [WinInput]::SetCursorPos([int]$p[1], [int]$p[2]) | Out-Null
            [WinInput]::mouse_event([WinInput]::RDOWN, 0,0,0,[IntPtr]::Zero)
            [WinInput]::mouse_event([WinInput]::RUP,   0,0,0,[IntPtr]::Zero) }
        'dblclick' {
            [WinInput]::SetCursorPos([int]$p[1], [int]$p[2]) | Out-Null
            [WinInput]::mouse_event([WinInput]::LDOWN, 0,0,0,[IntPtr]::Zero)
            [WinInput]::mouse_event([WinInput]::LUP,   0,0,0,[IntPtr]::Zero)
            Start-Sleep -Milliseconds 60
            [WinInput]::mouse_event([WinInput]::LDOWN, 0,0,0,[IntPtr]::Zero)
            [WinInput]::mouse_event([WinInput]::LUP,   0,0,0,[IntPtr]::Zero) }
        'scroll'   { [WinInput]::mouse_event([WinInput]::WHEEL, 0,0,[int]$p[1],[IntPtr]::Zero) }
        'kdown'    { [WinInput]::keybd_event([byte][int]$p[1], 0, 0,           [IntPtr]::Zero) }
        'kup'      { [WinInput]::keybd_event([byte][int]$p[1], 0, [WinInput]::KUP, [IntPtr]::Zero) }
    }
}
`;

export class InputService {
  private ps: ChildProcess | null = null;
  private scriptPath: string;

  constructor() {
    this.scriptPath = join(process.cwd(), '.input-sim.ps1');
    this.start();
  }

  private start(): void {
    try {
      writeFileSync(this.scriptPath, PS_SCRIPT, { encoding: 'utf-8' });
      this.ps = spawn('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', this.scriptPath,
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      this.ps.stdout?.on('data', () => { /* discard */ });
      this.ps.stderr?.on('data', (d: Buffer) => {
        console.error('[input] PS error:', d.toString().trim());
      });
      this.ps.on('exit', (code) => {
        console.warn(`[input] PS process exited (${code}) — restarting in 2s`);
        this.ps = null;
        setTimeout(() => this.start(), 2000);
      });
      console.log('[input] Input simulator ready');
    } catch (err) {
      console.error('[input] Failed to start input simulator:', err);
    }
  }

  private send(cmd: string): void {
    if (!this.ps?.stdin?.writable) {
      console.warn('[input] stdin not writable — dropping cmd:', cmd);
      return;
    }
    try { this.ps.stdin.write(cmd + '\n'); } catch (e) {
      console.error('[input] stdin write error:', e);
    }
  }

  moveMouse(x: number, y: number): void  { this.send(`move,${x},${y}`); }
  click(x: number, y: number): void      { this.send(`click,${x},${y}`); }
  rightClick(x: number, y: number): void { this.send(`rclick,${x},${y}`); }
  doubleClick(x: number, y: number): void { this.send(`dblclick,${x},${y}`); }
  scroll(delta: number): void            { this.send(`scroll,${delta}`); }
  keyDown(vk: number): void              { this.send(`kdown,${vk}`); }
  keyUp(vk: number): void                { this.send(`kup,${vk}`); }

  stop(): void {
    this.ps?.stdin?.end();
    this.ps?.kill();
    this.ps = null;
  }
}
