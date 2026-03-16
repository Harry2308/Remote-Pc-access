import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
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

  constructor(private server: HttpServer) {}

  start(): void {
    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const url = req.url || '';
      if (url.startsWith('/agent'))    this.handleAgentConnection(ws, req);
      else if (url.startsWith('/terminal')) this.handleTerminalClient(ws, req);
      else if (url.startsWith('/ollama'))   this.handleOllamaClient(ws, req);
      else if (url.startsWith('/wol-agent')) this.handleWolAgentConnection(ws, req);
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

    ws.on('message', (raw) => this.routeAgentMessage(raw.toString()));
    ws.on('close', () => {
      console.log('[tunnel] PC Agent disconnected');
      if (this.agentWs === ws) this.agentWs = null;
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

  // ─── Route messages from agent → clients ───────────────────────────────────

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

      // Sysinfo push — cache latest state
      if (type === 'sysinfo.push') {
        this.latestSysinfo = msg.data as SysInfo;
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
