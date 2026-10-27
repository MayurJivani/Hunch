// One process: Socket.IO rooms plus, in production, the built client from dist/.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { Server } from 'socket.io';
import { attach, originAllowed } from './rooms.ts';
import { attachPublic } from './public.ts';

const PORT = Number(process.env.PORT ?? 4351);
if (!Number.isInteger(PORT) || PORT <= 0) {
  console.error(`Invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}
const PROD = process.env.NODE_ENV === 'production';
// Hunters per public hunt; a full hunt opens a parallel one. 400 is the load-tested size (scripts/load-public.ts).
const CAPACITY = Number(process.env.PUBLIC_CAPACITY ?? 400);
if (!Number.isInteger(CAPACITY) || CAPACITY < 1) {
  console.error(`Invalid PUBLIC_CAPACITY: ${process.env.PUBLIC_CAPACITY}`);
  process.exit(1);
}
// Speeds the clue clock up or down (0.25 = four times faster), for demos and local testing.
const PACE = Number(process.env.PUBLIC_PACE ?? 1);
if (!(PACE > 0)) {
  console.error(`Invalid PUBLIC_PACE: ${process.env.PUBLIC_PACE}`);
  process.exit(1);
}
// Simultaneous sockets allowed from one address. Raise it when a crowd shares one network.
const PER_IP = Number(process.env.SOCKETS_PER_IP ?? 24);
if (!Number.isInteger(PER_IP) || PER_IP < 1) {
  console.error(`Invalid SOCKETS_PER_IP: ${process.env.SOCKETS_PER_IP}`);
  process.exit(1);
}
const DATA = process.env.PUBLIC_DATA ?? join(import.meta.dirname, '..', 'data', 'public.json');
const DIST = join(import.meta.dirname, '..', 'dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
};

const http = createServer(async (req, res) => {
  if (!PROD) {
    res.writeHead(404).end('Run the client with `npm run dev:web`.');
    return;
  }
  const headers = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  };
  try {
    // decodeURIComponent throws on a malformed escape (/%E0); inside this try it falls back instead of crashing the process.
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const file = join(DIST, path === '/' ? 'index.html' : path);
    if (file !== DIST && !file.startsWith(DIST + sep)) throw new Error('outside dist');
    const body = await readFile(file);
    // Vite fingerprints everything under /assets, so those can be cached for good.
    const cache = path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { ...headers, 'cache-control': cache, 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    // SPA fallback so a refreshed /room link still loads the app.
    const index = await readFile(join(DIST, 'index.html')).catch(() => null);
    if (index) res.writeHead(200, { ...headers, 'cache-control': 'no-cache', 'content-type': TYPES['.html'] }).end(index);
    else res.writeHead(503).end('Build the client first: npm run build');
  }
});

const io = new Server(http, { maxHttpBufferSize: 4096, serveClient: false, allowRequest: (req, cb) => cb(null, originAllowed(req.headers)) });
attach(io, undefined, PER_IP);
attachPublic(io, { capacity: CAPACITY, dataFile: DATA, briefingMs: 20_000 * PACE, clueEveryMs: 30_000 * PACE, graceMs: 60_000 * PACE });
http.listen(PORT, () => console.log(`hunch server on :${PORT}`));
