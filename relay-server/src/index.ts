import 'dotenv/config';
import { createServer } from 'http';
import { createApp } from './app';
import { TunnelService } from './tunnel/tunnelService';
import { setTunnelInstance } from './tunnel/tunnelInstance';

const app = createApp();
const server = createServer(app);

export const tunnelService = new TunnelService(server);
setTunnelInstance(tunnelService);
tunnelService.start();

const PORT = parseInt(process.env.PORT || '3001', 10);
server.listen(PORT, () => {
  console.log(`[relay] Relay server listening on port ${PORT}`);
});
