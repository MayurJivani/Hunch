// One process: Socket.IO rooms plus, in production, the built client from dist/.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { Server } from 'socket.io';
import { attach } from './rooms.ts';

const PORT = Number(process.env.PORT ?? 4351);
if (!Number.isInteger(PORT) || PORT <= 0) {
  console.error(`Invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}
const PROD = process.env.NODE_ENV === 'production';
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

const io = new Server(http, { maxHttpBufferSize: 4096, serveClient: false });
attach(io);
http.listen(PORT, () => console.log(`hunch server on :${PORT}`));
