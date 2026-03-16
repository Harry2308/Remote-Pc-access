import { exec } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

interface AppConfig {
  name: string;
  command: string;
  description: string;
}

export class AppService {
  private apps: AppConfig[] = [];

  constructor() {
    this.loadConfig();
  }

  private loadConfig(): void {
    try {
      const configPath = join(process.cwd(), 'apps.config.json');
      const raw = readFileSync(configPath, 'utf-8');
      this.apps = JSON.parse(raw) as AppConfig[];
      console.log(`[apps] Loaded ${this.apps.length} app(s) from config`);
    } catch {
      console.warn('[apps] No apps.config.json found or invalid JSON — no apps available');
      this.apps = [];
    }
  }

  listApps(): { name: string; description: string }[] {
    return this.apps.map(({ name, description }) => ({ name, description }));
  }

  launch(name: string, onOutput: (output: string) => void): void {
    const app = this.apps.find((a) => a.name === name);
    if (!app) {
      onOutput(`[error] Unknown app: ${name}`);
      return;
    }

    console.log(`[apps] Launching: ${app.name} -> ${app.command}`);
    const child = exec(app.command, { shell: 'powershell.exe' });

    child.stdout?.on('data', (data: string) => onOutput(data));
    child.stderr?.on('data', (data: string) => onOutput(`[stderr] ${data}`));
    child.on('close', (code) => onOutput(`[exit] ${app.name} exited with code ${code}`));
    child.on('error', (err) => onOutput(`[error] ${err.message}`));
  }
}
