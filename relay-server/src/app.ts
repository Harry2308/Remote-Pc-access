import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth';
import { apiRouter } from './routes/api';
import { authenticateRequest } from './middleware/auth';

export function createApp() {
  const app = express();
  app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:4200' }));
  app.use(express.json());
  app.use('/auth', authRouter);
  app.use('/api', authenticateRequest, apiRouter);
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  return app;
}
