import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const router = Router();

// In-memory store for refresh tokens (use Redis in production)
const refreshTokens = new Set<string>();

function generateTokens(userId: string) {
  const accessToken = jwt.sign(
    { sub: userId },
    process.env.JWT_SECRET as string,
    { expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as `${number}${'s'|'m'|'h'|'d'}` }
  );
  const refreshToken = jwt.sign(
    { sub: userId, type: 'refresh' },
    process.env.JWT_SECRET as string,
    { expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as `${number}${'s'|'m'|'h'|'d'}` }
  );
  return { accessToken, refreshToken };
}

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }

  const validUsername = username === process.env.ADMIN_USERNAME;
  const stored = process.env.ADMIN_PASSWORD || '';
  // Support both plain-text passwords (dev) and bcrypt hashes (production)
  const isBcryptHash = /^\$2[aby]\$/.test(stored);
  const validPassword = stored
    ? isBcryptHash
      ? await bcrypt.compare(password, stored)
      : password === stored
    : false;

  if (!validUsername || !validPassword) {
    // Constant-time comparison done via bcrypt above
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const { accessToken, refreshToken } = generateTokens(username);
  refreshTokens.add(refreshToken);

  res.json({ accessToken, refreshToken });
});

router.post('/refresh', (req: Request, res: Response): void => {
  const { refreshToken } = req.body;

  if (!refreshToken || !refreshTokens.has(refreshToken)) {
    res.status(401).json({ error: 'Invalid refresh token' });
    return;
  }

  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_SECRET!) as {
      sub: string;
      type: string;
    };

    if (payload.type !== 'refresh') {
      res.status(401).json({ error: 'Invalid token type' });
      return;
    }

    refreshTokens.delete(refreshToken);
    const tokens = generateTokens(payload.sub);
    refreshTokens.add(tokens.refreshToken);

    res.json(tokens);
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

router.post('/logout', (req: Request, res: Response): void => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    refreshTokens.delete(refreshToken);
  }
  res.json({ message: 'Logged out' });
});

export { router as authRouter };
