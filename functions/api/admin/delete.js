import { json, err } from "../../_shared.js";

function checkAuth(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!env.ADMIN_PASSWORD || token !== env.ADMIN_PASSWORD) {
    return err("Unauthorized", 401);
  }
  return null;
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

  const meta = await env.STORE.get(`meta:${code}`);
  if (!meta) {
    return err("Code not found", 404);
  }

  await Promise.all([
    env.STORE.delete(`meta:${code}`).catch(() => {}),
    env.STORE.delete(`file:${code}`).catch(() => {}),
  ]);

  return json({ ok: true, deleted: code });
}
