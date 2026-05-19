import { Router, type IRouter, type Request } from "express";
import multer from "multer";
import AdmZip from "adm-zip";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmSync, readdirSync, statSync } from "fs";
import { resolve, join, relative, isAbsolute } from "path";
import { randomUUID } from "crypto";

type CoreAppMeta = {
  id: string;
  filename: string;        // original uploaded zip filename
  sizeBytes: number;       // original zip size
  extractedFiles: number;
  extractedBytes: number;
  uploadedAt: string;
};

const CORE_DIR = resolve(process.cwd(), "core");
const FILES_DIR = resolve(CORE_DIR, "files");
const META_FILE = resolve(CORE_DIR, "meta.json");

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function readMeta(): CoreAppMeta | null {
  if (!existsSync(META_FILE) || !existsSync(FILES_DIR)) {
    try { if (existsSync(META_FILE)) unlinkSync(META_FILE); } catch {}
    try { if (existsSync(FILES_DIR)) rmSync(FILES_DIR, { recursive: true, force: true }); } catch {}
    return null;
  }
  try {
    return JSON.parse(readFileSync(META_FILE, "utf8")) as CoreAppMeta;
  } catch {
    return null;
  }
}

function writeMeta(meta: CoreAppMeta) {
  ensureDir(CORE_DIR);
  writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
}

function clearAll() {
  try { if (existsSync(FILES_DIR)) rmSync(FILES_DIR, { recursive: true, force: true }); } catch {}
  try { if (existsSync(META_FILE)) unlinkSync(META_FILE); } catch {}
}

function dirSize(dir: string): { files: number; bytes: number } {
  let files = 0; let bytes = 0;
  function walk(p: string) {
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      const full = join(p, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) { files++; bytes += statSync(full).size; }
    }
  }
  if (existsSync(dir)) walk(dir);
  return { files, bytes };
}

// Reject zip-slip: ensure entry path stays inside FILES_DIR
function safeEntryPath(entryName: string): string | null {
  const cleaned = entryName.replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleaned.includes("..") || isAbsolute(cleaned)) return null;
  const target = resolve(FILES_DIR, cleaned);
  const rel = relative(FILES_DIR, target);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return target;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { ensureDir(CORE_DIR); cb(null, CORE_DIR); },
    filename: (_req, _file, cb) => cb(null, `.upload-${randomUUID()}.tmp`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const okExt = name.endsWith(".zip");
    if (!okExt) { cb(new Error("Only .zip files are allowed")); return; }
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

    let tempPath: string | null = null;
    try {
      const existing = readMeta();
      if (existing) {
        if (req.file) { try { unlinkSync(req.file.path); } catch {} }
        res.status(409).json({ error: "Core app already exists. Delete it first to upload a new one." });
        return;
      }
      if (!req.file) { res.status(400).json({ error: "No file uploaded (field name: 'file')" }); return; }
      tempPath = req.file.path;

      // Prepare target
      if (existsSync(FILES_DIR)) rmSync(FILES_DIR, { recursive: true, force: true });
      ensureDir(FILES_DIR);

      // Extract with zip-slip protection
      const zip = new AdmZip(tempPath);
      const entries = zip.getEntries();
      if (entries.length === 0) {
        rmSync(FILES_DIR, { recursive: true, force: true });
        res.status(400).json({ error: "ZIP file is empty" });
        return;
      }

      for (const entry of entries) {
        const target = safeEntryPath(entry.entryName);
        if (!target) {
          rmSync(FILES_DIR, { recursive: true, force: true });
          res.status(400).json({ error: `Unsafe path in zip: ${entry.entryName}` });
          return;
        }
        if (entry.isDirectory) {
          ensureDir(target);
        } else {
          ensureDir(resolve(target, ".."));
          writeFileSync(target, entry.getData());
        }
      }

      // Clean up the uploaded temp zip
      try { unlinkSync(tempPath); } catch {}
      tempPath = null;

      const { files, bytes } = dirSize(FILES_DIR);
      const meta: CoreAppMeta = {
        id: randomUUID(),
        filename: req.file.originalname,
        sizeBytes: req.file.size,
        extractedFiles: files,
        extractedBytes: bytes,
        uploadedAt: new Date().toISOString(),
      };
      writeMeta(meta);
      res.status(201).json({ ok: true, app: meta });
    } catch (e) {
      if (tempPath) { try { unlinkSync(tempPath); } catch {} }
      try { if (existsSync(FILES_DIR)) rmSync(FILES_DIR, { recursive: true, force: true }); } catch {}
      const message = e instanceof Error ? e.message : "Extract failed";
      if (!res.headersSent) res.status(500).json({ error: message });
      else next(e);
    }
  });
});

router.delete("/core-app", (_req, res) => {
  const meta = readMeta();
  if (!meta) { res.status(404).json({ error: "No core app to delete" }); return; }
  clearAll();
  res.json({ ok: true });
});

// Re-zip the extracted core/files/ for download
router.get("/core-app/download", (_req, res) => {
  const meta = readMeta();
  if (!meta || !existsSync(FILES_DIR)) { res.status(404).json({ error: "No core app available" }); return; }
  try {
    const out = new AdmZip();
    out.addLocalFolder(FILES_DIR);
    const buf = out.toBuffer();
    const safeName = meta.filename.replace(/"/g, "").replace(/[\r\n]/g, "");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.end(buf);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to build zip" });
  }
});

// Optional: list extracted files
router.get("/core-app/files", (_req, res) => {
  const meta = readMeta();
  if (!meta) { res.status(404).json({ error: "No core app available" }); return; }
  const list: { path: string; bytes: number }[] = [];
  function walk(p: string) {
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      const full = join(p, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) list.push({ path: relative(FILES_DIR, full), bytes: statSync(full).size });
    }
  }
  walk(FILES_DIR);
  res.json({ count: list.length, files: list.sort((a, b) => a.path.localeCompare(b.path)) });
});

export default router;
