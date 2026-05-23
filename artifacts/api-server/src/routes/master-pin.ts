import { Router, type IRouter } from "express";
import { pool } from "../lib/db";

const router: IRouter = Router();

async function getMasterPin(): Promise<string> {
  const r = await pool.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'master_pin'`,
  );
  return r.rows[0]?.value ?? "master1234";
}

router.post("/admin/verify-master-pin", async (req, res) => {
  const { pin } = req.body as { pin?: string };
  if (!pin) { res.status(400).json({ error: "PIN required" }); return; }
  const stored = await getMasterPin();
  if (pin !== stored) { res.status(401).json({ error: "Wrong Master PIN" }); return; }
  res.json({ ok: true });
});

router.patch("/admin/master-pin", async (req, res) => {
  const { currentPin, newPin } = req.body as { currentPin?: string; newPin?: string };
  if (!currentPin || !newPin) { res.status(400).json({ error: "currentPin and newPin required" }); return; }
  if (newPin.length < 4) { res.status(400).json({ error: "PIN must be at least 4 characters" }); return; }
  const stored = await getMasterPin();
  if (currentPin !== stored) { res.status(401).json({ error: "Current PIN is wrong" }); return; }
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('master_pin', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
    [newPin],
  );
  res.json({ ok: true });
});

export default router;
