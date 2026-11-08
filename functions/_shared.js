export const KV_MAX_BYTES = 25 * 1024 * 1024; // KV value size limit
export const REQUEST_MAX_BYTES = 100 * 1024 * 1024; // Pages Functions request body limit
export const MAX_TEXT_BYTES = 1024 * 1024;
export const MAX_FILE_COUNT = 10;
export const TTL_OPTIONS = { "3600": 3600, "86400": 86400, "604800": 604800 };
export const CODE_RETRIES = 10;
const R2_INDEX_KEY = "r2:index";

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
    if (!existing) return code;
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

export async function sweepExpiredR2(env) {
  if (!env.BUCKET) return;
  const now = nowSec();
  const list = await readR2Index(env);
  const expired = list.filter((item) => !item || item.expiresAt <= now);
  if (!expired.length) return;
  await Promise.all(expired.map((item) => env.BUCKET.delete(item.key).catch(() => {})));
  const drop = new Set(expired.map((item) => item.key));
  await writeR2Index(env, list.filter((item) => item && !drop.has(item.key)));
}

export async function deleteStoredItems(env, items) {
  const r2Keys = [];
  await Promise.all(items.map(async (item) => {
    if (item.storage === "r2") {
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
