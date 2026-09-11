import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatProxy } from './aiProxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(express.json({ limit: '4mb' }));

// Health + runtime config (never exposes the API key itself)
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get('/api/config', (_req, res) => {
  res.json({
    provider: 'deepseek',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    baseUrl: process.env.DEEPSEEK_BASE_URL || '',
    configured: Boolean(process.env.DEEPSEEK_API_KEY),
  });
});

// AI proxy: the browser never sees the API key.
app.post('/api/chat', async (req, res) => {
  try {
    const result = await createChatProxy(req.body);
    res.json(result);
  } catch (err) {
    const status = (err as { status?: number }).status || 502;
    const message = err instanceof Error ? err.message : 'Unknown error';
    // Log detailed error server-side only.
    console.error('[ai-proxy] error:', message, { status });
    res.status(status).json({ error: message, userMessage: true });
  }
});

// Serve the built client in production.
const isProd = process.env.NODE_ENV === 'production';
if (isProd) {
  const distDir = path.resolve(__dirname, '../dist');
  app.use(express.static(distDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.send('DrawMind API Server (Development Mode). Please visit http://localhost:5173 for the web app.');
  });
}

app.listen(PORT, () => {
  console.log(`[drawmind] API server listening on http://localhost:${PORT}`);
  console.log(
    `[drawmind] AI configured: ${process.env.DEEPSEEK_API_KEY ? 'yes' : 'NO (set DEEPSEEK_API_KEY in .env)'}`,
  );
});
