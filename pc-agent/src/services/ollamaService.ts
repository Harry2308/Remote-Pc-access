const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://localhost:11434';

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatOptions {
  model: string;
  messages: OllamaMessage[];
  sessionId: string;
  onToken: (token: string) => void;
  onDone: (fullText: string) => void;
  onError: (err: string) => void;
}

export class OllamaService {
  // Active streaming requests — keyed by sessionId so they can be cancelled
  private activeStreams = new Map<string, AbortController>();

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { models: { name: string }[] };
      return data.models.map((m) => m.name);
    } catch (err) {
      console.error('[ollama] Failed to list models:', err);
      return [];
    }
  }

  async chat(opts: OllamaChatOptions): Promise<void> {
    const { model, messages, sessionId, onToken, onDone, onError } = opts;

    const controller = new AbortController();
    this.activeStreams.set(sessionId, controller);

    try {
      const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: true }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        onError(`Ollama error ${res.status}: ${text}`);
        return;
      }

      if (!res.body) {
        onError('No response body from Ollama');
        return;
      }

      const decoder = new TextDecoder();
      const reader = res.body.getReader();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        // Ollama streams one JSON object per line
        for (const line of chunk.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed) as {
              message?: { content?: string };
              done?: boolean;
            };
            if (parsed.message?.content) {
              fullText += parsed.message.content;
              onToken(parsed.message.content);
            }
            if (parsed.done) {
              onDone(fullText);
              return;
            }
          } catch {
            // partial JSON line — skip
          }
        }
      }
      onDone(fullText);
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') {
        onDone('');
      } else {
        onError(`Stream error: ${(err as Error).message}`);
      }
    } finally {
      this.activeStreams.delete(sessionId);
    }
  }

  cancelStream(sessionId: string): void {
    const controller = this.activeStreams.get(sessionId);
    if (controller) {
      controller.abort();
      this.activeStreams.delete(sessionId);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}
