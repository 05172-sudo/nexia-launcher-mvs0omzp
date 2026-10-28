// ติดตั้ง/เปิดเกม: vanilla + Fabric + Forge, Java runtime ของ Mojang, sync modpack (Windows x64)
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const { spawn } = require("child_process");
const AdmZip = require("adm-zip");

const MANIFEST = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const JAVA_ALL = "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";
const FABRIC = "https://meta.fabricmc.net/v2/versions";
const FORGE_META = "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";

const sha1 = (b) => crypto.createHash("sha1").update(b).digest("hex");
const getJson = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u} → ${r.status}`); return r.json(); };
const getText = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u} → ${r.status}`); return r.text(); };
const mk = (p) => fs.mkdirSync(p, { recursive: true });
const minor = (v) => +(/^1\.(\d+)/.exec(v) || [0, 0])[1];

function safeJoin(base, rel) {
  const b = path.resolve(base), p = path.resolve(b, rel);
  if (path.isAbsolute(rel) || !(p === b || p.startsWith(b + path.sep))) throw new Error("unsafe path: " + rel);
  return p;
}

async function dl(url, dest, hash) {
  if (fs.existsSync(dest)) { if (!hash) return; if (sha1(fs.readFileSync(dest)) === hash) return; }
  mk(path.dirname(dest));
  let err;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url} → ${r.status}`);
      const b = Buffer.from(await r.arrayBuffer());
      if (hash && sha1(b) !== hash) throw new Error("sha1 mismatch: " + url);
      fs.writeFileSync(dest, b); return;
    } catch (e) { err = e; }
  }
  throw err;
}

async function batch(label, jobs, emit, n = 16) {
  let done = 0, i = 0;
  emit(label, 0, jobs.length);
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (i < jobs.length) { const j = jobs[i++]; await dl(j.url, j.dest, j.sha1); emit(label, ++done, jobs.length); }
  }));
}

// Mojang rules (Windows x64). rule ที่ผูกกับ "features" ของ launcher ถูกข้าม
function allowed(rules) {
  if (!Array.isArray(rules)) return true;
  let ok = false;
  for (const r of rules) {
    let m;
    if (r.features) m = false;
    else if (!r.os) m = true;
    else m = (!r.os.name || r.os.name === "windows") && (!r.os.arch || r.os.arch === "x64");
    if (m) ok = r.action === "allow";
  }
  return ok;
}

function mavenPath(name) {
  const [coord, ext] = name.split("@"); const [g, a, v, c] = coord.split(":");
  return `${g.replace(/\./g, "/")}/${a}/${v}/${a}-${v}${c ? "-" + c : ""}.${ext || "jar"}`;
}
const libKey = (name) => { const [g, a, , c] = name.split("@")[0].split(":"); return `${g}:${a}:${c || ""}`; };

// ---------- รายการเวอร์ชัน ----------
let cache = {};
async function releases() {
  if (!cache.rel) cache.rel = (await getJson(MANIFEST)).versions.filter((v) => v.type === "release").map((v) => v.id);
  return cache.rel;
}
async function forgeVersions() {
  if (!cache.forge) cache.forge = [...(await getText(FORGE_META)).matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
  return cache.forge;
}
async function supportedMc(loader) {
  const rel = await releases();
  if (loader === "vanilla") return rel;
  if (loader === "fabric") { const s = new Set((await getJson(FABRIC + "/game")).filter((g) => g.stable).map((g) => g.version)); return rel.filter((v) => s.has(v)); }
  if (loader === "forge") { const s = new Set((await forgeVersions()).map((v) => v.split("-")[0])); return rel.filter((v) => s.has(v) && minor(v) >= 13); }
  throw new Error("unknown loader");
}
async function loaderVersions(loader, mcv) {
  if (loader === "fabric") return (await getJson(`${FABRIC}/loader/${mcv}`)).map((x) => x.loader.version);
  if (loader === "forge") return (await forgeVersions()).filter((v) => v.startsWith(mcv + "-")).map((v) => v.slice(mcv.length + 1)).reverse();
  return [];
}

// ---------- Java ----------
async function ensureJava(root, comp, emit) {
  const all = await getJson(JAVA_ALL);
  const entry = all["windows-x64"]?.[comp]?.[0];
  if (!entry) throw new Error("ไม่มี Java runtime สำหรับ " + comp);
  const man = await getJson(entry.manifest.url);
  const base = path.join(root, "runtime", comp);
  const jobs = Object.entries(man.files).filter(([, f]) => f.type === "file")
    .map(([p, f]) => ({ url: f.downloads.raw.url, dest: safeJoin(base, p), sha1: f.downloads.raw.sha1 }));
  await batch("Java runtime", jobs, emit);
  return { javaw: path.join(base, "bin", "javaw.exe"), java: path.join(base, "bin", "java.exe") };
}

// ---------- เวอร์ชัน ----------
async function ensureVanilla(root, mcv) {
  const dir = path.join(root, "versions", mcv), f = path.join(dir, mcv + ".json");
  try {
    const url = (await getJson(MANIFEST)).versions.find((v) => v.id === mcv)?.url;
    if (!url) throw new Error("ไม่พบเวอร์ชัน " + mcv);
    mk(dir); fs.writeFileSync(f, JSON.stringify(await getJson(url)));
  } catch (e) { if (!fs.existsSync(f)) throw e; } // ออฟไลน์ใช้ของเดิมได้
}

function readVersion(root, id) {
  const v = JSON.parse(fs.readFileSync(path.join(root, "versions", id, id + ".json"), "utf8"));
  if (!v.inheritsFrom) { v.jarId = v.id; return v; }
  const p = readVersion(root, v.inheritsFrom);
  return {
    ...p, ...v,
    libraries: [...(v.libraries || []), ...(p.libraries || [])],
    arguments: { game: [...(p.arguments?.game || []), ...(v.arguments?.game || [])], jvm: [...(p.arguments?.jvm || []), ...(v.arguments?.jvm || [])] },
    minecraftArguments: v.minecraftArguments || p.minecraftArguments,
    assetIndex: v.assetIndex || p.assetIndex, downloads: p.downloads || v.downloads,
    javaVersion: v.javaVersion || p.javaVersion, jarId: p.jarId,
  };
}

async function ensureVersion(root, spec, emit) {
  const { mc, loader, loaderVersion: lv } = spec;
  await ensureVanilla(root, mc);
  if (loader === "vanilla") return mc;
  if (!lv) throw new Error("ต้องเลือกเวอร์ชันของ " + loader);
  if (loader === "fabric") {
    const prof = await getJson(`${FABRIC}/loader/${mc}/${lv}/profile/json`);
    const d = path.join(root, "versions", prof.id); mk(d);
    fs.writeFileSync(path.join(d, prof.id + ".json"), JSON.stringify(prof));
    return prof.id;
  }
  if (loader === "forge") {
    const id = `${mc}-forge-${lv}`;
    if (fs.existsSync(path.join(root, "versions", id, id + ".json"))) return id;
    const base = readVersion(root, mc);
    const jar = path.join(root, "versions", mc, mc + ".jar");
    await dl(base.downloads.client.url, jar, base.downloads.client.sha1);
    const { java } = await ensureJava(root, base.javaVersion?.component || "jre-legacy", emit);
    const inst = path.join(root, "tmp", `forge-${mc}-${lv}-installer.jar`);
    emit("Forge installer", 0, 1);
    await dl(`https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${lv}/forge-${mc}-${lv}-installer.jar`, inst);
    fs.writeFileSync(path.join(root, "launcher_profiles.json"), JSON.stringify({ profiles: {} }));
    emit("กำลังติดตั้ง Forge (ใช้เวลาสักครู่)", 0, 0);
    await new Promise((res, rej) => {
      let tail = "";
      const c = spawn(java, ["-jar", inst, "--installClient", root], { cwd: root, windowsHide: true });
      const keep = (b) => { tail = (tail + b).slice(-600); };
      c.stdout.on("data", keep); c.stderr.on("data", keep);
      c.on("error", rej);
      c.on("close", (code) => code === 0 ? res() : rej(new Error("Forge installer ล้มเหลว: " + tail)));
    });
    if (!fs.existsSync(path.join(root, "versions", id, id + ".json"))) throw new Error("ติดตั้ง Forge แล้วไม่พบ version " + id);
    return id;
  }
  throw new Error("unknown loader");
}

// ---------- libraries / assets / natives ----------
async function prepare(root, v, id, emit) {
  const libDir = path.join(root, "libraries");
  const jar = path.join(root, "versions", v.jarId, v.jarId + ".jar");
  const jobs = [{ url: v.downloads.client.url, dest: jar, sha1: v.downloads.client.sha1 }];
  const seen = new Set(), cp = [], natives = [];
  for (const lib of v.libraries) {
    if (!allowed(lib.rules)) continue;
    const key = libKey(lib.name); if (seen.has(key)) continue; seen.add(key);
    let art;
    if (lib.natives) {
      const cl = (lib.natives.windows || "").replace("${arch}", "64");
      art = lib.downloads?.classifiers?.[cl]; if (!art) continue;
    } else if (lib.downloads?.artifact) art = lib.downloads.artifact;
    else { const p = mavenPath(lib.name); art = { path: p, url: (lib.url || "https://libraries.minecraft.net/").replace(/\/?$/, "/") + p, sha1: lib.sha1 }; }
    const dest = safeJoin(libDir, art.path);
    if (art.url) jobs.push({ url: art.url, dest, sha1: art.sha1 });
    if (lib.natives) natives.push({ dest, exclude: lib.extract?.exclude || [] }); else cp.push(dest);
  }
  await batch("Libraries", jobs, emit);

  const natDir = path.join(root, "natives", id); mk(natDir);
  for (const n of natives) {
    const z = new AdmZip(n.dest);
    for (const e of z.getEntries()) {
      if (e.isDirectory || n.exclude.some((x) => e.entryName.startsWith(x))) continue;
      if (/\.(dll|so|dylib)$/i.test(e.entryName)) z.extractEntryTo(e, natDir, false, true);
    }
  }

  const ai = v.assetIndex, idxP = path.join(root, "assets", "indexes", ai.id + ".json");
  await dl(ai.url, idxP, ai.sha1);
  const hashes = [...new Set(Object.values(JSON.parse(fs.readFileSync(idxP, "utf8")).objects).map((o) => o.hash))];
  await batch("Assets", hashes.map((h) => ({ url: `https://resources.download.minecraft.net/${h.slice(0, 2)}/${h}`, dest: path.join(root, "assets", "objects", h.slice(0, 2), h), sha1: h })), emit, 24);
  cp.push(jar);
  return { cp, natDir };
}

