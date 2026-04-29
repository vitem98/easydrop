import {
  MAX_FILE_SIZE,
  MAX_FILE_COUNT,
  MAX_TOTAL_UPLOAD_SIZE,
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

  const files = [...form.getAll("files"), ...form.getAll("file")]
    .filter((item) => item && typeof item === "object" && item.name);
  if (!files.length) {
    return err('Missing field "files"');
  }

  const maxSize = parseInt(env.MAX_FILE_SIZE, 10) || MAX_FILE_SIZE;
  const maxFileCount = parseInt(env.MAX_FILE_COUNT, 10) || MAX_FILE_COUNT;
  const maxTotalSize = parseInt(env.MAX_TOTAL_UPLOAD_SIZE, 10) || MAX_TOTAL_UPLOAD_SIZE;

  if (files.length > maxFileCount) {
    return err(`Too many files. Max ${maxFileCount} files`, 413);
  }

  for (const file of files) {
    if (file.size > maxSize) {
      return err(`${file.name} exceeds ${Math.round(maxSize / 1024 / 1024)} MB limit`, 413);
    }
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > maxTotalSize) {
    return err(`Total upload exceeds ${Math.round(maxTotalSize / 1024 / 1024)} MB limit`, 413);
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

  const fileMetas = files.map((file, index) => ({
    index,
    filename: sanitizeFilename(file.name),
    contentType: file.type || "application/octet-stream",
    size: file.size,
  }));

  // Store file bytes in KV
  const storedKeys = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const fileData = await files[i].arrayBuffer();
      const key = `file:${code}:${i}`;
      await env.STORE.put(key, fileData, { expirationTtl: ttlSec });
      storedKeys.push(key);
    }
  } catch (e) {
    await Promise.all(storedKeys.map((key) => env.STORE.delete(key).catch(() => {})));
    return err("Storage error", 500);
  }

  // Store metadata in KV
  const meta = {
    filename: files.length === 1 ? fileMetas[0].filename : `${files.length} files`,
    contentType: files.length === 1 ? fileMetas[0].contentType : "application/octet-stream",
    size: totalSize,
    fileCount: files.length,
    files: fileMetas,
    expiresAt,
    oneTime,
    createdAt: nowSec(),
  };

  try {
    await env.STORE.put(`meta:${code}`, JSON.stringify(meta), { expirationTtl: ttlSec });
  } catch (e) {
    // Rollback: delete orphan file data
    await Promise.all(storedKeys.map((key) => env.STORE.delete(key).catch(() => {})));
    return err("Failed to register code", 500);
  }

  return json({
    code,
    expiresAt,
    oneTime,
    filename: meta.filename,
    size: totalSize,
    fileCount: files.length,
    files: fileMetas,
  });
}
