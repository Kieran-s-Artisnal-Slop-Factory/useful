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
 * It also serves a few `/__echo/*` routes for the HTTP playground's spec:
 * a request needs something real to be sent to, and a SAME-ORIGIN target is
 * the only kind a browser will let the page talk to without CORS in the way.
 * That is deliberate — these routes exercise the send path, while the CORS
 * classifier is unit-tested against synthetic failures where its inputs can
 * actually be controlled.
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

/** Read a request body whole. */
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(Buffer.alloc(0)));
  });
}

/**
 * The echo routes. Returns true when it handled the request.
 *
 *   /__echo/json    method, headers and body back as JSON
 *   /__echo/html    a small HTML document, for the preview toggle
 *   /__echo/binary  PNG bytes under a LYING `content-type: text/plain`,
 *                   so the sniffer has something to disagree with
 *   /__echo/slow    holds the connection open, for the cancel button
 *   /__echo/broken  claims JSON and is not
 *   /__echo/status  any status you ask for: /__echo/status/404
 */
async function echo(req, res, pathname) {
  if (!pathname.startsWith('/__echo/')) return false;

  if (pathname === '/__echo/json') {
    const body = await readBody(req);
    res
      .writeHead(200, { 'content-type': 'application/json', 'x-echo': 'yes', 'cache-control': 'no-store' })
      .end(
        JSON.stringify({
          method: req.method,
          headers: req.headers,
          query: new URL(req.url, 'http://localhost').search,
          body: body.toString('utf8'),
        })
      );
    return true;
  }

  if (pathname === '/__echo/html') {
    res
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      .end('<!doctype html><html><head><title>Echoed</title></head><body><h1>From the server</h1></body></html>');
    return true;
  }

  if (pathname === '/__echo/binary') {
    // A 1x1 PNG. The content-type is a lie on purpose: the viewer names a body
    // from its MAGIC BYTES, and this is what proves it.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    res
      .writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      .end(png);
    return true;
  }

  if (pathname === '/__echo/broken') {
    res
      .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end('{ "almost": true,, }');
    return true;
  }

  if (pathname === '/__echo/slow') {
    // Never answers within a test's patience: the point is to abort it.
    const timer = setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('too late');
    }, 30_000);
    req.on('close', () => clearTimeout(timer));
    return true;
  }

  const status = pathname.match(/^\/__echo\/status\/(\d{3})$/);
  if (status) {
    res
      .writeHead(Number(status[1]), { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      .end(`status ${status[1]}`);
    return true;
  }

  res.writeHead(404, { 'content-type': 'text/plain' }).end('no such echo route');
  return true;
}

createServer(async (req, res) => {
  try {
    // Keep the raw (still-encoded) pathname for the redirect Location header —
    // decoded characters can be invalid in a header value; decode only for the
    // filesystem lookup.
    const rawPathname = new URL(req.url, 'http://localhost').pathname;
    const pathname = decodeURIComponent(rawPathname);
    if (await echo(req, res, pathname)) return;
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