// ---------- args ----------
const expand = (s, vars) => s.replace(/\$\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
function collectArgs(list, vars) {
  const out = [];
  for (const x of list || []) {
    if (typeof x === "string") out.push(expand(x, vars));
    else if (allowed(x.rules)) for (const s of [].concat(x.value)) out.push(expand(s, vars));
  }
  return out;
}

// ---------- modpack ----------
// {"version":"1.0","files":[{"path":"mods/a.jar","url":"https://...","sha1":"..."}],"delete":["mods/old.jar"]}
async function syncPack(gameDir, packUrl, emit) {
  if (!/^https:\/\//.test(packUrl)) throw new Error("pack URL ต้องเป็น https");
  const m = await getJson(packUrl);
  const jobs = (m.files || []).map((f) => {
    if (!f.sha1 || !/^https:\/\//.test(f.url)) throw new Error("pack: ทุกไฟล์ต้องมี https url และ sha1");
    return { url: f.url, dest: safeJoin(gameDir, f.path), sha1: f.sha1 };
  });
  await batch("Modpack", jobs, emit, 8);
  for (const d of m.delete || []) { try { fs.rmSync(safeJoin(gameDir, d), { force: true }); } catch {} }
}

// ---------- run ----------
async function run({ root, gameDir, spec, pack, ramMb, auth, clientId, emit }) {
  mk(gameDir);
  const id = await ensureVersion(root, spec, emit);
  const v = readVersion(root, id);
  const { cp, natDir } = await prepare(root, v, id, emit);
  const { javaw } = await ensureJava(root, v.javaVersion?.component || "jre-legacy", emit);
  if (pack) await syncPack(gameDir, pack, emit);

  const vars = {
    natives_directory: natDir, launcher_name: "NexiaLauncher", launcher_version: "1",
    classpath: cp.join(";"), classpath_separator: ";", library_directory: path.join(root, "libraries"),
    auth_player_name: auth.name, auth_uuid: auth.uuid, auth_access_token: auth.mcToken,
    auth_xuid: "0", clientid: clientId || "0", user_type: "msa",
    version_name: id, version_type: "release", game_directory: gameDir,
    assets_root: path.join(root, "assets"), assets_index_name: v.assetIndex.id, game_assets: path.join(root, "assets"),
  };
  const jvm = v.arguments.jvm.length ? collectArgs(v.arguments.jvm, vars)
    : [`-Djava.library.path=${natDir}`, "-cp", vars.classpath];
  const game = [...(v.minecraftArguments ? v.minecraftArguments.split(" ").map((s) => expand(s, vars)) : []), ...collectArgs(v.arguments.game, vars)];
  const ram = Math.min(Math.max(+ramMb || 3072, 1024), 32768);
  const args = [`-Xmx${ram}M`, ...jvm, v.mainClass, ...game];
  spawn(javaw, args, { cwd: gameDir, detached: true, stdio: "ignore" }).unref();
}

module.exports = { run, supportedMc, loaderVersions, _t: { allowed, mavenPath, libKey, expand, safeJoin, readVersion } };
