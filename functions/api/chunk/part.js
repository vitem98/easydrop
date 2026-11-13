import {
  CHUNK_BYTES,
  PENDING_TTL,
  json,
  err,
  readPending,
  partCount,
} from "../../_shared.js";

// Step 2: one request per piece. A KV file is sent whole (it is at most 25 MB).
// An R2 file is sent as numbered parts of CHUNK_BYTES, the last one shorter.
export async function onRequestPut(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const pending = await readPending(env, code, url.searchParams.get("token"));
  if (!pending) return err("上传会话不存在或已过期", 404);

  const file = pending.files[Number(url.searchParams.get("file"))];
  if (!file) return err("文件序号无效");

  const key = `file:${code}:${file.index}`;
  const length = Number(request.headers.get("content-length"));

  if (file.storage !== "r2") {
    if (length !== file.size) return err("文件大小与登记的不一致");
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength !== file.size) return err("文件大小与登记的不一致");
    try {
      // Kept a day longer than the transfer so a slow upload cannot make the
      // data expire before its code does.
      await env.STORE.put(key, buffer, { expirationTtl: pending.ttlSec + PENDING_TTL });
    } catch {
      return err("存储失败", 500);
    }
    return json({ ok: true });
  }

  if (!env.BUCKET) return err("R2 未配置", 500);
  const total = partCount(file.size);
  const part = Number(url.searchParams.get("part"));
  if (!Number.isInteger(part) || part < 1 || part > total) return err("分片序号无效");

  const expected = part < total ? CHUNK_BYTES : file.size - CHUNK_BYTES * (total - 1);
  if (length !== expected || !request.body) return err("分片大小不正确");

  try {
    const upload = env.BUCKET.resumeMultipartUpload(key, file.uploadId);
    const uploaded = await upload.uploadPart(part, request.body);
    return json({ partNumber: part, etag: uploaded.etag });
  } catch {
    return err("分片存储失败", 500);
  }
}
