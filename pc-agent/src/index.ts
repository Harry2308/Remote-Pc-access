import 'dotenv/config';
import WebSocket from 'ws';
import { TerminalService } from './services/terminalService';
import { PowerService } from './services/powerService';
import { AppService } from './services/appService';
import { OllamaService } from './services/ollamaService';
import { SysInfoService } from './services/sysinfoService';
import { ScreenService } from './services/screenService';
import * as fileService from './services/fileService';

const RELAY_URL = process.env.RELAY_URL!;
const AGENT_SECRET = process.env.AGENT_SECRET!;
const RECONNECT_INTERVAL = parseInt(process.env.RECONNECT_INTERVAL || '5000', 10);
const SYSINFO_INTERVAL = parseInt(process.env.SYSINFO_INTERVAL || '2000', 10);

const terminalService = new TerminalService();
const powerService    = new PowerService();
const appService      = new AppService();
const ollamaService   = new OllamaService();
const sysinfoService  = new SysInfoService();
const screenService   = new ScreenService();

let ws: WebSocket | null = null;
let sysinfoTimer: ReturnType<typeof setInterval> | null = null;

function connect(): void {
  const url = `${RELAY_URL}/agent?secret=${encodeURIComponent(AGENT_SECRET)}`;
  console.log(`[agent] Connecting to relay: ${RELAY_URL}`);

  ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('[agent] Connected to relay server');
    startSysinfoLoop();
  });

  ws.on('message', (raw) => {
    handleMessage(raw.toString());
  });

  ws.on('close', (code, reason) => {
    console.log(`[agent] Disconnected (${code}: ${reason}). Reconnecting in ${RECONNECT_INTERVAL}ms...`);
    stopSysinfoLoop();
    screenService.stop();
    ws = null;
    setTimeout(connect, RECONNECT_INTERVAL);
  });

  ws.on('error', (err) => {
    console.error('[agent] WebSocket error:', err.message);
  });
}

function send(msg: object): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendBinary(buf: Buffer): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(buf);
  }
}

// Push sysinfo to relay every SYSINFO_INTERVAL ms
function startSysinfoLoop(): void {
  stopSysinfoLoop();
  sysinfoTimer = setInterval(async () => {
    try {
      const info = await sysinfoService.get();
      send({ type: 'sysinfo.push', data: info });
    } catch (err) {
      console.error('[agent] sysinfo error:', err);
    }
  }, SYSINFO_INTERVAL);
}

function stopSysinfoLoop(): void {
  if (sysinfoTimer) {
    clearInterval(sysinfoTimer);
    sysinfoTimer = null;
  }
}

