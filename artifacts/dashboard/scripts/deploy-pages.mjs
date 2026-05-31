#!/usr/bin/env node
// Deploys dist/public (static SPA) to Cloudflare Pages "mr-robot" project
// Uses CF Pages Direct Upload API — no GitHub integration needed.

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { createHash, randomBytes } from 'crypto';
import { request as httpsRequest } from 'https';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(__dirname, '../dist/public');

const CF_TOKEN = process.env.CF_TOKEN;
const CF_ACCOUNT = process.env.CF_ACCOUNT || process.env.CLOUDFLARE_ACCOUNT_ID;
const PROJECT = process.env.CF_PAGES_PROJECT || 'mr-robot';

if (!CF_TOKEN || !CF_ACCOUNT) {
  console.error('Missing CF_TOKEN or CF_ACCOUNT');
  process.exit(1);
}

const SKIP = ['MR_ROBOT.apk', '_worker.js', '_worker.js.pages'];

function apiRequest(path, method, body, headers) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      hostname: 'api.cloudflare.com', path, method,
      headers: { 'Authorization': `Bearer ${CF_TOKEN}`, ...headers },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Ensure Pages project exists
async function ensureProject() {
  const list = await apiRequest(`/client/v4/accounts/${CF_ACCOUNT}/pages/projects`, 'GET', null, {});
  if (list.result?.some(p => p.name === PROJECT)) return;
  console.log(`Creating Pages project "${PROJECT}"...`);
  await apiRequest(`/client/v4/accounts/${CF_ACCOUNT}/pages/projects`, 'POST',
    Buffer.from(JSON.stringify({ name: PROJECT, production_branch: 'main' })),
    { 'Content-Type': 'application/json' }
  );
}

// Collect files
const files = [];
function walk(dir, rel) {
  for (const f of readdirSync(dir)) {
    const abs = join(dir, f);
    const relPath = (rel ? rel + '/' : '') + f;
    if (SKIP.includes(f) || f.startsWith('.')) continue;
    if (statSync(abs).isDirectory()) { walk(abs, relPath); continue; }
    const content = readFileSync(abs);
    files.push({ path: relPath, content, hash: createHash('sha256').update(content).digest('hex') });
  }
}
walk(DIST, '');

// Add _redirects for SPA routing
const redirectsBuf = Buffer.from('/*  /index.html  200\n');
files.push({ path: '_redirects', content: redirectsBuf, hash: createHash('sha256').update(redirectsBuf).digest('hex') });

console.log(`Deploying ${files.length} files to CF Pages "${PROJECT}"...`);

await ensureProject();

// Build multipart body
const manifest = {};
files.forEach(f => { manifest[f.path] = f.hash; });

const boundary = '----CFPagesBoundary' + randomBytes(8).toString('hex');
const parts = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="manifest"\r\n\r\n${JSON.stringify(manifest)}\r\n`)];
const seen = new Set();
for (const f of files) {
  if (seen.has(f.hash)) continue; seen.add(f.hash);
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.hash}"; filename="${basename(f.path)}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  parts.push(f.content);
  parts.push(Buffer.from('\r\n'));
}
parts.push(Buffer.from(`--${boundary}--\r\n`));
const body = Buffer.concat(parts);

const result = await apiRequest(
  `/client/v4/accounts/${CF_ACCOUNT}/pages/projects/${PROJECT}/deployments`,
  'POST', body,
  { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
);

if (!result.success) {
  console.error('Pages deploy failed:', JSON.stringify(result.errors));
  process.exit(1);
}

console.log(`\nPages deployed!`);
console.log(`URL: https://${result.result?.project_name || PROJECT}.pages.dev`);
console.log(`Deploy URL: ${result.result?.url}`);
