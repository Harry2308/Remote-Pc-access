import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { OllamaWsService, OllamaMessage } from '../../services/ollama-ws';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

@Component({
  selector: 'app-ai-chat',
  standalone: false,
  templateUrl: './ai-chat.html',
  styleUrl: './ai-chat.scss',
})
export class AiChat implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('messagesEnd') messagesEnd!: ElementRef;

  messages: ChatMessage[] = [];
  models: string[] = [];
  selectedModel = 'llama3.2:3b';
  input = '';
  connected = false;
  streaming = false;
  private sub = new Subscription();
  private shouldScroll = false;

  constructor(private ollamaWs: OllamaWsService, private router: Router) {}

  ngOnInit(): void {
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
            if (event.models.length && !event.models.includes(this.selectedModel)) {
              this.selectedModel = event.models[0];
            }
            break;

          case 'token': {
            const last = this.messages[this.messages.length - 1];
            if (last?.role === 'assistant') {
              last.content += event.data;
              last.streaming = true;
              this.shouldScroll = true;
            }
            break;
          }

          case 'done': {
            const last = this.messages[this.messages.length - 1];
            if (last?.role === 'assistant') last.streaming = false;
            this.streaming = false;
            break;
          }

          case 'error':
            this.streaming = false;
            this.messages.push({ role: 'assistant', content: `⚠️ Error: ${event.error}` });
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

  send(): void {
    const text = this.input.trim();
    if (!text || this.streaming || !this.connected) return;

    this.messages.push({ role: 'user', content: text });
    this.messages.push({ role: 'assistant', content: '', streaming: true });
    this.input = '';
    this.streaming = true;
    this.shouldScroll = true;

    const history: OllamaMessage[] = this.messages
      .filter((m) => !m.streaming || m.content.length > 0)
      .slice(0, -1) // exclude the empty streaming message
      .map((m) => ({ role: m.role, content: m.content }));

    this.ollamaWs.chat(this.selectedModel, history);
  }

  stopStream(): void {
    this.ollamaWs.cancel();
    this.streaming = false;
    const last = this.messages[this.messages.length - 1];
    if (last?.streaming) last.streaming = false;
  }

  clearChat(): void {
    this.messages = [];
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
