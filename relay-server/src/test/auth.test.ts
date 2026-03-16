import request from 'supertest';
import { createApp } from '../app';

const app = createApp();

describe('POST /auth/login', () => {
  it('returns 400 when body is empty', async () => {
    const res = await request(app).post('/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('returns 401 for wrong password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'admin', password: 'wrongpassword' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  it('returns 401 for wrong username', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'hacker', password: 'testpassword' });
    expect(res.status).toBe(401);
  });

  it('returns tokens for correct credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'admin', password: 'testpassword' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(typeof res.body.accessToken).toBe('string');
    expect(typeof res.body.refreshToken).toBe('string');
  });
});

describe('POST /auth/refresh', () => {
  let refreshToken: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'admin', password: 'testpassword' });
    refreshToken = res.body.refreshToken as string;
  });

  it('returns new tokens for valid refresh token', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
  });

  it('returns 401 for invalid refresh token', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: 'not-a-real-token' });
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('returns 200 for valid logout', async () => {
    const login = await request(app)
      .post('/auth/login')
      .send({ username: 'admin', password: 'testpassword' });
    const res = await request(app)
      .post('/auth/logout')
      .send({ refreshToken: login.body.refreshToken });
    expect(res.status).toBe(200);
  });

  it('invalidates the refresh token after logout', async () => {
    const login = await request(app)
      .post('/auth/login')
      .send({ username: 'admin', password: 'testpassword' });
    const { refreshToken: rt } = login.body as { refreshToken: string };

    await request(app).post('/auth/logout').send({ refreshToken: rt });

    const refresh = await request(app).post('/auth/refresh').send({ refreshToken: rt });
    expect(refresh.status).toBe(401);
  });
});
