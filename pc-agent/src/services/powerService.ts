import { exec } from 'child_process';

export class PowerService {
  sleep(): void {
    console.log('[power] Sending sleep command');
    // rundll32 forces sleep (hybrid sleep / hibernate depending on BIOS settings)
    exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0', (err) => {
      if (err) console.error('[power] Sleep failed:', err);
    });
  }

  shutdown(): void {
    console.log('[power] Sending shutdown command');
    // /s = shutdown, /t 10 = 10s delay (cancel with: shutdown /a)
    exec('shutdown /s /t 10', (err) => {
      if (err) console.error('[power] Shutdown failed:', err);
    });
  }

  restart(): void {
    console.log('[power] Sending restart command');
    exec('shutdown /r /t 10', (err) => {
      if (err) console.error('[power] Restart failed:', err);
    });
  }

  cancelShutdown(): void {
    exec('shutdown /a', (err) => {
      if (err) console.error('[power] Cancel shutdown failed:', err);
    });
  }
}
