import { json, requireAdmin, storageSummary, sweepExpiredR2 } from "../../_shared.js";

const KV_STORAGE_LIMIT = 1024 * 1024 * 1024;
const R2_STORAGE_LIMIT = 10 * 1024 * 1024 * 1024;

function normalizeFiles(meta) {
  if (Array.isArray(meta.files) && meta.files.length) {
    return meta.files.map((file, index) => ({
      index: Number.isInteger(file.index) ? file.index : index,
      filename: file.filename,
      size: file.size,
      contentType: file.contentType,
      storage: file.storage === "r2" ? "r2" : "kv",
    }));
  }

  return [{
    index: 0,
    filename: meta.filename,
    size: meta.size,
    contentType: meta.contentType,
    storage: meta.storage === "r2" ? "r2" : "kv",
  }];
}

function payloadUsage(meta) {
  if (meta.kind === "text") {
    return { kv: Number(meta.size) || 0, r2: 0, kvCount: 1, r2Count: 0 };
  }

  const files = Array.isArray(meta.files) && meta.files.length
    ? meta.files
    : [{ size: meta.size || 0, storage: meta.storage === "r2" ? "r2" : "kv" }];
  return files.reduce((usage, file) => {
    const size = Number(file.size) || 0;
    if (file.storage === "r2") {
      usage.r2 += size;
      usage.r2Count += 1;
    } else {
      usage.kv += size;
      usage.kvCount += 1;
    }
    return usage;
  }, { kv: 0, r2: 0, kvCount: 0, r2Count: 0 });
}

async function measureR2(env) {
  if (!env.BUCKET) return { used: 0, count: 0, configured: false };
  let used = 0;
  let count = 0;
  let cursor;
  do {
    const listed = await env.BUCKET.list({ cursor, limit: 1000 });
    for (const object of listed.objects || []) {
      used += object.size || 0;
      count += 1;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return { used, count, configured: true };
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const denied = requireAdmin(request, env);
  if (denied) return denied;

  await sweepExpiredR2(env);

  // List all meta: keys from KV
  const files = [];
  let cursor = undefined;
  let totalSize = 0;
  let totalFileCount = 0;
  let kvUsed = 0;
  let kvCount = 0;

  do {
    const listResult = await env.STORE.list({ prefix: "meta:", cursor, limit: 100 });
    for (const key of listResult.keys) {
      const code = key.name.replace("meta:", "");
      const raw = await env.STORE.get(key.name);
      if (raw) {
        try {
          const meta = JSON.parse(raw);
          const fileMetas = normalizeFiles(meta);
          const size = typeof meta.size === "number"
            ? meta.size
            : fileMetas.reduce((sum, file) => sum + (file.size || 0), 0);
          files.push({
            code,
            filename: meta.filename || fileMetas[0]?.filename,
            size,
            contentType: meta.contentType || fileMetas[0]?.contentType,
            fileCount: fileMetas.length,
            files: fileMetas,
            expiresAt: meta.expiresAt,
            oneTime: meta.oneTime,
            createdAt: meta.createdAt,
            kind: meta.kind === "text" ? "text" : "file",
            storage: storageSummary(meta),
          });
          totalSize += size || 0;
          totalFileCount += meta.kind === "text" ? 1 : fileMetas.length;
          const usage = payloadUsage(meta);
          kvUsed += usage.kv;
          kvCount += usage.kvCount;
        } catch (e) {
          // skip corrupted entries
        }
      }
    }
    cursor = listResult.list_complete ? undefined : listResult.cursor;
  } while (cursor);

  const r2 = await measureR2(env);

  return json({
    count: totalFileCount,
    transferCount: files.length,
    totalSize,
    storage: {
      kv: { used: kvUsed, limit: KV_STORAGE_LIMIT, count: kvCount },
      r2: { used: r2.used, limit: R2_STORAGE_LIMIT, count: r2.count, configured: r2.configured },
    },
    files: files.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
  });
}
