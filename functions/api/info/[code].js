import { json, err, storageSummary } from "../../_shared.js";

export async function onRequestGet(context) {
  const { env, params } = context;
  const code = params.code;

  if (!/^\d{6}$/.test(code)) {
    return err("验证码无效", 400);
  }

  const raw = await env.STORE.get(`meta:${code}`);
  if (!raw) {
    return err("验证码不存在或已过期", 404);
  }

  let meta;
  try {
    meta = JSON.parse(raw);
  } catch {
    return err("记录已损坏", 500);
  }

  const kind = meta.kind === "text" ? "text" : "file";
  const files = kind === "text"
    ? []
    : (Array.isArray(meta.files) && meta.files.length
      ? meta.files.map((file, index) => ({
          index: Number.isInteger(file.index) ? file.index : index,
          filename: file.filename,
          size: file.size,
          contentType: file.contentType,
          storage: file.storage === "r2" ? "r2" : "kv",
        }))
      : [{
          index: 0,
          filename: meta.filename,
          size: meta.size,
          contentType: meta.contentType,
          storage: meta.storage === "r2" ? "r2" : "kv",
        }]);
  const size = typeof meta.size === "number"
    ? meta.size
    : files.reduce((sum, file) => sum + (file.size || 0), 0);

  return json({
    kind,
    filename: meta.filename || files[0]?.filename,
    size,
    contentType: meta.contentType || files[0]?.contentType,
    fileCount: kind === "text" ? 1 : files.length,
    files,
    storage: storageSummary(meta),
    oneTime: meta.oneTime,
    expiresAt: meta.expiresAt,
  });
}
