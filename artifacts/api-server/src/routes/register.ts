import { Router, type IRouter } from "express";
import { localDb } from "../lib/local-db";
import { sseEmit } from "../lib/sse";

const router: IRouter = Router();

router.post("/register", async (req, res) => {
  const { appId, deviceId, userId, name, androidVersion, sim1Carrier, sim1Phone, sim2Carrier, sim2Phone, fcmToken } = req.body as Record<string, unknown>;
  if (!appId || !deviceId || !name) {
    res.status(400).json({ error: "appId, deviceId and name are required" });
    return;
  }
  const safeAppId = String(appId);

  // Auto-create the app if it doesn't exist yet — lets Android register with any appId
  if (!(await localDb.getApp(safeAppId))) {
    try {
      await localDb.createApp({ appId: safeAppId, name: safeAppId, pin: "1234", status: "active" });
    } catch {
      // APP_EXISTS race condition — safe to ignore
    }
  }

  const uid = String(userId ?? `USR-${String(deviceId).slice(-6).toUpperCase()}`);
  const now = new Date().toISOString();
  const { row, created } = await localDb.upsertDevice({
    appId: safeAppId,
    deviceId: String(deviceId),
    userId: uid,
    name: String(name),
    androidVersion: Number(androidVersion ?? 0),
    sim1Carrier: sim1Carrier != null ? String(sim1Carrier) : null,
    sim1Phone: sim1Phone != null ? String(sim1Phone) : null,
    sim2Carrier: sim2Carrier != null ? String(sim2Carrier) : null,
    sim2Phone: sim2Phone != null ? String(sim2Phone) : null,
    fcmToken: fcmToken != null ? String(fcmToken) : null,
    status: "online",
    lastOnline: now,
    forwardEnabled: false,
    forwardSlot: null,
  });
  sseEmit("device_updated", { ...row });
  res.status(created ? 201 : 200).json({ ok: true, deviceId: row.deviceId, created });
});

router.post("/heartbeat", async (req, res) => {
  const { deviceId, fcmToken, appId } = req.body as Record<string, unknown>;
  if (!deviceId) { res.status(400).json({ error: "deviceId is required" }); return; }
  const uid = String(deviceId);
  const now = new Date().toISOString();

  let row = await localDb.updateDevice(uid, { status: "online", lastOnline: now, ...(fcmToken != null ? { fcmToken: String(fcmToken) } : {}) });

  // Auto-register device if not found — heartbeat = implicit registration
  if (!row) {
    const safeAppId = appId ? String(appId) : "SKY-APP-2026-X9F3";
    if (!(await localDb.getApp(safeAppId))) {
      try { await localDb.createApp({ appId: safeAppId, name: safeAppId, pin: "1234", status: "active" }); } catch {}
    }
    const { row: created } = await localDb.upsertDevice({
      appId: safeAppId, deviceId: uid,
      userId: `USR-${uid.slice(-6).toUpperCase()}`,
      name: uid, androidVersion: 0,
      sim1Carrier: null, sim1Phone: null, sim2Carrier: null, sim2Phone: null,
      fcmToken: fcmToken != null ? String(fcmToken) : null,
      status: "online", lastOnline: now, forwardEnabled: false, forwardSlot: null,
    });
    row = created;
  }

  sseEmit("device_updated", { ...row });
  res.json({ ok: true });
});

export default router;
