import { useState, useEffect, useCallback } from "react";

const T = {
  bg: "#0f172a", card: "#1e293b", border: "#334155",
  text: "#f1f5f9", muted: "#94a3b8", accent: "#6366f1",
  green: "#22c55e", red: "#ef4444", yellow: "#f59e0b",
  inputBg: "#0f172a",
};

type App = {
  id: number; appId: string; name: string; pin: string;
  status: string; loginLimit: number; activeSessions: number; createdAt: string;
};

function generateAppId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const seg = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `APP-${seg(4)}-${seg(4)}-${seg(4)}`;
}

/* ─────────── Login Screen ─────────── */
function MasterLogin({ onAuth }: { onAuth: (pin: string) => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const r = await fetch("/api/admin/verify-master-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!r.ok) { setErr("Wrong master PIN. Try again."); setPin(""); return; }
      onAuth(pin);
    } catch { setErr("Network error. Try again."); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>
      <div style={{ width: 360, background: T.card, borderRadius: 16, padding: 36, border: `1px solid ${T.border}`, boxShadow: "0 20px 60px rgba(0,0,0,.5)" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🔐</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: T.text, letterSpacing: -0.5 }}>Master Admin</div>
          <div style={{ fontSize: 13, color: T.muted, marginTop: 4 }}>MR ROBOT Control Panel</div>
        </div>
        <form onSubmit={handleSubmit}>
          <label style={{ fontSize: 11, color: T.muted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Master PIN</label>
          <input
            type="password"
            value={pin}
            onChange={e => setPin(e.target.value)}
            placeholder="Enter master PIN"
            autoFocus
            style={{ width: "100%", marginTop: 6, padding: "12px 14px", borderRadius: 10, border: `1.5px solid ${T.border}`, background: T.inputBg, color: T.text, fontSize: 15, outline: "none", boxSizing: "border-box" }}
          />
          {err && <div style={{ color: T.red, fontSize: 13, marginTop: 8, textAlign: "center" }}>{err}</div>}
          <button
            type="submit"
            disabled={loading || !pin}
            style={{ width: "100%", marginTop: 18, padding: "13px 0", borderRadius: 10, background: pin && !loading ? T.accent : T.border, color: "#fff", fontWeight: 700, fontSize: 15, border: "none", cursor: pin && !loading ? "pointer" : "default", letterSpacing: 0.3 }}
          >
            {loading ? "Verifying…" : "Enter"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ─────────── Create App Modal ─────────── */
function CreateAppModal({ masterPin, onClose, onCreated }: { masterPin: string; onClose: () => void; onCreated: (a: App) => void }) {
  const [name, setName] = useState("");
  const [appId, setAppId] = useState(generateAppId);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !pin.trim()) { setErr("All fields required"); return; }
    if (pin.length < 4) { setErr("PIN must be at least 4 characters"); return; }
    setErr(""); setLoading(true);
    try {
      const r = await fetch("/api/master/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-master-pin": masterPin },
        body: JSON.stringify({ appId, name: name.trim(), pin }),
      });
      if (!r.ok) { const j = await r.json() as { error?: string }; setErr(j.error ?? "Failed"); return; }
      const created = await r.json() as App;
      onCreated(created);
    } catch { setErr("Network error"); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: 400, background: T.card, borderRadius: 16, padding: 32, border: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.text, marginBottom: 22 }}>Create New Sub-Admin App</div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: T.muted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>App Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Team Alpha"
              style={{ width: "100%", marginTop: 5, padding: "10px 12px", borderRadius: 8, border: `1.5px solid ${T.border}`, background: T.inputBg, color: T.text, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: T.muted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>App ID</label>
            <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
              <input type="text" value={appId} onChange={e => setAppId(e.target.value)}
                style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: `1.5px solid ${T.border}`, background: T.inputBg, color: T.text, fontSize: 13, outline: "none", fontFamily: "monospace" }} />
              <button type="button" onClick={() => setAppId(generateAppId())}
                style={{ padding: "10px 12px", borderRadius: 8, background: T.border, border: "none", color: T.text, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>↺</button>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: T.muted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Login PIN</label>
            <input type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder="min 4 characters"
              style={{ width: "100%", marginTop: 5, padding: "10px 12px", borderRadius: 8, border: `1.5px solid ${T.border}`, background: T.inputBg, color: T.text, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          {err && <div style={{ color: T.red, fontSize: 13, marginBottom: 10 }}>{err}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button type="button" onClick={onClose}
              style={{ flex: 1, padding: "12px 0", borderRadius: 10, background: T.border, border: "none", color: T.text, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
            <button type="submit" disabled={loading}
              style={{ flex: 1, padding: "12px 0", borderRadius: 10, background: T.accent, border: "none", color: "#fff", fontWeight: 700, cursor: loading ? "default" : "pointer" }}>
              {loading ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─────────── Change Master PIN Modal ─────────── */
function ChangePinModal({ masterPin, onClose, onChanged }: { masterPin: string; onClose: () => void; onChanged: (p: string) => void }) {
  const [currentPin, setCurrentPin] = useState(masterPin);
  const [newPin, setNewPin] = useState("");
  const [newPin2, setNewPin2] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPin.length < 4) { setErr("New PIN must be at least 4 characters"); return; }
    if (newPin !== newPin2) { setErr("PINs do not match"); return; }
    setErr(""); setLoading(true);
    try {
      const r = await fetch("/api/admin/master-pin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPin, newPin }),
      });
      if (!r.ok) { const j = await r.json() as { error?: string }; setErr(j.error ?? "Failed"); return; }
      onChanged(newPin);
    } catch { setErr("Network error"); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: 360, background: T.card, borderRadius: 16, padding: 32, border: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.text, marginBottom: 22 }}>Change Master PIN</div>
        <form onSubmit={handleSubmit}>
          {[
            { label: "Current PIN", val: currentPin, set: setCurrentPin },
            { label: "New PIN", val: newPin, set: setNewPin },
            { label: "Confirm New PIN", val: newPin2, set: setNewPin2 },
          ].map(({ label, val, set }) => (
            <div key={label} style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: T.muted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>{label}</label>
              <input type="password" value={val} onChange={e => set(e.target.value)}
                style={{ width: "100%", marginTop: 5, padding: "10px 12px", borderRadius: 8, border: `1.5px solid ${T.border}`, background: T.inputBg, color: T.text, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
            </div>
          ))}
          {err && <div style={{ color: T.red, fontSize: 13, marginBottom: 10 }}>{err}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button type="button" onClick={onClose}
              style={{ flex: 1, padding: "12px 0", borderRadius: 10, background: T.border, border: "none", color: T.text, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
            <button type="submit" disabled={loading}
              style={{ flex: 1, padding: "12px 0", borderRadius: 10, background: T.accent, border: "none", color: "#fff", fontWeight: 700, cursor: loading ? "default" : "pointer" }}>
              {loading ? "Saving…" : "Change PIN"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─────────── Edit App Modal ─────────── */
function EditAppModal({ app, masterPin, onClose, onUpdated }: { app: App; masterPin: string; onClose: () => void; onUpdated: (a: App) => void }) {
  const [name, setName] = useState(app.name);
  const [pin, setPin] = useState(app.pin);
  const [loginLimit, setLoginLimit] = useState(app.loginLimit ?? 5);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Name required"); return; }
    if (pin.length < 4) { setErr("PIN must be at least 4 characters"); return; }
    setErr(""); setLoading(true);
    try {
      const r = await fetch(`/api/master/apps/${encodeURIComponent(app.appId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-master-pin": masterPin },
        body: JSON.stringify({ name: name.trim(), pin, loginLimit }),
      });
      if (!r.ok) { const j = await r.json() as { error?: string }; setErr(j.error ?? "Failed"); return; }
      const updated = await r.json() as App;
      onUpdated({ ...updated, activeSessions: app.activeSessions });
    } catch { setErr("Network error"); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: 400, background: T.card, borderRadius: 16, padding: 32, border: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.text, marginBottom: 6 }}>Edit App</div>
        <div style={{ fontSize: 12, color: T.muted, marginBottom: 22, fontFamily: "monospace" }}>{app.appId}</div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: T.muted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>App Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              style={{ width: "100%", marginTop: 5, padding: "10px 12px", borderRadius: 8, border: `1.5px solid ${T.border}`, background: T.inputBg, color: T.text, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: T.muted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Login PIN</label>
            <input type="text" value={pin} onChange={e => setPin(e.target.value)}
              style={{ width: "100%", marginTop: 5, padding: "10px 12px", borderRadius: 8, border: `1.5px solid ${T.border}`, background: T.inputBg, color: T.text, fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "monospace" }} />
          </div>
          {/* Login Limit */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: T.muted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Max Concurrent Logins</label>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10 }}>
              <input
                type="range" min={1} max={100} step={1}
                value={loginLimit}
                onChange={e => setLoginLimit(Number(e.target.value))}
                style={{ flex: 1, accentColor: T.accent, cursor: "pointer", height: 4 }}
              />
              <div style={{ minWidth: 48, textAlign: "center", background: T.accent, color: "#fff", borderRadius: 8, padding: "6px 10px", fontWeight: 900, fontSize: 18, lineHeight: 1 }}>
                {loginLimit}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.muted, marginTop: 4, paddingRight: 62 }}>
              <span>1</span><span>25</span><span>50</span><span>75</span><span>100</span>
            </div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 6 }}>
              {loginLimit === 1 ? "Sirf 1 banda ek time pe logged in ho sakta hai" : `Max ${loginLimit} log ek saath logged in ho sakte hain`}
            </div>
          </div>
          {err && <div style={{ color: T.red, fontSize: 13, marginBottom: 10 }}>{err}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button type="button" onClick={onClose}
              style={{ flex: 1, padding: "12px 0", borderRadius: 10, background: T.border, border: "none", color: T.text, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
            <button type="submit" disabled={loading}
              style={{ flex: 1, padding: "12px 0", borderRadius: 10, background: T.accent, border: "none", color: "#fff", fontWeight: 700, cursor: loading ? "default" : "pointer" }}>
              {loading ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─────────── Dashboard ─────────── */
function Dashboard({ masterPin, onLogout, onPinChanged }: { masterPin: string; onLogout: () => void; onPinChanged: (p: string) => void }) {
  const [appList, setAppList] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showChangePin, setShowChangePin] = useState(false);
  const [editApp, setEditApp] = useState<App | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<Record<string, string>>({});
  const [logoutAllId, setLogoutAllId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fetchApps = useCallback(async () => {
    try {
      const r = await fetch("/api/master/apps", { headers: { "x-master-pin": masterPin } });
      if (r.status === 401) { onLogout(); return; }
      if (!r.ok) return;
      setAppList(await r.json() as App[]);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [masterPin, onLogout]);

  useEffect(() => { void fetchApps(); }, [fetchApps]);

  async function toggleStatus(app: App) {
    setTogglingId(app.appId);
    const newStatus = app.status === "active" ? "disabled" : "active";
    try {
      await fetch(`/api/master/apps/${encodeURIComponent(app.appId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-master-pin": masterPin },
        body: JSON.stringify({ status: newStatus }),
      });
      setAppList(prev => prev.map(a => a.appId === app.appId ? { ...a, status: newStatus } : a));
    } catch { /* ignore */ } finally { setTogglingId(null); }
  }

  async function deleteApp(app: App) {
    if (!confirm(`Delete "${app.name}"?\nThis cannot be undone.`)) return;
    setDeletingId(app.appId);
    try {
      await fetch(`/api/master/apps/${encodeURIComponent(app.appId)}`, {
        method: "DELETE",
        headers: { "x-master-pin": masterPin },
      });
      setAppList(prev => prev.filter(a => a.appId !== app.appId));
    } catch { /* ignore */ } finally { setDeletingId(null); }
  }

  async function logoutAll(app: App) {
    if (!confirm(`"${app.name}" ke sabhi logged-in users ko logout karein?`)) return;
    setLogoutAllId(app.appId);
    try {
      await fetch(`/api/admin/sessions?appId=${encodeURIComponent(app.appId)}`, { method: "DELETE" });
      setAppList(prev => prev.map(a => a.appId === app.appId ? { ...a, activeSessions: 0 } : a));
    } catch { /* ignore */ } finally { setLogoutAllId(null); }
  }

  function copyUrl(app: App) {
    const url = `https://mr-robot-5s3.pages.dev/preview/dashboard/WebDashboard?appId=${app.appId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopyMsg(p => ({ ...p, [app.appId]: "Copied!" }));
      setTimeout(() => setCopyMsg(p => ({ ...p, [app.appId]: "" })), 2000);
    });
  }

  const statusColor = (s: string) => s === "active" ? T.green : T.red;
  const filteredApps = search.trim() === "" ? appList : appList.filter(a =>
    a.appId.toLowerCase().includes(search.trim().toLowerCase()) ||
    a.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: "system-ui", color: T.text }}>
      {/* Header */}
      <div style={{ background: T.card, borderBottom: `1px solid ${T.border}`, padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: T.accent, letterSpacing: -1 }}>MR ROBOT</div>
          <div style={{ fontSize: 11, color: T.muted, background: "#0f172a", padding: "2px 10px", borderRadius: 99, border: `1px solid ${T.border}`, fontWeight: 700 }}>Master Admin</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setShowChangePin(true)}
            style={{ padding: "8px 16px", borderRadius: 8, background: T.border, border: "none", color: T.text, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
            🔑 Change PIN
          </button>
          <button onClick={onLogout}
            style={{ padding: "8px 16px", borderRadius: 8, background: "transparent", border: `1px solid ${T.border}`, color: T.muted, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
            Logout
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 920, margin: "0 auto", padding: "28px 20px" }}>
        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 28 }}>
          {[
            { label: "Total Apps", val: appList.length, color: T.accent },
            { label: "Active", val: appList.filter(a => a.status === "active").length, color: T.green },
            { label: "Disabled", val: appList.filter(a => a.status !== "active").length, color: T.red },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ background: T.card, borderRadius: 12, padding: "18px 22px", border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 32, fontWeight: 900, color }}>{val}</div>
              <div style={{ fontSize: 12, color: T.muted, marginTop: 3, fontWeight: 600 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Apps list header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Sub-Admin Apps</div>
          <button onClick={() => setShowCreate(true)}
            style={{ padding: "9px 20px", borderRadius: 9, background: T.accent, border: "none", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            + New App
          </button>
        </div>

        {/* Search bar */}
        <div style={{ marginBottom: 12, position: "relative" }}>
          <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: T.muted, pointerEvents: "none" }}>🔍</span>
          <input
            type="text"
            placeholder="Search by App ID or name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px 10px 36px", borderRadius: 9, background: T.card, border: `1px solid ${T.border}`, color: T.text, fontSize: 13, outline: "none", fontFamily: "monospace" }}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>✕</button>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: T.muted }}>Loading…</div>
        ) : filteredApps.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: T.muted, background: T.card, borderRadius: 12, border: `1px solid ${T.border}` }}>
            {search ? `"${search}" se koi app nahi mila.` : 'No apps yet. Click "+ New App" to create one.'}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filteredApps.map(app => (
              <div key={app.appId} style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: "16px 20px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 16, fontWeight: 800 }}>{app.name}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: statusColor(app.status), background: statusColor(app.status) + "22", padding: "2px 9px", borderRadius: 99 }}>
                        {app.status === "active" ? "Active" : "Disabled"}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: T.muted, fontFamily: "monospace", marginBottom: 3 }}>
                      ID: <span style={{ color: T.text }}>{app.appId}</span>
                    </div>
                    <div style={{ fontSize: 12, color: T.muted, fontFamily: "monospace", marginBottom: 3 }}>
                      PIN: <span style={{ color: T.text, letterSpacing: 2 }}>{app.pin}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 5, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 12, color: T.muted }}>
                        Max logins: <span style={{ color: T.accent, fontWeight: 700 }}>{app.loginLimit}</span>
                      </div>
                      <div style={{ fontSize: 12, color: T.muted }}>
                        Active now:{" "}
                        <span style={{ color: (app.activeSessions ?? 0) >= app.loginLimit ? T.red : T.green, fontWeight: 700 }}>
                          {app.activeSessions ?? 0}/{app.loginLimit}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>
                      Created: {new Date(app.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingTop: 4 }}>
                    <button onClick={() => copyUrl(app)}
                      style={{ padding: "7px 13px", borderRadius: 8, background: copyMsg[app.appId] ? T.green + "33" : T.border, border: "none", color: copyMsg[app.appId] ? T.green : T.text, fontWeight: 600, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                      {copyMsg[app.appId] || "📋 URL"}
                    </button>
                    <button onClick={() => setEditApp(app)}
                      style={{ padding: "7px 13px", borderRadius: 8, background: T.accent + "22", border: "none", color: T.accent, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                      ✏️ Edit
                    </button>
                    <button onClick={() => void logoutAll(app)} disabled={logoutAllId === app.appId}
                      style={{ padding: "7px 13px", borderRadius: 8, background: "#f97316" + "22", border: "none", color: "#f97316", fontWeight: 700, fontSize: 12, cursor: logoutAllId === app.appId ? "wait" : "pointer", whiteSpace: "nowrap", opacity: logoutAllId === app.appId ? 0.6 : 1 }}>
                      {logoutAllId === app.appId ? "…" : "🔓 Logout All"}
                    </button>
                    <button onClick={() => toggleStatus(app)} disabled={togglingId === app.appId}
                      style={{ padding: "7px 13px", borderRadius: 8, background: app.status === "active" ? T.yellow + "22" : T.green + "22", border: "none", color: app.status === "active" ? T.yellow : T.green, fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                      {togglingId === app.appId ? "…" : app.status === "active" ? "Disable" : "Enable"}
                    </button>
                    <button onClick={() => deleteApp(app)} disabled={deletingId === app.appId}
                      style={{ padding: "7px 13px", borderRadius: 8, background: T.red + "22", border: "none", color: T.red, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                      {deletingId === app.appId ? "…" : "🗑️"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateAppModal masterPin={masterPin} onClose={() => setShowCreate(false)}
          onCreated={a => { setAppList(prev => [...prev, a]); setShowCreate(false); }} />
      )}
      {showChangePin && (
        <ChangePinModal masterPin={masterPin} onClose={() => setShowChangePin(false)}
          onChanged={p => { onPinChanged(p); setShowChangePin(false); }} />
      )}
      {editApp && (
        <EditAppModal app={editApp} masterPin={masterPin} onClose={() => setEditApp(null)}
          onUpdated={a => { setAppList(prev => prev.map(x => x.appId === a.appId ? a : x)); setEditApp(null); }} />
      )}
    </div>
  );
}

/* ─────────── Root Export ─────────── */
export default function MainAdminPanel() {
  const [masterPin, setMasterPin] = useState<string | null>(() => {
    return sessionStorage.getItem("mrrobot_master_auth") ?? null;
  });

  function handleAuth(pin: string) {
    sessionStorage.setItem("mrrobot_master_auth", pin);
    setMasterPin(pin);
  }

  function handleLogout() {
    sessionStorage.removeItem("mrrobot_master_auth");
    setMasterPin(null);
  }

  function handlePinChanged(newPin: string) {
    sessionStorage.setItem("mrrobot_master_auth", newPin);
    setMasterPin(newPin);
    alert("Master PIN changed successfully!");
  }

  if (!masterPin) return <MasterLogin onAuth={handleAuth} />;
  return <Dashboard masterPin={masterPin} onLogout={handleLogout} onPinChanged={handlePinChanged} />;
}
