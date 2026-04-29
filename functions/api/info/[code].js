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

  const files = Array.isArray(meta.files) && meta.files.length
    ? meta.files.map((file, index) => ({
        index: Number.isInteger(file.index) ? file.index : index,
        filename: file.filename,
        size: file.size,
        contentType: file.contentType,
      }))
    : [{
        index: 0,
        filename: meta.filename,
        size: meta.size,
        contentType: meta.contentType,
      }];
  const size = typeof meta.size === "number"
    ? meta.size
    : files.reduce((sum, file) => sum + (file.size || 0), 0);

  return json({
    filename: meta.filename || files[0]?.filename,
    size,
    contentType: meta.contentType || files[0]?.contentType,
    fileCount: files.length,
    files,
    oneTime: meta.oneTime,
    expiresAt: meta.expiresAt,
  });
}
