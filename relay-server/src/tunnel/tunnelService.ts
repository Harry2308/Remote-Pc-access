import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import net from 'net';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import type { SysInfo } from '../types/sysinfo';

interface AgentMessage {
  type: string;
  sessionId?: string;
  data?: unknown;
  [key: string]: unknown;
}

interface TerminalSession {
  clientWs: WebSocket;
  sessionId: string;
}

interface OllamaSession {
  clientWs: WebSocket;
  sessionId: string;
}

// Pending REST request waiting for agent response
interface PendingRequest {
  resolve: (data: unknown) => void;
  reject:  (err: Error)   => void;
  timer:   ReturnType<typeof setTimeout>;
}

export class TunnelService {
  private wss!: WebSocketServer;
  private agentWs: WebSocket | null = null;

  private terminalSessions = new Map<string, TerminalSession>();
  private ollamaSessions   = new Map<string, OllamaSession>();
  private pendingRequests  = new Map<string, PendingRequest>();

  // Latest sysinfo pushed from agent — REST endpoint reads this
  private latestSysinfo: SysInfo | null = null;

  // Screen streaming — only one client at a time
  private screenClientWs: WebSocket | null = null;
  private screenFps     = 10;
  private screenQuality = 70;

  // Live sysinfo subscribers (browser clients)
  private sysinfoClients = new Set<WebSocket>();

  constructor(private server: HttpServer) {}

