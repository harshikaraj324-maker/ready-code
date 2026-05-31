#!/usr/bin/env node
// Deploys dist/proxy-frontend-worker.mjs to Cloudflare Workers as "sky-portal"
// This is the FRONTEND-ONLY worker — completely different URL from the API backend.
// Users see: sky-portal.s39452363.workers.dev
// API backend stays hidden at: mr-robot.s39452363.workers.dev

import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { request as httpsRequest } from 'https';
import { fileURLToPath } from 'url';
import { join } from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const CF_TOKEN = process.env.CF_TOKEN;
const CF_ACCOUNT = process.env.CF_ACCOUNT || process.env.CLOUDFLARE_ACCOUNT_ID;
const WORKER_NAME = process.env.PROXY_WORKER_NAME || 'sky-portal';

if (!CF_TOKEN || !CF_ACCOUNT) {
  console.error('Missing CF_TOKEN or CF_ACCOUNT env vars');
  process.exit(1);
}

const workerScript = readFileSync(join(__dirname, '../dist/proxy-frontend-worker.mjs'), 'utf8');

const metadata = {
  main_module: 'worker.mjs',
  compatibility_date: '2024-12-01',
  compatibility_flags: ['nodejs_compat'],
  bindings: [],
};

const boundary = '----ProxyWorkerBoundary' + randomBytes(8).toString('hex');
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
console.log(`Uploading proxy frontend worker "${WORKER_NAME}"... ${Math.round(body.length / 1024)}KB`);

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

const uploadResult = await apiRequest(
  `/client/v4/accounts/${CF_ACCOUNT}/workers/scripts/${WORKER_NAME}`,
  'PUT', body,
  { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
);

if (!uploadResult.success) {
  console.error('Upload failed:', JSON.stringify(uploadResult.errors));
  process.exit(1);
}
console.log('Worker uploaded. etag:', uploadResult.result?.etag?.slice(0, 8));

// Enable workers.dev subdomain
const subResult = await apiRequest(
  `/client/v4/accounts/${CF_ACCOUNT}/workers/scripts/${WORKER_NAME}/subdomain`,
  'POST',
  Buffer.from(JSON.stringify({ enabled: true })),
  { 'Content-Type': 'application/json' }
);

const subdomain = 's39452363';
if (subResult.success) {
  console.log(`\n✅ Frontend deployed!`);
  console.log(`🌐 Frontend URL: https://${WORKER_NAME}.${subdomain}.workers.dev`);
  console.log(`🔒 Backend API:  https://mr-robot.${subdomain}.workers.dev  (hidden)`);
  console.log(`\nShare with users: https://${WORKER_NAME}.${subdomain}.workers.dev/d/<appId>`);
} else {
  console.warn('Subdomain warning:', JSON.stringify(subResult.errors));
}
