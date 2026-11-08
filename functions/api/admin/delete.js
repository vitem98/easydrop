import { json, err, requireAdmin, purgeTransfer } from "../../_shared.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  const denied = requireAdmin(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return err("请求格式无效");
  }

  const code = body.code;
  if (!code || !/^\d{6}$/.test(code)) {
    return err("验证码无效");
  }

  const raw = await env.STORE.get(`meta:${code}`);
  if (!raw) {
    return err("验证码不存在", 404);
  }

  let meta;
  try {
    meta = JSON.parse(raw);
  } catch {
    meta = {};
  }

  await purgeTransfer(env, code, meta);
  return json({ ok: true, deleted: code });
}