  start(): void {
    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const url = req.url || '';
      if (url.startsWith('/agent'))      this.handleAgentConnection(ws, req);
      else if (url.startsWith('/terminal'))  this.handleTerminalClient(ws, req);
      else if (url.startsWith('/ollama'))    this.handleOllamaClient(ws, req);
      else if (url.startsWith('/screen'))    this.handleScreenClient(ws, req);
      else if (url.startsWith('/sysinfo'))   this.handleSysinfoClient(ws, req);
      else if (url.startsWith('/wol-agent')) this.handleWolAgentConnection(ws, req);
      else if (url.startsWith('/vnc'))       this.handleVncClient(ws, req);
      else ws.close(1008, 'Unknown endpoint');
    });

    console.log('[tunnel] WebSocket server ready');
  }

  // ─── Agent connection (from Windows PC) ────────────────────────────────────

  private handleAgentConnection(ws: WebSocket, req: IncomingMessage): void {
    const secret = new URL(req.url!, `ws://x`).searchParams.get('secret');
    if (secret !== process.env.AGENT_SECRET) {
      ws.close(1008, 'Invalid agent secret');
      return;
    }
    if (this.agentWs) this.agentWs.close(1001, 'New agent connected');
    this.agentWs = ws;
    console.log('[tunnel] PC Agent connected');

    ws.on('message', (raw: Buffer, isBinary: boolean) => {
      if (isBinary) {
        this.routeAgentBinaryFrame(raw);
      } else {
        this.routeAgentMessage(raw.toString());
      }
    });
    ws.on('close', () => {
      console.log('[tunnel] PC Agent disconnected');
      if (this.agentWs === ws) {
        this.agentWs = null;
        // Notify screen client that the feed dropped
        if (this.screenClientWs?.readyState === WebSocket.OPEN) {
          this.screenClientWs.close(1013, 'PC agent disconnected');
        }
      }
    });
    ws.on('error', (err) => console.error('[tunnel] Agent WS error:', err));
  }

  // ─── WoL agent connection ───────────────────────────────────────────────────

  private handleWolAgentConnection(ws: WebSocket, req: IncomingMessage): void {
    const secret = new URL(req.url!, `ws://x`).searchParams.get('secret');
    if (secret !== process.env.AGENT_SECRET) { ws.close(1008, 'Invalid secret'); return; }
    ws.on('close', () => console.log('[tunnel] WoL agent disconnected'));
    console.log('[tunnel] WoL agent connected');
  }

  // ─── Terminal browser client ────────────────────────────────────────────────

  private handleTerminalClient(ws: WebSocket, req: IncomingMessage): void {
    if (!this.authoriseClient(ws, req)) return;
    if (!this.isAgentConnected()) { ws.close(1013, 'PC agent not connected'); return; }

    const sessionId = uuidv4();
    this.terminalSessions.set(sessionId, { clientWs: ws, sessionId });
    this.sendToAgent({ type: 'terminal.open', sessionId });

    ws.on('message', (raw) => {
      const text = raw.toString();
      try {
        const msg = JSON.parse(text) as AgentMessage;
        if (msg.type === 'terminal.resize') {
          this.sendToAgent({ type: 'terminal.resize', sessionId, cols: msg.cols, rows: msg.rows });
        } else {
          this.sendToAgent({ type: 'terminal.input', sessionId, data: text });
        }
      } catch {
        this.sendToAgent({ type: 'terminal.input', sessionId, data: text });
      }
    });
    ws.on('close', () => {
      this.sendToAgent({ type: 'terminal.close', sessionId });
      this.terminalSessions.delete(sessionId);
    });
    ws.on('error', (err) => console.error('[tunnel] Terminal client error:', err));
  }

  // ─── Ollama browser client ──────────────────────────────────────────────────

  private handleOllamaClient(ws: WebSocket, req: IncomingMessage): void {
    if (!this.authoriseClient(ws, req)) return;
    if (!this.isAgentConnected()) { ws.close(1013, 'PC agent not connected'); return; }

    const sessionId = uuidv4();
    this.ollamaSessions.set(sessionId, { clientWs: ws, sessionId });

    // First message: send available models
    this.sendToAgent({ type: 'ollama.models' });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as AgentMessage;
        if (msg.type === 'ollama.chat') {
          this.sendToAgent({ ...msg, sessionId });
        } else if (msg.type === 'ollama.cancel') {
          this.sendToAgent({ type: 'ollama.cancel', sessionId });
        } else if (msg.type === 'ollama.ps') {
          this.sendToAgent({ type: 'ollama.ps', sessionId });
        }
      } catch (err) {
        console.error('[tunnel] Ollama client msg error:', err);
      }
    });
    ws.on('close', () => {
      this.sendToAgent({ type: 'ollama.cancel', sessionId });
      this.ollamaSessions.delete(sessionId);
    });
    ws.on('error', (err) => console.error('[tunnel] Ollama client error:', err));
  }

  // ─── Screen browser client ──────────────────────────────────────────────────

  private handleScreenClient(ws: WebSocket, req: IncomingMessage): void {
    if (!this.authoriseClient(ws, req)) return;
    if (!this.isAgentConnected()) { ws.close(1013, 'PC agent not connected'); return; }

    // Only one screen client at a time
    if (this.screenClientWs?.readyState === WebSocket.OPEN) {
      this.screenClientWs.close(1000, 'Replaced by new client');
    }
    this.screenClientWs = ws;

    // Parse optional fps/quality from query string
    const params = new URL(req.url!, 'ws://x').searchParams;
    this.screenFps     = parseInt(params.get('fps')     ?? '10', 10);
    this.screenQuality = parseInt(params.get('quality') ?? '70',  10);

    this.sendToAgent({ type: 'screen.start', fps: this.screenFps, quality: this.screenQuality });
    console.log(`[tunnel] Screen client connected — ${this.screenFps}fps q:${this.screenQuality}`);

    // Client can send JSON control messages (settings or input events)
    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as AgentMessage;
        if (msg.type === 'screen.settings') {
          if (typeof msg.fps     === 'number') this.screenFps     = msg.fps;
          if (typeof msg.quality === 'number') this.screenQuality = msg.quality;
          this.sendToAgent({ type: 'screen.start', fps: this.screenFps, quality: this.screenQuality });
        } else if (msg.type === 'input.mouse' || msg.type === 'input.key') {
          this.sendToAgent(msg);
        }
      } catch { /* ignore non-JSON */ }
    });

    ws.on('close', () => {
      console.log('[tunnel] Screen client disconnected');
      if (this.screenClientWs === ws) {
        this.screenClientWs = null;
        this.sendToAgent({ type: 'screen.stop' });
      }
    });
    ws.on('error', (err) => console.error('[tunnel] Screen client error:', err));
  }

  // ─── Live sysinfo browser client ───────────────────────────────────────────

  private handleSysinfoClient(ws: WebSocket, req: IncomingMessage): void {
    if (!this.authoriseClient(ws, req)) return;
    this.sysinfoClients.add(ws);
    // Send the latest cached snapshot immediately so the client has data right away
    if (this.latestSysinfo) {
      ws.send(JSON.stringify({ type: 'sysinfo.push', data: this.latestSysinfo }));
    }
    ws.on('close', () => this.sysinfoClients.delete(ws));
    ws.on('error', () => this.sysinfoClients.delete(ws));
  }

  // ─── Route messages from agent → clients ───────────────────────────────────

  private routeAgentBinaryFrame(frame: Buffer): void {
    if (this.screenClientWs?.readyState === WebSocket.OPEN) {
      this.screenClientWs.send(frame);
    }
  }

  private routeAgentMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as AgentMessage;
      const { type, sessionId } = msg;

      // Terminal
      if (type === 'terminal.data' && sessionId) {
        const s = this.terminalSessions.get(sessionId);
        if (s?.clientWs.readyState === WebSocket.OPEN) {
          s.clientWs.send(typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data));
        }
        return;
      }

      // Ollama streaming tokens
      if ((type === 'ollama.token' || type === 'ollama.done' || type === 'ollama.error') && sessionId) {
        // Find the ollama session — sessionId from agent matches what we assigned
        const s = this.ollamaSessions.get(sessionId);
        if (s?.clientWs.readyState === WebSocket.OPEN) {
          s.clientWs.send(JSON.stringify(msg));
        }
        return;
      }

      // Ollama models list — broadcast to all ollama sessions
      if (type === 'ollama.models.response') {
        for (const [, s] of this.ollamaSessions) {
          if (s.clientWs.readyState === WebSocket.OPEN) {
            s.clientWs.send(JSON.stringify(msg));
          }
        }
        return;
      }

      // Ollama ps response — route back to the requesting session
      if (type === 'ollama.ps.response' && sessionId) {
        const s = this.ollamaSessions.get(sessionId);
        if (s?.clientWs.readyState === WebSocket.OPEN) {
          s.clientWs.send(JSON.stringify(msg));
        }
        return;
      }

      // Sysinfo push — cache and broadcast to all subscribed clients
      if (type === 'sysinfo.push') {
        this.latestSysinfo = msg.data as SysInfo;
        const payload = JSON.stringify(msg);
        for (const client of this.sysinfoClients) {
          if (client.readyState === WebSocket.OPEN) client.send(payload);
        }
        return;
      }

      // Pending REST request responses (requestId based)
      if (msg.requestId) {
        const pending = this.pendingRequests.get(msg.requestId as string);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(msg.requestId as string);
          if (msg.error) {
            pending.reject(new Error(msg.error as string));
          } else {
            pending.resolve(msg.data);
          }
        }
        return;
      }
    } catch (err) {
      console.error('[tunnel] Failed to parse agent message:', err);
    }
  }

  // ─── VNC WebSocket-to-TCP proxy ─────────────────────────────────────────────

  private handleVncClient(ws: WebSocket, req: IncomingMessage): void {
    if (!this.authoriseClient(ws, req)) return;

    const pcHost = process.env.PC_HOST;
    if (!pcHost) { ws.close(1011, 'PC_HOST not configured'); return; }

    const tcp = net.createConnection(5900, pcHost);

    tcp.on('connect', () => {
      console.log(`[tunnel] VNC TCP connected to ${pcHost}:5900`);
    });

    tcp.on('data', (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    tcp.on('error', (err) => {
      console.error('[tunnel] VNC TCP error:', err.message);
      if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'VNC TCP error');
    });

    tcp.on('close', () => {
      if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'VNC TCP closed');
    });

    ws.on('message', (data: Buffer) => {
      if (tcp.writable) tcp.write(data);
    });

    ws.on('close', () => { tcp.destroy(); });
    ws.on('error', (err) => {
      console.error('[tunnel] VNC WS error:', err);
      tcp.destroy();
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private authoriseClient(ws: WebSocket, req: IncomingMessage): boolean {
    const token = new URL(req.url!, `ws://x`).searchParams.get('token');
    if (!token) { ws.close(1008, 'Missing token'); return false; }
    try {
      jwt.verify(token, process.env.JWT_SECRET!);
      return true;
    } catch {
      ws.close(1008, 'Invalid token');
      return false;
    }
  }

  isAgentConnected(): boolean {
    return this.agentWs !== null && this.agentWs.readyState === WebSocket.OPEN;
  }

  getLatestSysinfo(): SysInfo | null {
    return this.latestSysinfo;
  }

  sendToAgent(msg: AgentMessage): boolean {
    if (!this.isAgentConnected()) return false;
    this.agentWs!.send(JSON.stringify(msg));
    return true;
  }

  /** Send a request to the agent and await its response (for REST endpoints). */
  requestFromAgent<T>(type: string, payload: object = {}, timeoutMs = 5000): Promise<T> {
    return new Promise((resolve, reject) => {
      const requestId = uuidv4();
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Agent request timed out: ${type}`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, { resolve: resolve as (d: unknown) => void, reject, timer });
      this.sendToAgent({ type, requestId, ...payload });
    });
  }

  sendToWolAgent(): boolean {
    const wolUrl = process.env.WOL_AGENT_URL;
    if (!wolUrl) { console.warn('[tunnel] WOL_AGENT_URL not set'); return false; }
    fetch(wolUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Secret': process.env.AGENT_SECRET || '' },
      body: JSON.stringify({ action: 'wake' }),
    }).catch((err) => console.error('[tunnel] WoL request failed:', err));
    return true;
  }
}
