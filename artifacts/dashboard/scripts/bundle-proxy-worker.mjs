#!/usr/bin/env node
// Builds a PROXY frontend worker:
//   - Serves the React SPA (static files embedded)
//   - /api/* requests → silently proxied to BACKEND_URL (mr-robot worker, hidden from user)
// Output: dist/proxy-frontend-worker.mjs

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(__dirname, '../dist/public');
const OUT = join(__dirname, '../dist/proxy-frontend-worker.mjs');

// The hidden backend URL — users will never see this in their browser bar
const BACKEND_URL = process.env.BACKEND_URL || 'https://mr-robot.s39452363.workers.dev';

function getMime(f) {
  if (f.endsWith('.js')) return 'application/javascript';
  if (f.endsWith('.css')) return 'text/css';
  if (f.endsWith('.html')) return 'text/html';
  if (f.endsWith('.svg')) return 'image/svg+xml';
  if (f.endsWith('.jpg') || f.endsWith('.jpeg')) return 'image/jpeg';
  if (f.endsWith('.png')) return 'image/png';
  if (f.endsWith('.ico')) return 'image/x-icon';
  if (f.endsWith('.txt')) return 'text/plain';
  if (f.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

const SKIP_FILES = ['MR_ROBOT.apk', '_headers', '_worker.js', '_worker.js.pages'];
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const assets = {};
function walk(dir, rel) {
  for (const f of readdirSync(dir)) {
    const abs = join(dir, f);
    const relPath = (rel ? rel + '/' : '') + f;
    if (SKIP_FILES.includes(f) || f.startsWith('.')) continue;
    const stat = statSync(abs);
    if (stat.isDirectory()) { walk(abs, relPath); continue; }
    if (stat.size > MAX_FILE_BYTES) {
      console.warn(`Skipping large file: ${relPath} (${Math.round(stat.size/1024)}KB)`);
      continue;
    }
    const content = readFileSync(abs);
    const mime = getMime(f);
    const isBinary = mime.startsWith('image/') && !mime.includes('svg');
    assets['/' + relPath] = {
      mime,
      data: isBinary ? content.toString('base64') : content.toString('utf8'),
      binary: isBinary,
    };
  }
}
walk(DIST, '');

console.log(`Embedded ${Object.keys(assets).length} assets`);

const workerCode = `
// ── Proxy Frontend Worker ──────────────────────────────────────────────────
// Frontend URL (visible to user): sky-portal.s39452363.workers.dev
// Backend  URL (completely hidden): ${BACKEND_URL}
// /api/* calls are transparently proxied — user/DevTools only see sky-portal domain
// ───────────────────────────────────────────────────────────────────────────

const __STATIC = ${JSON.stringify(assets)};
const __BACKEND = '${BACKEND_URL}';

function getCacheHeader(p) {
  if (p.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  return 'public, max-age=86400';
}

function serveStaticOrSPA(urlPath) {
  const asset = __STATIC[urlPath] || __STATIC[urlPath + '/index.html'];
  if (asset) {
    let body;
    if (asset.binary) {
      const bstr = atob(asset.data);
      const bytes = new Uint8Array(bstr.length);
      for (let i = 0; i < bstr.length; i++) bytes[i] = bstr.charCodeAt(i);
      body = bytes;
    } else {
      body = asset.data;
    }
    const ct = asset.mime + (asset.mime.startsWith('text/') || asset.mime === 'application/javascript' ? '; charset=utf-8' : '');
    return new Response(body, { headers: { 'Content-Type': ct, 'Cache-Control': getCacheHeader(urlPath) } });
  }
  const html = __STATIC['/index.html'];
  if (html) return new Response(html.data, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
  return new Response('Not Found', { status: 404 });
}

export default {
  async fetch(request, _env, _ctx) {
    const url = new URL(request.url);

    // ── Transparent API proxy — forward to hidden backend ──
    if (url.pathname.startsWith('/api/')) {
      const backendReq = new Request(
        __BACKEND + url.pathname + url.search,
        {
          method: request.method,
          headers: request.headers,
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
          redirect: 'manual',
        }
      );
      return fetch(backendReq);
    }

    // ── WebSocket upgrade — proxy to backend ──
    if (request.headers.get('Upgrade') === 'websocket') {
      const backendReq = new Request(
        __BACKEND.replace('https://', 'wss://').replace('http://', 'ws://') + url.pathname + url.search,
        request
      );
      return fetch(backendReq);
    }

    // ── Short URL: /?appId=X → /d/X ──
    if (url.pathname === '/' && url.searchParams.has('appId')) {
      const appId = url.searchParams.get('appId');
      return Response.redirect(url.origin + '/d/' + encodeURIComponent(appId), 302);
    }

    // ── SPA routing ──
    return serveStaticOrSPA(url.pathname);
  },
};
`;

writeFileSync(OUT, workerCode);
const sizeKB = Math.round(Buffer.byteLength(workerCode, 'utf8') / 1024);
console.log(`\nProxy frontend worker written: ${OUT} (${sizeKB}KB)`);
if (sizeKB > 900) console.warn('WARNING: Worker size near 1MB limit!');
