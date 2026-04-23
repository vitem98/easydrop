export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB — KV value size limit on free plan
export const TTL_OPTIONS = { "3600": 3600, "86400": 86400, "604800": 604800 };
export const CODE_RETRIES = 10;

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
