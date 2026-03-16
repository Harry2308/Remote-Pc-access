import request from 'supertest';
import { createApp } from '../app';

const app = createApp();

async function getToken(): Promise<string> {
  const res = await request(app)
    .post('/auth/login')
    .send({ username: 'admin', password: 'testpassword' });
  return res.body.accessToken as string;
}

describe('GET /health', () => {
  it('returns 200 with status ok (no auth required)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('Protected API routes (no token)', () => {
  it('GET /api/status returns 401 without token', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(401);
  });

  it('POST /api/power/wake returns 401 without token', async () => {
    const res = await request(app).post('/api/power/wake');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/status', () => {
  it('returns agentConnected false when no agent is connected', async () => {
    const token = await getToken();
    const res = await request(app)
      .get('/api/status')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.agentConnected).toBe(false);
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('POST /api/power/* (agent not connected)', () => {
  let token: string;
  beforeAll(async () => { token = await getToken(); });

  const powerEndpoints = ['/api/power/sleep', '/api/power/shutdown', '/api/power/restart'];

  for (const endpoint of powerEndpoints) {
    it(`${endpoint} returns 503 when agent not connected`, async () => {
      const res = await request(app)
        .post(endpoint)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(503);
      expect(res.body).toHaveProperty('error');
    });
  }
});

describe('POST /api/apps/launch', () => {
  let token: string;
  beforeAll(async () => { token = await getToken(); });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/apps/launch')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('returns 503 when agent not connected', async () => {
    const res = await request(app)
      .post('/api/apps/launch')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'notepad' });
    expect(res.status).toBe(503);
  });
});

describe('GET /api/sysinfo', () => {
  it('returns 503 when agent not connected', async () => {
    const token = await getToken();
    const res = await request(app)
      .get('/api/sysinfo')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(503);
  });
});
