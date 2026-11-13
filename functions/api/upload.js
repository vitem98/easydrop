import {
  KV_MAX_BYTES,
  REQUEST_MAX_BYTES,
  MAX_FILE_COUNT,
  TTL_OPTIONS,
  nowSec,
  sanitizeFilename,
  json,
  err,
  generateUniqueCode,
  deleteStoredItems,
  rememberR2Objects,
  sweepExpiredR2,
  clientInfo,
  logEvent,
} from "../_shared.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return err("请使用文件上传");
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return err("无法解析上传内容");
  }

  const files = [...form.getAll("files"), ...form.getAll("file")]
    .filter((item) => item && typeof item === "object" && typeof item.arrayBuffer === "function" && item.name);
  if (!files.length) {
    return err("请选择文件");
  }

  const hardMax = env.BUCKET ? REQUEST_MAX_BYTES : KV_MAX_BYTES;
  if (files.length > MAX_FILE_COUNT) {
    return err(`文件过多，最多 ${MAX_FILE_COUNT} 个`, 413);
  }

  for (const file of files) {
    if (file.size > hardMax) {
      const limitMb = Math.round(hardMax / 1024 / 1024);
      return err(`${file.name} 超过 ${limitMb} MB 限制`, 413);
    }
    if (file.size > KV_MAX_BYTES && !env.BUCKET) {
      return err(`${file.name} 超过 25 MB，需要先配置 R2`, 413);
    }
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > REQUEST_MAX_BYTES) {
    return err("单次上传不能超过 100 MB", 413);
  }

  const ttlStr = form.get("ttl") || "86400";
  const ttlSec = TTL_OPTIONS[ttlStr];
  if (!ttlSec) {
    return err("保留时间无效，请选择 1 小时、1 天或 7 天");
  }

  const oneTime = form.get("oneTime") === "1" || form.get("oneTime") === "true";
  const expiresAt = nowSec() + ttlSec;

  await sweepExpiredR2(env);

  const code = await generateUniqueCode(env);
  if (!code) {
    return err("验证码生成失败，请重试", 429);
  }

  const fileMetas = [];
  const stored = [];
  const r2Entries = [];

  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const storage = file.size > KV_MAX_BYTES ? "r2" : "kv";
      const meta = {
        index: i,
        filename: sanitizeFilename(file.name),
        contentType: file.type || "application/octet-stream",
        size: file.size,
        storage,
      };
      const key = `file:${code}:${i}`;

      if (storage === "r2") {
        await env.BUCKET.put(key, file, {
          httpMetadata: { contentType: meta.contentType },
        });
        r2Entries.push({ key, expiresAt });
      } else {
        await env.STORE.put(key, await file.arrayBuffer(), { expirationTtl: ttlSec });
      }

      stored.push({ key, storage });
      fileMetas.push(meta);
    }

    await rememberR2Objects(env, r2Entries);
  } catch {
    await deleteStoredItems(env, stored);
    return err("存储失败", 500);
  }

  const meta = {
    kind: "file",
    filename: files.length === 1 ? fileMetas[0].filename : `${files.length} files`,
    contentType: files.length === 1 ? fileMetas[0].contentType : "application/octet-stream",
    size: totalSize,
    fileCount: files.length,
    files: fileMetas,
    expiresAt,
    oneTime,
    createdAt: nowSec(),
    uploader: clientInfo(request),
  };

  try {
    await env.STORE.put(`meta:${code}`, JSON.stringify(meta), { expirationTtl: ttlSec });
  } catch {
    await deleteStoredItems(env, stored);
    return err("验证码登记失败", 500);
  }

  await logEvent(env, request, {
    action: "upload",
    kind: "file",
    code,
    name: meta.filename,
    size: totalSize,
    count: files.length,
  });

  return json({
    code,
    expiresAt,
    oneTime,
    kind: "file",
    filename: meta.filename,
    size: totalSize,
    fileCount: files.length,
    files: fileMetas,
  });
}
