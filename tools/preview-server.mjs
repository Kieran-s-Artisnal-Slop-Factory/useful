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

/**
 * A small but genuinely valid PDF, offsets and all.
 *
 * The `xref` table has to name each object's byte offset, so a hand-written
 * literal goes stale the moment anyone edits a line above it. Building it
 * here keeps it correct — and correctness matters: browsers reconstruct a
 * broken xref silently, so a malformed fixture would still render and the
 * spec would be proving nothing about the path it claims to test.
 */
function buildPdf(message) {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 240 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    null, // the content stream, built below so its /Length is right
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  const stream = `BT /F1 18 Tf 20 60 Td (${message}) Tj ET\n`;
  objects[3] = `<</Length ${Buffer.byteLength(stream)}>>\nstream\n${stream}endstream`;

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

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
 *   /__echo/cors-ok the ONLY route that sends Access-Control-Allow-Origin,
 *                   so a cross-origin host can be proven to work before
 *                   another of its routes refuses
 *   /__echo/binary  PNG bytes under a LYING `content-type: text/plain`,
 *                   so the sniffer has something to disagree with
 *   /__echo/image   the same PNG under its own type, for the media preview
 *   /__echo/pdf     a small but genuinely valid PDF
 *   /__echo/audio   a tenth of a second of playable WAV
 *   /__echo/tiff    real, sniffable, and unrenderable in every browser
 *   /__echo/css     |
 *   /__echo/js      | bodies that exist to be syntax-highlighted
 *   /__echo/xml     |
 *   /__echo/markdown|
 *   /__echo/auth    returns a token, for the two-step flow scenario
 *   /__echo/me      401 unless that exact token is on the request
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

  // The one route that shares itself cross-origin. Everything else here
  // deliberately does NOT, which reproduces the case a real user hit and
  // reported as a bug in this app: a host whose CORS header is attached per
  // resource, so one URL works and the next one from the same server does
  // not. Reachable cross-origin from the suite because `localhost` and
  // `127.0.0.1` are different origins to a browser while being the same
  // server to the OS.
  if (pathname === '/__echo/cors-ok') {
    res
      .writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      })
      .end(JSON.stringify({ shared: true }));
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

  // A PNG under its OWN type, unlike /__echo/binary — the preview path needs
  // a body where the header and the bytes agree, so the disagreement warning
  // is not what the test ends up asserting on.
  if (pathname === '/__echo/image') {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }).end(png);
    return true;
  }

  if (pathname === '/__echo/pdf') {
    res
      .writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'no-store' })
      .end(buildPdf('Hello from the server'));
    return true;
  }

  // A TIFF: sniffable, real, and not something any browser paints. The page
  // has to say that rather than offer a button onto a blank box.
  // A real, playable WAV — a tenth of a second of a quiet sine. Synthesized
  // rather than checked in so the fixture cannot drift from the header that
  // describes it, and short enough that the whole thing is a kilobyte.
  if (pathname === '/__echo/audio') {
    const rate = 8000;
    const samples = rate / 10;
    const data = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i += 1) {
      data.writeInt16LE(Math.round(Math.sin((i / rate) * 440 * 2 * Math.PI) * 4000), i * 2);
    }
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16); // PCM chunk size
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28); // byte rate
    header.writeUInt16LE(2, 32); // block align
    header.writeUInt16LE(16, 34); // bits per sample
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);
    res
      .writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'no-store' })
      .end(Buffer.concat([header, data]));
    return true;
  }

  if (pathname === '/__echo/tiff') {
    const tiff = Buffer.concat([
      Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
      Buffer.alloc(24, 0x41),
    ]);
    res.writeHead(200, { 'content-type': 'image/tiff', 'cache-control': 'no-store' }).end(tiff);
    return true;
  }

  // Bodies whose only job is to be syntax-highlighted.
  const HIGHLIGHTED = {
    '/__echo/css': ['text/css', '.card > p {\n  color: #ff0000; /* red */\n}\n'],
    '/__echo/js': ['application/javascript', 'const greet = (who) => `hello ${who}`;\n'],
    '/__echo/xml': [
      'application/xml',
      '<?xml version="1.0"?>\n<catalog><item id="1">A &amp; B</item></catalog>\n',
    ],
    '/__echo/markdown': ['text/markdown', '# Title\n\nSome *emphasis* and `code`.\n'],
  };
  if (HIGHLIGHTED[pathname]) {
    const [type, body] = HIGHLIGHTED[pathname];
    res
      .writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' })
      .end(body);
    return true;
  }

  // The two-step auth scenario Phase 5's flows are built against: POST here
  // and you get a token; GET /__echo/me and you need it. Deliberately a real
  // dependency between two requests, so a flow that fails to carry the token
  // fails visibly rather than passing on a coincidence.
  if (pathname === '/__echo/auth') {
    res
      .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify({ token: 'flow-token-abc', expires_in: 3600 }));
    return true;
  }

  if (pathname === '/__echo/me') {
    const auth = req.headers.authorization ?? '';
    if (auth !== 'Bearer flow-token-abc') {
      res
        .writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify({ error: 'no token', saw: auth }));
      return true;
    }
    res
      .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify({ name: 'the authenticated one', saw: auth }));
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
