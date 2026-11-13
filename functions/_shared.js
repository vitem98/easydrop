export const KV_MAX_BYTES = 25 * 1024 * 1024; // KV value size limit
export const REQUEST_MAX_BYTES = 100 * 1024 * 1024; // Pages Functions request body limit
// Uploads that fit in one request body go to /api/upload. Anything larger, or
// any file bound for R2, is sent in pieces through /api/chunk/*.
export const SINGLE_REQUEST_MAX_BYTES = 95 * 1024 * 1024;
export const CHUNK_BYTES = 16 * 1024 * 1024; // R2 multipart part size (min 5 MiB)
export const DEFAULT_MAX_UPLOAD_BYTES = 400 * 1024 * 1024;
export const MAX_UPLOAD_CEILING_BYTES = 5 * 1024 * 1024 * 1024;
export const MIN_UPLOAD_LIMIT_BYTES = 1024 * 1024;
export const PENDING_TTL = 86400;
export const MAX_TEXT_BYTES = 1024 * 1024;
export const MAX_FILE_COUNT = 10;
export const TTL_OPTIONS = { "3600": 3600, "86400": 86400, "604800": 604800 };
export const CODE_RETRIES = 10;
const R2_INDEX_KEY = "r2:index";
const OWNED_R2_KEY = /^file:\d{6}:\d+$/;

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function randomCode() {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
}

export function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\.+/g, ".")
    .trim()
    .slice(0, 200) || "unnamed";
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function err(message, status = 400) {
  return json({ error: message }, status);
}

export function requireAdmin(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!env.ADMIN_PASSWORD || token !== env.ADMIN_PASSWORD) {
    return err("管理员密码错误", 401);
  }
  return null;
}

export async function generateUniqueCode(env) {
  for (let i = 0; i < CODE_RETRIES; i++) {
    const code = randomCode();
    const existing = await env.STORE.get(`meta:${code}`);
    if (existing) continue;
    const pending = await env.STORE.get(`pending:${code}`);
    if (!pending) return code;
  }
  return null;
}

export function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

export function listStoredItems(code, meta) {
  if (meta.kind === "text") {
    return [{ key: `text:${code}`, storage: "kv" }];
  }

  const items = [];
  if (Array.isArray(meta.files) && meta.files.length) {
    meta.files.forEach((file, index) => {
      const fileIndex = Number.isInteger(file.index) ? file.index : index;
      items.push({
        key: `file:${code}:${fileIndex}`,
        storage: file.storage === "r2" ? "r2" : "kv",
      });
    });
  } else {
    items.push({
      key: `file:${code}`,
      storage: meta.storage === "r2" ? "r2" : "kv",
    });
  }

  if (!items.some((item) => item.key === `file:${code}` && item.storage === "kv")) {
    items.push({ key: `file:${code}`, storage: "kv" });
  }
  return items;
}

async function readR2Index(env) {
  const raw = await env.STORE.get(R2_INDEX_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeR2Index(env, list) {
  await env.STORE.put(R2_INDEX_KEY, JSON.stringify(list));
}

export async function rememberR2Objects(env, entries) {
  if (!entries.length) return;
  const list = await readR2Index(env);
  const keys = new Set(entries.map((entry) => entry.key));
  await writeR2Index(env, list.filter((item) => !keys.has(item.key)).concat(entries));
}

export async function forgetR2Keys(env, keys) {
  if (!keys.length) return;
  const drop = new Set(keys);
  const list = await readR2Index(env);
  await writeR2Index(env, list.filter((item) => !drop.has(item.key)));
}

export function isOwnedR2Key(key) {
  return OWNED_R2_KEY.test(key || "");
}

export async function sweepExpiredR2(env) {
  if (!env.BUCKET) return;
  const now = nowSec();
  const list = await readR2Index(env);
  const expired = list.filter((item) => item && isOwnedR2Key(item.key) && item.expiresAt <= now);
  if (expired.length) {
    await Promise.all(expired.map((item) => env.BUCKET.delete(item.key).catch(() => {})));
  }
  const drop = new Set(expired.map((item) => item.key));
  const kept = list.filter((item) => item && isOwnedR2Key(item.key) && !drop.has(item.key));
  if (kept.length !== list.length) await writeR2Index(env, kept);
}

export async function deleteStoredItems(env, items) {
  const r2Keys = [];
  await Promise.all(items.map(async (item) => {
    if (item.storage === "r2") {
      if (!isOwnedR2Key(item.key)) return;
      r2Keys.push(item.key);
      if (env.BUCKET) await env.BUCKET.delete(item.key).catch(() => {});
    } else {
      await env.STORE.delete(item.key).catch(() => {});
    }
  }));
  await forgetR2Keys(env, r2Keys);
}

export async function purgeTransfer(env, code, meta) {
  await Promise.all([
    env.STORE.delete(`meta:${code}`).catch(() => {}),
    deleteStoredItems(env, listStoredItems(code, meta)),
  ]);
}

export function storageSummary(meta) {
  if (meta.kind === "text") return "kv";
  const files = Array.isArray(meta.files) ? meta.files : [];
  if (!files.length) return meta.storage === "r2" ? "r2" : "kv";
  const hasR2 = files.some((file) => file.storage === "r2");
  const hasKv = files.some((file) => file.storage !== "r2");
  if (hasR2 && hasKv) return "kv+r2";
  return hasR2 ? "r2" : "kv";
}

export function streamAndThen(body, task) {
  const reader = body.getReader();
  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    try {
      await task();
    } catch {
      // Cleanup is best-effort after the bytes have been sent.
    }
  };

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          await finish();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        await finish();
      }
    },
    async cancel() {
      try {
        await reader.cancel();
      } catch {
        // Ignore a client disconnect while closing the source.
      }
      await finish();
    },
  });
}

