import * as pty from 'node-pty';

interface Session {
  pty: pty.IPty;
  sessionId: string;
}

export class TerminalService {
  private sessions = new Map<string, Session>();
  private shell = process.env.ALLOWED_SHELL || 'powershell';

  openSession(sessionId: string, onData: (data: string) => void): void {
    if (this.sessions.has(sessionId)) {
      console.warn(`[terminal] Session already exists: ${sessionId}`);
      return;
    }

    const shellExe = this.shell === 'powershell' ? 'powershell.exe' : 'cmd.exe';
    const shellArgs = this.shell === 'powershell' ? ['-NoLogo'] : [];

    try {
      const terminal = pty.spawn(shellExe, shellArgs, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.env.USERPROFILE || 'C:\\Users',
        env: process.env as { [key: string]: string },
      });

      terminal.onData((data) => onData(data));

      terminal.onExit(({ exitCode }) => {
        console.log(`[terminal] Session ${sessionId} exited with code ${exitCode}`);
        this.sessions.delete(sessionId);
      });

      this.sessions.set(sessionId, { pty: terminal, sessionId });
      console.log(`[terminal] Session opened: ${sessionId} (${shellExe})`);
    } catch (err) {
      console.error(`[terminal] Failed to open session ${sessionId}:`, err);
    }
  }

  writeToSession(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.pty.write(data);
  }

  resizeSession(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.pty.resize(cols, rows);
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.pty.kill();
    this.sessions.delete(sessionId);
    console.log(`[terminal] Session closed: ${sessionId}`);
  }

  closeAll(): void {
    for (const [sessionId] of this.sessions) {
      this.closeSession(sessionId);
    }
  }
}
