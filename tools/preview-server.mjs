/**
 * Minimal static file server for the Playwright suite.
 *
 * `astro preview` (Astro 7) daemonizes itself when stdin is not a TTY, so
 * Playwright's webServer sees the process exit and aborts the run ("Process
 * from config.webServer exited early") while the orphaned daemon keeps the
 * port. This server stays in the foreground, binds 127.0.0.1 to match the
 * config's health-check URL, and serves dist/ with the same trailing-slash
 * semantics a static host uses.
 *
 * Usage: node tools/preview-server.mjs [--port 4330] [--dir dist]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(argValue('--port', '4330'));
const ROOT = resolve(argValue('--dir', 'dist'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  try {
    // Keep the raw (still-encoded) pathname for the redirect Location header —
    // decoded characters can be invalid in a header value; decode only for the
    // filesystem lookup.
    const rawPathname = new URL(req.url, 'http://localhost').pathname;
    const pathname = decodeURIComponent(rawPathname);
    const filePath = normalize(join(ROOT, pathname));
    // The normalized path must stay inside ROOT (rejects ../ traversal).
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden');
      return;
    }

    let target = filePath;
    if (pathname.endsWith('/')) {
      target = join(filePath, 'index.html');
    } else {
      // A directory hit without the trailing slash redirects, like static hosts.
      const s = await stat(filePath).catch(() => null);
      if (s?.isDirectory()) {
        res.writeHead(301, { location: rawPathname + '/' }).end();
        return;
      }
    }

    const body = await readFile(target).catch(() => null);
    if (body === null) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res
      .writeHead(200, {
        'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      })
      .end(body);
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain' }).end('server error');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`preview-server: serving ${ROOT} at http://127.0.0.1:${PORT}/`);
});
