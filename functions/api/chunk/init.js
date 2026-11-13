import {
  KV_MAX_BYTES,
  CHUNK_BYTES,
  MAX_FILE_COUNT,
  TTL_OPTIONS,
  PENDING_TTL,
  nowSec,
  sanitizeFilename,
  json,
  err,
  generateUniqueCode,
  sweepExpiredR2,
  clientInfo,
  uploadLimit,
  formatMb,
  discardPending,
} from "../../_shared.js";

// Step 1 of a chunked upload: reserve a code and open the R2 multipart uploads.
export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return err("请求格式无效");
  }

  const list = Array.isArray(body.files) ? body.files : [];
  if (!list.length) return err("请选择文件");
  if (list.length > MAX_FILE_COUNT) {
    return err(`文件过多，最多 ${MAX_FILE_COUNT} 个`, 413);
  }

  const limit = await uploadLimit(env);
  let totalSize = 0;
  const files = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i] || {};
    const size = Number(item.size);
    if (typeof item.name !== "string" || !item.name || !Number.isInteger(size) || size < 0) {
      return err("文件信息无效");
    }
    if (size > KV_MAX_BYTES && !env.BUCKET) {
      return err(`${item.name} 超过 25 MB，需要先配置 R2`, 413);
    }
    if (size > limit) {
      return err(`${item.name} 超过 ${formatMb(limit)} MB 限制`, 413);
    }
    totalSize += size;
    files.push({
      index: i,
      filename: sanitizeFilename(item.name),
      contentType: (typeof item.type === "string" && item.type.slice(0, 120)) || "application/octet-stream",
      size,
      storage: size > KV_MAX_BYTES ? "r2" : "kv",
    });
  }
  if (totalSize > limit) {
    return err(`单次上传不能超过 ${formatMb(limit)} MB`, 413);
  }

  const ttlSec = TTL_OPTIONS[String(body.ttl || "86400")];
  if (!ttlSec) {
    return err("保留时间无效，请选择 1 小时、1 天或 7 天");
  }
  const oneTime = body.oneTime === true || body.oneTime === 1 || body.oneTime === "1" || body.oneTime === "true";

  await sweepExpiredR2(env);

  const code = await generateUniqueCode(env);
  if (!code) {
    return err("验证码生成失败，请重试", 429);
  }

  const pending = {
    token: crypto.randomUUID(),
    files,
    totalSize,
    ttlSec,
    oneTime,
    createdAt: nowSec(),
    uploader: clientInfo(request),
  };

  try {
    for (const file of files) {
      if (file.storage !== "r2") continue;
      const upload = await env.BUCKET.createMultipartUpload(`file:${code}:${file.index}`, {
        httpMetadata: { contentType: file.contentType },
      });
      file.uploadId = upload.uploadId;
    }
    await env.STORE.put(`pending:${code}`, JSON.stringify(pending), { expirationTtl: PENDING_TTL });
  } catch {
    await discardPending(env, code, pending);
    return err("存储失败", 500);
  }

  return json({
    code,
    token: pending.token,
    chunkBytes: CHUNK_BYTES,
    files: files.map((file) => ({ index: file.index, storage: file.storage, size: file.size })),
  });
}
