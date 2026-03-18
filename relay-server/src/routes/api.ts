import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { AuthRequest } from '../middleware/auth';
import { getTunnelInstance } from '../tunnel/tunnelInstance';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

const router = Router();

// ─── Status ──────────────────────────────────────────────────────────────────

router.get('/status', (_req: AuthRequest, res: Response): void => {
  res.json({
    agentConnected: getTunnelInstance().isAgentConnected(),
    timestamp: new Date().toISOString(),
  });
});

// ─── Power ───────────────────────────────────────────────────────────────────

router.post('/power/wake', (_req: AuthRequest, res: Response): void => {
  getTunnelInstance().sendToWolAgent()
    ? res.json({ message: 'Wake-on-LAN request sent' })
    : res.status(503).json({ error: 'WoL agent not reachable' });
});

router.post('/power/sleep', (_req: AuthRequest, res: Response): void => {
  getTunnelInstance().sendToAgent({ type: 'power.sleep' })
    ? res.json({ message: 'Sleep command sent' })
    : res.status(503).json({ error: 'PC agent not connected' });
});

router.post('/power/shutdown', (_req: AuthRequest, res: Response): void => {
  getTunnelInstance().sendToAgent({ type: 'power.shutdown' })
    ? res.json({ message: 'Shutdown command sent' })
    : res.status(503).json({ error: 'PC agent not connected' });
});

router.post('/power/restart', (_req: AuthRequest, res: Response): void => {
  getTunnelInstance().sendToAgent({ type: 'power.restart' })
    ? res.json({ message: 'Restart command sent' })
    : res.status(503).json({ error: 'PC agent not connected' });
});

// ─── Apps ─────────────────────────────────────────────────────────────────────

router.get('/apps', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const apps = await getTunnelInstance().requestFromAgent<unknown[]>('apps.list');
    res.json({ apps });
  } catch {
    res.status(503).json({ error: 'PC agent not connected or timed out' });
  }
});

router.post('/apps/launch', (req: AuthRequest, res: Response): void => {
  const { name } = req.body;
  if (!name) { res.status(400).json({ error: 'App name required' }); return; }
  getTunnelInstance().sendToAgent({ type: 'apps.launch', name })
    ? res.json({ message: `Launch request sent for: ${name}` })
    : res.status(503).json({ error: 'PC agent not connected' });
});

// ─── VNC ──────────────────────────────────────────────────────────────────────

router.get('/vnc/credentials', (_req: AuthRequest, res: Response): void => {
  res.json({ password: process.env.VNC_PASSWORD || '' });
});

// ─── Sysinfo ──────────────────────────────────────────────────────────────────

router.get('/sysinfo', (_req: AuthRequest, res: Response): void => {
  const tunnel = getTunnelInstance();
  const info = tunnel.getLatestSysinfo();
  if (info) {
    res.json(info);
  } else if (!tunnel.isAgentConnected()) {
    res.status(503).json({ error: 'PC agent not connected' });
  } else {
    tunnel.requestFromAgent('sysinfo.get')
      .then((data) => res.json(data))
      .catch(() => res.status(504).json({ error: 'Sysinfo request timed out' }));
  }
});

// ─── Files ────────────────────────────────────────────────────────────────────

router.get('/files/drives', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const drives = await getTunnelInstance().requestFromAgent<string[]>('file.drives', {}, 10000);
    res.json({ drives });
  } catch (err) {
    res.status(503).json({ error: (err as Error).message });
  }
});

router.get('/files/list', async (req: AuthRequest, res: Response): Promise<void> => {
  const filePath = req.query['path'] as string;
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }
  try {
    const result = await getTunnelInstance().requestFromAgent('file.list', { path: filePath }, 15000);
    res.json(result);
  } catch (err) {
    res.status(503).json({ error: (err as Error).message });
  }
});

router.get('/files/download', async (req: AuthRequest, res: Response): Promise<void> => {
  const filePath = req.query['path'] as string;
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }
  try {
    const result = await getTunnelInstance().requestFromAgent<{ data: string; name: string }>('file.download', { path: filePath }, 60000);
    const buffer = Buffer.from(result.data, 'base64');
    res.setHeader('Content-Disposition', `attachment; filename="${result.name}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    res.status(503).json({ error: (err as Error).message });
  }
});

router.delete('/files', async (req: AuthRequest, res: Response): Promise<void> => {
  const filePath = req.query['path'] as string;
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }
  try {
    await getTunnelInstance().requestFromAgent('file.delete', { path: filePath }, 15000);
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    res.status(503).json({ error: (err as Error).message });
  }
});

router.post('/files/mkdir', async (req: AuthRequest, res: Response): Promise<void> => {
  const { path: dirPath } = req.body;
  if (!dirPath) { res.status(400).json({ error: 'path required' }); return; }
  try {
    await getTunnelInstance().requestFromAgent('file.mkdir', { path: dirPath }, 10000);
    res.json({ message: 'Directory created' });
  } catch (err) {
    res.status(503).json({ error: (err as Error).message });
  }
});

router.patch('/files/rename', async (req: AuthRequest, res: Response): Promise<void> => {
  const { from, to } = req.body;
  if (!from || !to) { res.status(400).json({ error: 'from and to required' }); return; }
  try {
    await getTunnelInstance().requestFromAgent('file.rename', { from, to }, 10000);
    res.json({ message: 'Renamed successfully' });
  } catch (err) {
    res.status(503).json({ error: (err as Error).message });
  }
});

router.post('/files/upload', upload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  const dirPath = req.query['path'] as string;
  if (!dirPath || !req.file) { res.status(400).json({ error: 'path and file required' }); return; }
  const fileName  = req.file.originalname;
  const filePath  = dirPath.endsWith('\\') ? `${dirPath}${fileName}` : `${dirPath}\\${fileName}`;
  const base64    = req.file.buffer.toString('base64');
  try {
    await getTunnelInstance().requestFromAgent('file.upload', { path: filePath, data: base64 }, 120000);
    res.json({ message: 'Upload successful' });
  } catch (err) {
    res.status(503).json({ error: (err as Error).message });
  }
});

export { router as apiRouter };
