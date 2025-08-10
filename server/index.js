import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensureRepo, buildIndex, loadIndex, searchIndex, ensureDataDirs, paths } from './lib/indexer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));

async function syncAndIndex(verbose = true) {
  ensureDataDirs();
  const offline = process.env.OFFLINE === '1';
  ensureRepo({ verbose, offline });
  const idx = buildIndex({ verbose });
  return idx;
}

if (args.has('--sync-only')) {
  await syncAndIndex(true);
  process.exit(0);
}

const app = express();
app.use(express.json());

// Serve static frontend
app.use('/', express.static(ROOT));

let INDEX = loadIndex();
let ready = !!INDEX;

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ready, total: INDEX?.total || 0, generatedAt: INDEX?.generatedAt || null });
});

app.post('/api/sync', async (req, res) => {
  try {
    INDEX = await syncAndIndex(false);
    ready = true;
    res.json({ ok: true, total: INDEX.total, generatedAt: INDEX.generatedAt });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.get('/api/list', (req, res) => {
  if (!ready) return res.status(503).json({ ok: false, error: 'Index not built. POST /api/sync first.' });
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const offset = parseInt(req.query.offset || '0', 10);
  const { total, items } = searchIndex(INDEX, '', limit, offset);
  res.json({ total, items });
});

app.get('/api/search', (req, res) => {
  if (!ready) return res.status(503).json({ ok: false, error: 'Index not built. POST /api/sync first.' });
  const q = String(req.query.q || '');
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const { total, items } = searchIndex(INDEX, q, limit, 0);
  res.json({ total, items });
});

const PORT = process.env.PORT || 5173;
app.listen(PORT, () => {
  console.log(`winget-web listening on http://localhost:${PORT}`);
  console.log('First time? Build the index:');
  console.log('  1) npm install');
  console.log('  2) curl -X POST http://localhost:' + PORT + '/api/sync');
});
