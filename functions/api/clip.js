import {
  MAX_TEXT_BYTES,
  TTL_OPTIONS,
  nowSec,
  json,
  err,
  generateUniqueCode,
  byteLength,
  sweepExpiredR2,
  clientInfo,
  logEvent,
} from "../_shared.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return err("无法解析文字内容");
  }

  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) {
    return err("请先粘贴文字");
  }

  const size = byteLength(text);
  if (size > MAX_TEXT_BYTES) {
    return err("文字超过 1 MB", 413);
  }

  const ttlSec = TTL_OPTIONS[String(body.ttl || "86400")];
  if (!ttlSec) {
    return err("保留时间无效，请选择 1 小时、1 天或 7 天");
  }

  const oneTime = body.oneTime === true || body.oneTime === 1 || body.oneTime === "1" || body.oneTime === "true";
  const expiresAt = nowSec() + ttlSec;

  await sweepExpiredR2(env);

  const code = await generateUniqueCode(env);
  if (!code) {
    return err("验证码生成失败，请重试", 429);
  }

  const textKey = `text:${code}`;
  try {
    await env.STORE.put(textKey, text, { expirationTtl: ttlSec });
  } catch {
    return err("存储失败", 500);
  }

  const meta = {
    kind: "text",
    filename: "文字剪贴板",
    contentType: "text/plain; charset=utf-8",
    size,
    fileCount: 1,
    files: [],
    expiresAt,
    oneTime,
    createdAt: nowSec(),
    uploader: clientInfo(request),
  };

  try {
    await env.STORE.put(`meta:${code}`, JSON.stringify(meta), { expirationTtl: ttlSec });
  } catch {
    await env.STORE.delete(textKey).catch(() => {});
    return err("验证码登记失败", 500);
  }

  await logEvent(env, request, {
    action: "clip",
    kind: "text",
    code,
    name: meta.filename,
    size,
  });

  return json({
    code,
    expiresAt,
    oneTime,
    kind: "text",
    filename: meta.filename,
    size,
  });
}
