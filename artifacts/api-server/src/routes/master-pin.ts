import { Router, type IRouter } from "express";
import { pool } from "../lib/db";
import { hashPin, verifyPin, isHashed } from "../lib/hash";
import { hasActiveSession } from "./admin-sessions";

const router: IRouter = Router();
const DEFAULT_MASTER_PIN = "master1234";

async function getStoredMasterPin(): Promise<string> {
  const r = await pool.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'master_pin'`,
  );
  return r.rows[0]?.value ?? DEFAULT_MASTER_PIN;
}

async function setMasterPinHash(plain: string): Promise<void> {
  const hashed = hashPin(plain);
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('master_pin', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
    [hashed],
  );
}

// Lock status — frontend polls this to force-logout any active master session
router.get("/admin/master-lock-status", (_req, res) => {
  res.json({ locked: true });
});

router.post("/admin/verify-master-pin", async (req, res) => {
  // MASTER ADMIN LOGIN DISABLED — account security lock
  res.status(403).json({ error: "Master admin login abhi disabled hai. Admin se contact karo." });
});

router.patch("/admin/master-pin", async (req, res) => {
  const { currentPin, newPin } = req.body as { currentPin?: string; newPin?: string };
  if (!currentPin || !newPin) { res.status(400).json({ error: "currentPin and newPin required" }); return; }
  if (newPin.length < 4) { res.status(400).json({ error: "PIN must be at least 4 characters" }); return; }
  const stored = await getStoredMasterPin();
  if (!verifyPin(currentPin, stored)) { res.status(401).json({ error: "Current PIN is wrong" }); return; }
  await setMasterPinHash(newPin);
  res.json({ ok: true });
});

export default router;
