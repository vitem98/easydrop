import {
  MAX_FILE_SIZE,
  TTL_OPTIONS,
  nowSec,
  sanitizeFilename,
  json,
  err,
  generateUniqueCode,
} from "../_shared.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return err("Expected multipart/form-data");
  }

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return err("Failed to parse form data");
  }

  const file = form.get("file");
  if (!file || typeof file !== "object" || !file.name) {
    return err('Missing field "file"');
  }

  const maxSize = parseInt(env.MAX_FILE_SIZE, 10) || MAX_FILE_SIZE;
  if (file.size > maxSize) {
    return err(`File exceeds ${Math.round(maxSize / 1024 / 1024)} MB limit`, 413);
  }

  const ttlStr = form.get("ttl") || "86400";
  const ttlSec = TTL_OPTIONS[ttlStr];
  if (!ttlSec) {
    return err("Invalid ttl. Use 3600, 86400 or 604800");
  }

  const oneTime = form.get("oneTime") === "1" || form.get("oneTime") === "true";
  const expiresAt = nowSec() + ttlSec;

  const code = await generateUniqueCode(env);
  if (!code) {
    return err("Could not generate unique code, try again", 429);
  }

  const filename = sanitizeFilename(file.name);
  const contentType = file.type || "application/octet-stream";

  // Store file bytes in KV
  try {
    const fileData = await file.arrayBuffer();
    await env.STORE.put(`file:${code}`, fileData, { expirationTtl: ttlSec });
  } catch (e) {
    return err("Storage error", 500);
  }

  // Store metadata in KV
  const meta = {
    filename,
    contentType,
    size: file.size,
    expiresAt,
    oneTime,
    createdAt: nowSec(),
  };

  try {
    await env.STORE.put(`meta:${code}`, JSON.stringify(meta), { expirationTtl: ttlSec });
  } catch (e) {
    // Rollback: delete orphan file data
    await env.STORE.delete(`file:${code}`).catch(() => {});
    return err("Failed to register code", 500);
  }

  return json({ code, expiresAt, oneTime, filename, size: file.size });
}
