const { app, BrowserWindow, Menu, ipcMain, shell, safeStorage } = require("electron");
const path = require("path"), fs = require("fs"), os = require("os");
const { spawn } = require("child_process");
const cfg = require("./config.json");
const auth = require("./lib/auth");
const mc = require("./lib/mc");

let win, session = null, instances = [], launcherInfo = null;
const dataDir = () => app.getPath("userData");
const root = () => path.join(dataDir(), "minecraft");
const send = (ch, d) => { if (win && !win.isDestroyed()) win.webContents.send(ch, d); };
const emit = (label, done, total) => send("progress", { label, done, total });
const okStr = (s) => typeof s === "string" && /^[\w.+\-]{1,64}$/.test(s);
const pub = (s) => ({ name: s.name, uuid: s.uuid });

// ---- เก็บ refresh token แบบเข้ารหัส (Windows DPAPI) ----
const tokFile = () => path.join(dataDir(), "auth.bin");
function saveRT(rt) {
  try { if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(tokFile(), safeStorage.encryptString(rt)); } catch {}
}
function loadRT() {
  try { return safeStorage.decryptString(fs.readFileSync(tokFile())); } catch { return null; }
}
async function ensureSession() {
  if (session && session.expiresAt > Date.now()) return session;
  const rt = loadRT();
  if (!rt) throw new Error("ยังไม่ได้เข้าสู่ระบบ");
  const t = await auth.refresh(cfg.msClientId, rt);
  saveRT(t.refresh_token || rt);
  return (session = await auth.minecraftFromMs(t.access_token));
}

// ---- auth ----
ipcMain.handle("auth:restore", async () => { try { return pub(await ensureSession()); } catch { return null; } });
ipcMain.handle("auth:login", async () => {
  const dc = await auth.startDeviceCode(cfg.msClientId);
  send("auth-code", { code: dc.user_code, url: dc.verification_uri });
  shell.openExternal(dc.verification_uri);
  const t = await auth.pollDeviceCode(cfg.msClientId, dc);
  saveRT(t.refresh_token);
  return pub((session = await auth.minecraftFromMs(t.access_token)));
});
ipcMain.handle("auth:logout", async () => { session = null; instances = []; try { fs.rmSync(tokFile(), { force: true }); } catch {} });

// ---- เลือกเวอร์ชัน / เล่นเอง ----
ipcMain.handle("mc:supported", (_e, loader) => mc.supportedMc(loader));
ipcMain.handle("mc:loaderVersions", (_e, loader, v) => mc.loaderVersions(loader, v));
ipcMain.handle("play", async (_e, o) => {
  if (!["vanilla", "fabric", "forge"].includes(o.loader) || !okStr(o.mc) || (o.loaderVersion && !okStr(o.loaderVersion))) throw new Error("ข้อมูลไม่ถูกต้อง");
  const s = await ensureSession();
  await mc.run({ root: root(), gameDir: path.join(root(), "game"), spec: { mc: o.mc, loader: o.loader, loaderVersion: o.loaderVersion }, ramMb: o.ramMb, auth: s, clientId: cfg.msClientId, emit });
  send("launched");
});

// ---- Instance: ดึงจากเว็บเท่านั้น (ต้องอยู่ใน whitelist) ----
ipcMain.handle("instances:list", async () => {
  const s = await ensureSession();
  const r = await fetch(cfg.apiBase + "/api/instances", { method: "POST", headers: { Authorization: "Bearer " + s.mcToken } });
  if (!r.ok) throw new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (" + r.status + ")");
  const d = await r.json();
  instances = d.instances || [];
  if (d.launcher) checkUpdate(d.launcher);
  return { whitelisted: !!d.whitelisted, uuid: d.uuid, name: d.name, instances };
});
ipcMain.handle("instances:play", async (_e, id) => {
  const i = instances.find((x) => x.id === id);          // ใช้เฉพาะ instance ที่ server ส่งมา ไม่รับ definition จากหน้า UI
  if (!i || !okStr(i.id)) throw new Error("ไม่พบ instance");
  const s = await ensureSession();
  await mc.run({ root: root(), gameDir: path.join(root(), "instances", i.id), spec: i, pack: i.packUrl, ramMb: i.ramMb, auth: s, clientId: cfg.msClientId, emit });
  send("launched");
});

// ---- อัปเดตตัว launcher (portable exe) ----
const newer = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
function checkUpdate(info) {
  if (info && info.version && /^https:\/\//.test(info.url || "") && newer(info.version, app.getVersion())) { launcherInfo = info; send("update-available", { version: info.version, notes: info.notes || "" }); }
}
ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("update:apply", async () => {
  if (!launcherInfo) return;
  const self = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!self) return shell.openExternal(launcherInfo.url);   // ไม่ใช่ portable → เปิดลิงก์ให้โหลดเอง
  const tmp = path.join(os.tmpdir(), "nexia-launcher-new.exe");
  const r = await fetch(launcherInfo.url);
  if (!r.ok) throw new Error("โหลดอัปเดตไม่ได้ (" + r.status + ")");
  fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  const bat = path.join(os.tmpdir(), "nexia-update.bat");
  fs.writeFileSync(bat, `@echo off\r\n:r\r\nmove /y "${tmp}" "${self}" >nul 2>&1\r\nif errorlevel 1 ( timeout /t 1 /nobreak >nul & goto r )\r\nstart "" "${self}"\r\ndel "%~f0"\r\n`);
  spawn("cmd.exe", ["/c", bat], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  app.quit();
});

// ---- window ----
function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 980, height: 640, minWidth: 820, minHeight: 560, title: "Nexia Launcher", backgroundColor: "#0e1116",
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/i.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
}
app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
