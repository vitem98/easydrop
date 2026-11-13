import {
  DEFAULT_MAX_UPLOAD_BYTES,
  MAX_UPLOAD_CEILING_BYTES,
  MIN_UPLOAD_LIMIT_BYTES,
  json,
  err,
  requireAdmin,
  readSettings,
  writeSettings,
} from "../../_shared.js";

const MB = 1024 * 1024;

function describe(settings) {
  return {
    maxUploadBytes: settings.maxUploadBytes,
    defaultMaxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
    minUploadBytes: MIN_UPLOAD_LIMIT_BYTES,
    ceilingUploadBytes: MAX_UPLOAD_CEILING_BYTES,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const denied = requireAdmin(request, env);
  if (denied) return denied;
  return json(describe(await readSettings(env)));
}

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

  const mb = Number(body.maxUploadMb);
  const minMb = MIN_UPLOAD_LIMIT_BYTES / MB;
  const maxMb = MAX_UPLOAD_CEILING_BYTES / MB;
  if (!Number.isFinite(mb) || mb < minMb || mb > maxMb) {
    return err(`单次上限需在 ${minMb} 到 ${maxMb} MB 之间`);
  }

  const saved = await writeSettings(env, { maxUploadBytes: Math.round(mb * MB) });
  return json(describe(saved));
}
