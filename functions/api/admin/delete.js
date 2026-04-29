import { json, err } from "../../_shared.js";

function checkAuth(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!env.ADMIN_PASSWORD || token !== env.ADMIN_PASSWORD) {
    return err("Unauthorized", 401);
  }
  return null;
}

function getFileKeys(code, meta) {
  const keys = new Set([`file:${code}`]);
  if (Array.isArray(meta.files) && meta.files.length) {
    meta.files.forEach((file, index) => {
      const fileIndex = Number.isInteger(file.index) ? file.index : index;
      keys.add(`file:${code}:${fileIndex}`);
    });
  }
  return [...keys];
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const denied = checkAuth(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return err("Invalid JSON body");
  }

  const code = body.code;
  if (!code || !/^\d{6}$/.test(code)) {
    return err("Invalid code");
  }

  const raw = await env.STORE.get(`meta:${code}`);
  if (!raw) {
    return err("Code not found", 404);
  }

  let meta;
  try {
    meta = JSON.parse(raw);
  } catch (e) {
    meta = {};
  }

  const fileKeys = getFileKeys(code, meta);

  await Promise.all([
    env.STORE.delete(`meta:${code}`).catch(() => {}),
    ...fileKeys.map((key) => env.STORE.delete(key).catch(() => {})),
  ]);

  return json({ ok: true, deleted: code });
}
