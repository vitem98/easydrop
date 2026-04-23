import { json, err } from "../../_shared.js";

export async function onRequestGet(context) {
  const { env, params } = context;
  const code = params.code;

  if (!/^\d{6}$/.test(code)) {
    return err("Invalid code", 400);
  }

  const raw = await env.STORE.get(`meta:${code}`);
  if (!raw) {
    return err("Code not found or expired", 404);
  }

  let meta;
  try {
    meta = JSON.parse(raw);
  } catch (e) {
    return err("Corrupted metadata", 500);
  }

  return json({
    filename: meta.filename,
    size: meta.size,
    contentType: meta.contentType,
    oneTime: meta.oneTime,
    expiresAt: meta.expiresAt,
  });
}
