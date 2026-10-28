// Microsoft → Xbox Live → XSTS → Minecraft (device-code flow, public client, ไม่ต้องมี secret)
const SCOPE = "XboxLive.signin offline_access";
const MS = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const form = (o) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o) });
const json = (o) => ({ method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(o) });
async function call(url, opt) {
  const r = await fetch(url, opt);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t }; }
  return { ok: r.ok, status: r.status, d };
}

async function startDeviceCode(clientId) {
  const r = await call(`${MS}/devicecode`, form({ client_id: clientId, scope: SCOPE }));
  if (!r.ok) throw new Error("เริ่ม login ไม่ได้: " + (r.d.error_description || r.status));
  return r.d; // user_code, device_code, verification_uri, expires_in, interval
}

async function pollDeviceCode(clientId, dc) {
  const end = Date.now() + dc.expires_in * 1000;
  let iv = (dc.interval || 5) * 1000;
  while (Date.now() < end) {
    await sleep(iv);
    const { d } = await call(`${MS}/token`, form({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: clientId, device_code: dc.device_code }));
    if (d.access_token) return d;
    if (d.error === "authorization_pending") continue;
    if (d.error === "slow_down") { iv += 5000; continue; }
    throw new Error(d.error_description || d.error || "login ล้มเหลว");
  }
  throw new Error("หมดเวลา login");
}

async function refresh(clientId, refreshToken) {
  const { d } = await call(`${MS}/token`, form({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken, scope: SCOPE }));
  if (!d.access_token) throw new Error(d.error_description || "refresh ล้มเหลว");
  return d;
}

const XERR = {
  2148916233: "บัญชี Microsoft นี้ยังไม่มีโปรไฟล์ Xbox (เข้า minecraft.net สร้างก่อน)",
  2148916235: "Xbox Live ใช้งานไม่ได้ในประเทศของบัญชีนี้",
  2148916238: "บัญชีเด็ก ต้องให้ผู้ปกครองเพิ่มเข้า Family ก่อน",
};

async function minecraftFromMs(msAccess) {
  const xbl = await call("https://user.auth.xboxlive.com/user/authenticate", json({
    Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: "d=" + msAccess },
    RelyingParty: "http://auth.xboxlive.com", TokenType: "JWT" }));
  if (!xbl.ok) throw new Error("Xbox Live login ล้มเหลว (" + xbl.status + ")");
  const xsts = await call("https://xsts.auth.xboxlive.com/xsts/authorize", json({
    Properties: { SandboxId: "RETAIL", UserTokens: [xbl.d.Token] },
    RelyingParty: "rp://api.minecraftservices.com/", TokenType: "JWT" }));
  if (!xsts.ok) throw new Error(XERR[xsts.d.XErr] || "XSTS ล้มเหลว (" + (xsts.d.XErr || xsts.status) + ")");
  const uhs = xsts.d.DisplayClaims.xui[0].uhs;
  const mc = await call("https://api.minecraftservices.com/authentication/login_with_xbox", json({ identityToken: `XBL3.0 x=${uhs};${xsts.d.Token}` }));
  if (!mc.ok) throw new Error(mc.status === 403
    ? "Client ID ยังไม่ได้รับอนุมัติจาก Mojang (Invalid app registration) — ดู README หัวข้อ Microsoft login"
    : "Minecraft login ล้มเหลว (" + mc.status + ")");
  const pf = await call("https://api.minecraftservices.com/minecraft/profile", { headers: { Authorization: "Bearer " + mc.d.access_token } });
  if (!pf.ok) throw new Error("บัญชีนี้ไม่มี Minecraft Java Edition");
  return { mcToken: mc.d.access_token, expiresAt: Date.now() + mc.d.expires_in * 1000 - 60000, uuid: pf.d.id, name: pf.d.name };
}

module.exports = { startDeviceCode, pollDeviceCode, refresh, minecraftFromMs };
