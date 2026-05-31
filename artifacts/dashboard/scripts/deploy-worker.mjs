#!/usr/bin/env node
// Deploys dist/combined-worker.mjs to Cloudflare Workers as "ready-code-dashboard"

import { readFileSync } from 'fs';
import { createHash, randomBytes } from 'crypto';
import { request as httpsRequest } from 'https';
import { fileURLToPath } from 'url';
import { join } from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const CF_TOKEN = process.env.CF_TOKEN;
const CF_ACCOUNT = process.env.CF_ACCOUNT || process.env.CLOUDFLARE_ACCOUNT_ID;
const NEON_URL = process.env.NEON_DATABASE_URL;
const DO_NS_ID = process.env.EVENT_BUS_DO_NS_ID || 'e9ef6c83030d40af892d695000fdff23';
const WORKER_NAME = process.env.WORKER_NAME || 'ready-code-dashboard';

if (!CF_TOKEN || !CF_ACCOUNT) {
  console.error('Missing CF_TOKEN or CF_ACCOUNT env vars');
  process.exit(1);
}
if (!NEON_URL) {
  console.error('Missing NEON_DATABASE_URL env var');
  process.exit(1);
}

const workerScript = readFileSync(join(__dirname, '../dist/combined-worker.mjs'), 'utf8');

const metadata = {
  main_module: 'worker.mjs',
  compatibility_date: '2024-12-01',
  compatibility_flags: ['nodejs_compat'],
  bindings: [
    { type: 'secret_text', name: 'NEON_DATABASE_URL', text: NEON_URL },
    { type: 'durable_object_namespace', name: 'EVENT_BUS', namespace_id: DO_NS_ID },
  ],
};

const boundary = '----WorkerBoundary' + randomBytes(8).toString('hex');
const parts = [];

parts.push(Buffer.from(
  `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n` +
  JSON.stringify(metadata) + '\r\n'
));
parts.push(Buffer.from(
  `--${boundary}\r\nContent-Disposition: form-data; name="worker.mjs"; filename="worker.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n`
));
parts.push(Buffer.from(workerScript, 'utf8'));
parts.push(Buffer.from('\r\n'));
parts.push(Buffer.from(`--${boundary}--\r\n`));

const body = Buffer.concat(parts);
console.log(`Uploading worker "${WORKER_NAME}"... ${Math.round(body.length / 1024)}KB`);

function apiRequest(path, method, body, headers) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      hostname: 'api.cloudflare.com',
      path,
      method,
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

// Deploy worker
const uploadResult = await apiRequest(
  `/client/v4/accounts/${CF_ACCOUNT}/workers/scripts/${WORKER_NAME}`,
  'PUT',
  body,
  { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
);

if (!uploadResult.success) {
  console.error('Upload failed:', JSON.stringify(uploadResult.errors));
  process.exit(1);
}
console.log('Worker uploaded. etag:', uploadResult.result?.etag?.slice(0, 8));

// Enable workers.dev subdomain
const subdomainResult = await apiRequest(
  `/client/v4/accounts/${CF_ACCOUNT}/workers/scripts/${WORKER_NAME}/subdomain`,
  'POST',
  Buffer.from(JSON.stringify({ enabled: true })),
  { 'Content-Type': 'application/json' }
);

if (subdomainResult.success) {
  const subdomain = 's39452363'; // will be read from env in future
  console.log(`\nDeployed! https://${WORKER_NAME}.${subdomain}.workers.dev`);
} else {
  console.warn('Subdomain enable warning:', JSON.stringify(subdomainResult.errors));
}