function handleMessage(raw: string): void {
  try {
    const msg = JSON.parse(raw) as { type: string; sessionId?: string; [key: string]: unknown };
    const { type, sessionId } = msg;

    switch (type) {
      // ── Terminal ────────────────────────────────────────────────────────────
      case 'terminal.open':
        if (sessionId) {
          terminalService.openSession(sessionId, (data) => {
            send({ type: 'terminal.data', sessionId, data });
          });
        }
        break;
      case 'terminal.input':
        if (sessionId && typeof msg.data === 'string') {
          terminalService.writeToSession(sessionId, msg.data);
        }
        break;
      case 'terminal.resize':
        if (sessionId) {
          terminalService.resizeSession(
            sessionId,
            (msg.cols as number) || 80,
            (msg.rows as number) || 24
          );
        }
        break;
      case 'terminal.close':
        if (sessionId) terminalService.closeSession(sessionId);
        break;

      // ── Power ───────────────────────────────────────────────────────────────
      case 'power.sleep':    powerService.sleep();    break;
      case 'power.shutdown': powerService.shutdown(); break;
      case 'power.restart':  powerService.restart();  break;

      // ── Apps ────────────────────────────────────────────────────────────────
      case 'apps.list':
        send({ type: 'apps.list.response', apps: appService.listApps() });
        break;
      case 'apps.launch':
        if (typeof msg.name === 'string') {
          appService.launch(msg.name, (output) => {
            send({ type: 'apps.launch.output', name: msg.name, output });
          });
        }
        break;

      // ── Screen ──────────────────────────────────────────────────────────────
      case 'screen.start': {
        const fps     = typeof msg.fps     === 'number' ? msg.fps     : 10;
        const quality = typeof msg.quality === 'number' ? msg.quality : 70;
        console.log(`[agent] Screen capture started — ${fps}fps quality:${quality}`);
        screenService.start((jpeg) => sendBinary(jpeg), { fps, quality });
        break;
      }

      case 'screen.stop':
        console.log('[agent] Screen capture stopped');
        screenService.stop();
        break;

      // ── Ollama ──────────────────────────────────────────────────────────────
      case 'ollama.models':
        ollamaService.listModels().then((models) => {
          send({ type: 'ollama.models.response', models });
        });
        break;

      case 'ollama.ps':
        ollamaService.getRunningModels().then((models) => {
          send({ type: 'ollama.ps.response', sessionId, models });
        });
        break;

      case 'ollama.chat':
        if (sessionId) {
          ollamaService.chat({
            sessionId,
            model:    (msg.model as string)   || 'llama3.2:3b',
            messages: (msg.messages as never) || [],
            onToken: (token) => {
              send({ type: 'ollama.token', sessionId, data: token });
            },
            onDone: (fullText) => {
              send({ type: 'ollama.done', sessionId, data: fullText });
            },
            onError: (err) => {
              send({ type: 'ollama.error', sessionId, error: err });
            },
          });
        }
        break;

      case 'ollama.cancel':
        if (sessionId) ollamaService.cancelStream(sessionId);
        break;

      // ── Sysinfo ─────────────────────────────────────────────────────────────
      case 'sysinfo.get':
        sysinfoService.get().then((info) => {
          send({ type: 'sysinfo.response', requestId: msg.requestId, data: info });
        });
        break;

      // ── Files ────────────────────────────────────────────────────────────────
      case 'file.drives':
        try {
          send({ type: 'file.drives.response', requestId: msg.requestId, data: fileService.listDrives() });
        } catch (err: unknown) {
          send({ type: 'file.drives.response', requestId: msg.requestId, error: (err as Error).message });
        }
        break;

      case 'file.list':
        try {
          const listResult = fileService.listDirectory(msg.path as string);
          send({ type: 'file.list.response', requestId: msg.requestId, data: listResult });
        } catch (err: unknown) {
          send({ type: 'file.list.response', requestId: msg.requestId, error: (err as Error).message });
        }
        break;

      case 'file.download':
        try {
          const dl = fileService.downloadFile(msg.path as string);
          send({ type: 'file.download.response', requestId: msg.requestId, data: dl });
        } catch (err: unknown) {
          send({ type: 'file.download.response', requestId: msg.requestId, error: (err as Error).message });
        }
        break;

      case 'file.delete':
        try {
          fileService.deleteItem(msg.path as string);
          send({ type: 'file.delete.response', requestId: msg.requestId, data: { ok: true } });
        } catch (err: unknown) {
          send({ type: 'file.delete.response', requestId: msg.requestId, error: (err as Error).message });
        }
        break;

      case 'file.mkdir':
        try {
          fileService.createDirectory(msg.path as string);
          send({ type: 'file.mkdir.response', requestId: msg.requestId, data: { ok: true } });
        } catch (err: unknown) {
          send({ type: 'file.mkdir.response', requestId: msg.requestId, error: (err as Error).message });
        }
        break;

      case 'file.rename':
        try {
          fileService.renameItem(msg.from as string, msg.to as string);
          send({ type: 'file.rename.response', requestId: msg.requestId, data: { ok: true } });
        } catch (err: unknown) {
          send({ type: 'file.rename.response', requestId: msg.requestId, error: (err as Error).message });
        }
        break;

      case 'file.upload':
        try {
          fileService.uploadFile(msg.path as string, msg.data as string);
          send({ type: 'file.upload.response', requestId: msg.requestId, data: { ok: true } });
        } catch (err: unknown) {
          send({ type: 'file.upload.response', requestId: msg.requestId, error: (err as Error).message });
        }
        break;

      default:
        console.warn('[agent] Unknown message type:', type);
    }
  } catch (err) {
    console.error('[agent] Failed to parse message:', err);
  }
}

connect();

process.on('SIGINT', () => {
  console.log('[agent] Shutting down...');
  stopSysinfoLoop();
  terminalService.closeAll();
  ws?.close();
  process.exit(0);
});
