import {
  nowSec,
  json,
  err,
  readPending,
  partCount,
  discardPending,
  rememberR2Objects,
  logEvent,
} from "../../_shared.js";

// Step 3: join the R2 parts, check the sizes, and publish the code.
export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return err("请求格式无效");
  }

  const code = String(body.code || "");
  const pending = await readPending(env, code, body.token);
  if (!pending) return err("上传会话不存在或已过期", 404);

  const partsByFile = Array.isArray(body.parts) ? body.parts : [];
  const expiresAt = nowSec() + pending.ttlSec;
  const r2Entries = [];

  try {
    for (const file of pending.files) {
      if (file.storage !== "r2") continue;
      const parts = (Array.isArray(partsByFile[file.index]) ? partsByFile[file.index] : [])
        .map((part) => ({ partNumber: Number(part.partNumber), etag: String(part.etag || "") }))
        .sort((a, b) => a.partNumber - b.partNumber);
      if (parts.length !== partCount(file.size)) throw new Error("parts");

      const key = `file:${code}:${file.index}`;
      const object = await env.BUCKET.resumeMultipartUpload(key, file.uploadId).complete(parts);
      delete file.uploadId; // finished, nothing left to abort
      if (object.size !== file.size) throw new Error("size");
      r2Entries.push({ key, expiresAt });
    }
    await rememberR2Objects(env, r2Entries);
  } catch {
    await discardPending(env, code, pending);
    return err("文件不完整，请重新上传", 400);
  }

  const fileMetas = pending.files.map((file) => ({
    index: file.index,
    filename: file.filename,
    contentType: file.contentType,
    size: file.size,
    storage: file.storage,
  }));
  const meta = {
    kind: "file",
    filename: fileMetas.length === 1 ? fileMetas[0].filename : `${fileMetas.length} files`,
    contentType: fileMetas.length === 1 ? fileMetas[0].contentType : "application/octet-stream",
    size: pending.totalSize,
    fileCount: fileMetas.length,
    files: fileMetas,
    expiresAt,
    oneTime: pending.oneTime,
    createdAt: nowSec(),
    uploader: pending.uploader,
  };

  try {
    await env.STORE.put(`meta:${code}`, JSON.stringify(meta), { expirationTtl: pending.ttlSec });
  } catch {
    await discardPending(env, code, pending);
    return err("验证码登记失败", 500);
  }
  await env.STORE.delete(`pending:${code}`).catch(() => {});

  await logEvent(env, request, {
    action: "upload",
    kind: "file",
    code,
    name: meta.filename,
    size: meta.size,
    count: fileMetas.length,
  });

  return json({
    code,
    expiresAt,
    oneTime: meta.oneTime,
    kind: "file",
    filename: meta.filename,
    size: meta.size,
    fileCount: fileMetas.length,
    files: fileMetas,
  });
}
