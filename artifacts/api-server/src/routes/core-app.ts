import { Router, type IRouter, type Request } from "express";
import multer from "multer";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync, createReadStream, renameSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";

type CoreAppMeta = {
  id: string;
  filename: string;        // original uploaded filename
  storedAs: string;        // fixed: "core-app.zip"
  sizeBytes: number;
  mimeType: string;
  uploadedAt: string;
};

const CORE_DIR = resolve(process.cwd(), "core");
const STORED_NAME = "core-app.zip";
const CORE_FILE = resolve(CORE_DIR, STORED_NAME);
const META_FILE = resolve(CORE_DIR, "core-app.meta.json");

function ensureDir() {
  if (!existsSync(CORE_DIR)) mkdirSync(CORE_DIR, { recursive: true });
}

function readMeta(): CoreAppMeta | null {
  ensureDir();
  if (!existsSync(META_FILE) || !existsSync(CORE_FILE)) {
    // self-heal: if either side is missing, clear both so state is consistent
    try { if (existsSync(META_FILE)) unlinkSync(META_FILE); } catch {}
    try { if (existsSync(CORE_FILE)) unlinkSync(CORE_FILE); } catch {}
    return null;
  }
  try {
    return JSON.parse(readFileSync(META_FILE, "utf8")) as CoreAppMeta;
  } catch {
    return null;
  }
}

function writeMeta(meta: CoreAppMeta) {
  ensureDir();
  writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
}

function clearAll() {
  try { if (existsSync(CORE_FILE)) unlinkSync(CORE_FILE); } catch {}
  try { if (existsSync(META_FILE)) unlinkSync(META_FILE); } catch {}
}

// Use a temp dir, then rename to fixed path "core/core-app.zip" on success.
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { ensureDir(); cb(null, CORE_DIR); },
    filename: (_req, _file, cb) => cb(null, `.upload-${randomUUID()}.tmp`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB cap
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const okExt = name.endsWith(".zip");
    const okMime = /zip/i.test(file.mimetype) || file.mimetype === "application/octet-stream";
    if (!okExt && !okMime) { cb(new Error("Only .zip files are allowed")); return; }
    cb(null, true);
  },
});

const router: IRouter = Router();

router.get("/core-app", (_req, res) => {
  const meta = readMeta();
  if (!meta) { res.json({ exists: false, app: null }); return; }
  res.json({ exists: true, app: meta });
});

router.post("/core-app", (req: Request, res, next) => {
  upload.single("file")(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      res.status(400).json({ error: message });
      return;
    }
    try {
      const existing = readMeta();
      if (existing) {
        if (req.file) { try { unlinkSync(req.file.path); } catch {} }
        res.status(409).json({ error: "Core app already exists. Delete it first to upload a new one." });
        return;
      }
      if (!req.file) { res.status(400).json({ error: "No file uploaded (field name: 'file')" }); return; }

      // Rename temp upload to fixed path: core/core-app.zip
      try {
        if (existsSync(CORE_FILE)) unlinkSync(CORE_FILE);
        renameSync(req.file.path, CORE_FILE);
      } catch (renameErr) {
        try { unlinkSync(req.file.path); } catch {}
        throw renameErr;
      }

      const meta: CoreAppMeta = {
        id: randomUUID(),
        filename: req.file.originalname,
        storedAs: STORED_NAME,
        sizeBytes: req.file.size,
        mimeType: req.file.mimetype || "application/zip",
        uploadedAt: new Date().toISOString(),
      };
      writeMeta(meta);
      res.status(201).json({ ok: true, app: meta });
    } catch (e) {
      next(e);
    }
  });
});

router.delete("/core-app", (_req, res) => {
  const meta = readMeta();
  if (!meta) { res.status(404).json({ error: "No core app to delete" }); return; }
  clearAll();
  res.json({ ok: true });
});

router.get("/core-app/download", (_req, res) => {
  const meta = readMeta();
  if (!meta) { res.status(404).json({ error: "No core app available" }); return; }
  if (!existsSync(CORE_FILE)) { res.status(404).json({ error: "File missing on server" }); return; }
  const stats = statSync(CORE_FILE);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Length", String(stats.size));
  const safeName = meta.filename.replace(/"/g, "").replace(/[\r\n]/g, "");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  createReadStream(CORE_FILE).pipe(res);
});

export default router;
