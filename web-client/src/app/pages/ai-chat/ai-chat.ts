import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { OllamaWsService, OllamaMessage, ModelInfo, RunningModel } from '../../services/ollama-ws';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

const STORAGE_KEY = 'ai_chat_sessions';

@Component({
  selector: 'app-ai-chat',
  standalone: false,
  templateUrl: './ai-chat.html',
  styleUrl: './ai-chat.scss',
})
export class AiChat implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('messagesEnd') messagesEnd!: ElementRef;

  sessions: ChatSession[] = [];
  activeSessionId = '';
  get messages(): ChatMessage[] {
    return this.activeSession?.messages ?? [];
  }
  get activeSession(): ChatSession | undefined {
    return this.sessions.find(s => s.id === this.activeSessionId);
  }

  models: ModelInfo[] = [];
  selectedModel = 'llama3.2:3b';
  runningModels: RunningModel[] = [];
  input = '';
  connected = false;
  streaming = false;
  showSessions = true;

  get selectedModelInfo(): ModelInfo | undefined {
    return this.models.find(m => m.name === this.selectedModel);
  }

  get selectedRunning(): RunningModel | undefined {
    return this.runningModels.find(m => m.name === this.selectedModel);
  }
  private sub = new Subscription();
  private shouldScroll = false;

  constructor(private ollamaWs: OllamaWsService, private router: Router, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.loadSessions();

    this.sub.add(
      this.ollamaWs.events$.subscribe((event) => {
        switch (event.type) {
          case 'connected':
            this.connected = true;
            break;

          case 'disconnected':
            this.connected = false;
            this.streaming = false;
            break;

          case 'models':
            this.models = event.models;
            if (event.models.length && !event.models.find(m => m.name === this.selectedModel)) {
              this.selectedModel = event.models[0].name;
            }
            // Refresh running model info after models are loaded
            this.ollamaWs.requestPs();
            break;

          case 'ps':
            this.runningModels = event.models;
            this.cdr.detectChanges();
            break;

          case 'token': {
            const session = this.activeSession;
            if (!session) break;
            const last = session.messages[session.messages.length - 1];
            if (last?.role === 'assistant') {
              last.content += event.data;
              last.streaming = true;
              this.shouldScroll = true;
              this.cdr.detectChanges();
            }
            break;
          }

          case 'done': {
            const session = this.activeSession;
            if (session) {
              const last = session.messages[session.messages.length - 1];
              if (last?.role === 'assistant') last.streaming = false;
              this.saveSessions();
            }
            this.streaming = false;
            this.ollamaWs.requestPs();
            break;
          }

          case 'error':
            this.streaming = false;
            this.activeSession?.messages.push({ role: 'assistant', content: `Error: ${event.error}` });
            this.saveSessions();
            break;
        }
      })
    );

    this.ollamaWs.connect();
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.messagesEnd?.nativeElement?.scrollIntoView({ behavior: 'smooth' });
      this.shouldScroll = false;
    }
  }

  // ─── Sessions ───────────────────────────────────────────────────────────────

  private loadSessions(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.sessions = raw ? JSON.parse(raw) : [];
    } catch {
      this.sessions = [];
    }
    if (this.sessions.length === 0) {
      this.createSession();
    } else {
      this.activeSessionId = this.sessions[0].id;
    }
  }

  private saveSessions(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.sessions));
    } catch {}
  }

  private createSession(): void {
    const session: ChatSession = {
      id: Date.now().toString(),
      title: 'New chat',
      messages: [],
      updatedAt: Date.now(),
    };
    this.sessions.unshift(session);
    this.activeSessionId = session.id;
    this.saveSessions();
  }

  newSession(): void {
    this.createSession();
  }

  switchSession(id: string): void {
    if (this.streaming) return;
    this.activeSessionId = id;
  }

  deleteSession(id: string, event: Event): void {
    event.stopPropagation();
    this.sessions = this.sessions.filter(s => s.id !== id);
    if (this.sessions.length === 0) {
      this.createSession();
    } else if (this.activeSessionId === id) {
      this.activeSessionId = this.sessions[0].id;
    }
    this.saveSessions();
  }

  // ─── Chat ────────────────────────────────────────────────────────────────────

  send(): void {
    const text = this.input.trim();
    const session = this.activeSession;
    if (!text || this.streaming || !this.connected || !session) return;

    session.messages.push({ role: 'user', content: text });

    // Auto-title from first message
    if (session.messages.length === 1) {
      session.title = text.length > 40 ? text.slice(0, 40) + '…' : text;
    }

    // Build history BEFORE adding empty assistant placeholder
    const history: OllamaMessage[] = session.messages.map(m => ({ role: m.role, content: m.content }));

    session.messages.push({ role: 'assistant', content: '', streaming: true });
    session.updatedAt = Date.now();
    this.input = '';
    this.streaming = true;
    this.shouldScroll = true;

    this.ollamaWs.chat(this.selectedModel, history);
  }

  stopStream(): void {
    this.ollamaWs.cancel();
    this.streaming = false;
    const session = this.activeSession;
    if (session) {
      const last = session.messages[session.messages.length - 1];
      if (last?.streaming) last.streaming = false;
      this.saveSessions();
    }
  }

  clearChat(): void {
    const session = this.activeSession;
    if (session) {
      session.messages = [];
      session.title = 'New chat';
      this.saveSessions();
    }
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
    this.ollamaWs.disconnect();
  }
}
