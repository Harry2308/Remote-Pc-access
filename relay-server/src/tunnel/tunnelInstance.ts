// Singleton holder — avoids circular import between index.ts and routes/api.ts
import { TunnelService } from './tunnelService';
import { createServer } from 'http';

// Lazy singleton — replaced by the real instance when the server starts
let _instance: TunnelService | null = null;

export function setTunnelInstance(t: TunnelService): void {
  _instance = t;
}

export function getTunnelInstance(): TunnelService {
  if (!_instance) {
    // In tests, create a stub instance not attached to a real server
    _instance = new TunnelService(createServer());
  }
  return _instance;
}
