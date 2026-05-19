import { Router, type IRouter, type Request } from "express";
import multer from "multer";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync, createReadStream } from "fs";
import { resolve, extname } from "path";
import { randomUUID } from "crypto";

type CoreAppMeta = {
  id: string;
  filename: string;
  storedAs: string;
  sizeBytes: number;
  mimeType: string;
  uploadedAt: string;
};

const DATA_DIR = resolve(process.cwd(), "data", "core-app");
const META_FILE = resolve(DATA_DIR, "meta.json");

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readMeta(): CoreAppMeta | null {
  ensureDir();
  if (!existsSync(META_FILE)) return null;
  try {
    const raw = JSON.parse(readFileSync(META_FILE, "utf8")) as CoreAppMeta;
    const filePath = resolve(DATA_DIR, raw.storedAs);
    if (!existsSync(filePath)) {
      unlinkSync(META_FILE);
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

function writeMeta(meta: CoreAppMeta) {
  ensureDir();
  writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
}

function clearMeta(meta: CoreAppMeta | null) {
  if (!meta) return;
  try { unlinkSync(resolve(DATA_DIR, meta.storedAs)); } catch {}
  try { unlinkSync(META_FILE); } catch {}
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { ensureDir(); cb(null, DATA_DIR); },
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname) || ".apk";
      cb(null, `core-${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB cap
});

const router: IRouter = Router();

router.get("/core-app", (_req, res) => {
  const meta = readMeta();
  if (!meta) { res.json({ exists: false, app: null }); return; }
  res.json({ exists: true, app: meta });
});

router.post("/core-app", upload.single("file"), (req: Request, res) => {
  const existing = readMeta();
  if (existing) {
    if (req.file) { try { unlinkSync(req.file.path); } catch {} }
    res.status(409).json({ error: "Core app already exists. Delete it first to upload a new one." });
    return;
  }
  if (!req.file) { res.status(400).json({ error: "No file uploaded (field name: 'file')" }); return; }

  const meta: CoreAppMeta = {
    id: randomUUID(),
    filename: req.file.originalname,
    storedAs: req.file.filename,
    sizeBytes: req.file.size,
    mimeType: req.file.mimetype || "application/vnd.android.package-archive",
    uploadedAt: new Date().toISOString(),
  };
  writeMeta(meta);
  res.status(201).json({ ok: true, app: meta });
});

router.delete("/core-app", (_req, res) => {
  const meta = readMeta();
  if (!meta) { res.status(404).json({ error: "No core app to delete" }); return; }
  clearMeta(meta);
  res.json({ ok: true });
});

router.get("/core-app/download", (_req, res) => {
  const meta = readMeta();
  if (!meta) { res.status(404).json({ error: "No core app available" }); return; }
  const filePath = resolve(DATA_DIR, meta.storedAs);
  if (!existsSync(filePath)) { res.status(404).json({ error: "File missing on server" }); return; }
  const stats = statSync(filePath);
  res.setHeader("Content-Type", meta.mimeType);
  res.setHeader("Content-Length", String(stats.size));
  res.setHeader("Content-Disposition", `attachment; filename="${meta.filename.replace(/"/g, "")}"`);
  createReadStream(filePath).pipe(res);
});

export default router;
