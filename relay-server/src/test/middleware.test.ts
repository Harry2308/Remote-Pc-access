import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../app';

const app = createApp();
const SECRET = process.env.JWT_SECRET!;

describe('Auth middleware', () => {
  it('rejects requests with no Authorization header', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/missing/i);
  });

  it('rejects requests with malformed header', async () => {
    const res = await request(app)
      .get('/api/status')
      .set('Authorization', 'NotBearer token');
    expect(res.status).toBe(401);
  });

  it('rejects expired tokens', async () => {
    const expired = jwt.sign({ sub: 'admin' }, SECRET, { expiresIn: -1 });
    const res = await request(app)
      .get('/api/status')
      .set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });

  it('rejects tokens signed with wrong secret', async () => {
    const bad = jwt.sign({ sub: 'admin' }, 'wrong-secret', { expiresIn: '1h' });
    const res = await request(app)
      .get('/api/status')
      .set('Authorization', `Bearer ${bad}`);
    expect(res.status).toBe(401);
  });

  it('accepts valid tokens', async () => {
    const valid = jwt.sign({ sub: 'admin' }, SECRET, { expiresIn: '1h' });
    const res = await request(app)
      .get('/api/status')
      .set('Authorization', `Bearer ${valid}`);
    expect(res.status).toBe(200);
  });
});
