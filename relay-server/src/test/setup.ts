// Set env vars before any module loads
process.env.JWT_SECRET = 'test-secret-min-32-chars-long-enough';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'testpassword';
process.env.AGENT_SECRET = 'test-agent-secret';
process.env.CORS_ORIGIN = 'http://localhost:4200';
process.env.PORT = '3099';