// --- Usage log ---
// One KV key per event. The details live in the key's metadata, so the admin
// page reads a whole page of events with a single list() call.
const LOG_PREFIX = "log:";
export const LOG_DAYS = 30;
const LOG_TTL = LOG_DAYS * 86400;
const LOG_KEY_BASE = 1e13;

function clip(value, max) {
  return String(value == null ? "" : value).slice(0, max);
}

export function describeDevice(ua) {
  if (!ua) return "";
  let os = "";
  if (/iPhone|iPod/.test(ua)) os = "iPhone";
  else if (/iPad/.test(ua)) os = "iPad";
  else if (/HarmonyOS|OpenHarmony/.test(ua)) os = "HarmonyOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/Linux/.test(ua)) os = "Linux";

  let browser = "";
  if (/MicroMessenger/.test(ua)) browser = "微信";
  else if (/DingTalk/.test(ua)) browser = "钉钉";
  else if (/QQBrowser|MQQBrowser/.test(ua)) browser = "QQ浏览器";
  else if (/Edg(e|A|iOS)?\//.test(ua)) browser = "Edge";
  else if (/Firefox|FxiOS/.test(ua)) browser = "Firefox";
  else if (/Chrome|CriOS/.test(ua)) browser = "Chrome";
  else if (/Safari/.test(ua)) browser = "Safari";
  else if (/curl|Wget|python|Go-http|okhttp/i.test(ua)) browser = clip(ua.split(/[\/\s]/)[0], 20);

  return [os, browser].filter(Boolean).join(" · ") || clip(ua, 40);
}

export function clientInfo(request) {
  const cf = request.cf || {};
  return {
    ip: clip(request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "", 45),
    country: clip(cf.country, 8),
    region: clip(cf.region, 40),
    city: clip(cf.city, 40),
    isp: clip(cf.asOrganization, 40),
    device: describeDevice(request.headers.get("User-Agent") || ""),
  };
}

// action: "upload" | "clip" | "download". Never throws: a failed log write
// must not break a transfer.
export async function logEvent(env, request, event) {
  try {
    const now = Date.now();
    // Reversed timestamp so list() returns the newest events first.
    const stamp = String(LOG_KEY_BASE - now).padStart(13, "0");
    const key = `${LOG_PREFIX}${stamp}:${Math.random().toString(36).slice(2, 8)}`;
    const metadata = {
      t: Math.floor(now / 1000),
      ...clientInfo(request),
      action: event.action,
      kind: event.kind === "text" ? "text" : "file",
      code: clip(event.code, 6),
      name: clip(event.name, 60),
      size: Number(event.size) || 0,
      count: Number(event.count) || 1,
    };
    await env.STORE.put(key, "1", { expirationTtl: LOG_TTL, metadata });
  } catch {
    // Best-effort.
  }
}

export async function readEvents(env, maxPages = 3) {
  const events = [];
  let cursor;
  let truncated = false;
  for (let page = 0; page < maxPages; page++) {
    const listed = await env.STORE.list({ prefix: LOG_PREFIX, cursor, limit: 1000 });
    for (const key of listed.keys) {
      if (key.metadata && key.metadata.t) events.push(key.metadata);
    }
    if (listed.list_complete) {
      cursor = undefined;
      break;
    }
    cursor = listed.cursor;
  }
  if (cursor) truncated = true;
  return { events, truncated };
}

// --- Settings (editable on the admin page) ---
const SETTINGS_KEY = "settings";

function clampUploadLimit(value) {
  const bytes = Math.floor(Number(value));
  if (!Number.isFinite(bytes) || bytes <= 0) return DEFAULT_MAX_UPLOAD_BYTES;
  return Math.min(MAX_UPLOAD_CEILING_BYTES, Math.max(MIN_UPLOAD_LIMIT_BYTES, bytes));
}

export async function readSettings(env) {
  let saved = {};
  try {
    const raw = await env.STORE.get(SETTINGS_KEY);
    if (raw) saved = JSON.parse(raw) || {};
  } catch {
    saved = {};
  }
  return { maxUploadBytes: clampUploadLimit(saved.maxUploadBytes) };
}

export async function writeSettings(env, settings) {
  const next = { maxUploadBytes: clampUploadLimit(settings.maxUploadBytes) };
  await env.STORE.put(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

// The limit for one upload (each file and the total). Without R2, files can
// only live in KV, so the KV value limit applies.
export async function uploadLimit(env) {
  if (!env.BUCKET) return KV_MAX_BYTES;
  return (await readSettings(env)).maxUploadBytes;
}

export function formatMb(bytes) {
  const mb = bytes / 1024 / 1024;
  return Number.isInteger(mb) ? String(mb) : mb.toFixed(1);
}

// --- Chunked upload sessions ---
export async function readPending(env, code, token) {
  if (!/^\d{6}$/.test(code || "") || !token) return null;
  const raw = await env.STORE.get(`pending:${code}`);
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw);
    return pending && pending.token === token ? pending : null;
  } catch {
    return null;
  }
}

export function partCount(size) {
  return Math.max(1, Math.ceil(size / CHUNK_BYTES));
}

export async function discardPending(env, code, pending) {
  await Promise.all(pending.files.map(async (file) => {
    const key = `file:${code}:${file.index}`;
    try {
      if (file.storage === "r2") {
        if (env.BUCKET && file.uploadId) {
          await env.BUCKET.resumeMultipartUpload(key, file.uploadId).abort();
        }
        if (env.BUCKET) await env.BUCKET.delete(key);
      } else {
        await env.STORE.delete(key);
      }
    } catch {
      // Best-effort. R2 drops unfinished multipart uploads on its own.
    }
  }));
  await env.STORE.delete(`pending:${code}`).catch(() => {});
}
