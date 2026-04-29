import { json, err } from "../../_shared.js";

function checkAuth(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!env.ADMIN_PASSWORD || token !== env.ADMIN_PASSWORD) {
    return err("Unauthorized", 401);
  }
  return null;
}

function normalizeFiles(meta) {
  if (Array.isArray(meta.files) && meta.files.length) {
    return meta.files.map((file, index) => ({
      index: Number.isInteger(file.index) ? file.index : index,
      filename: file.filename,
      size: file.size,
      contentType: file.contentType,
    }));
  }

  return [{
    index: 0,
    filename: meta.filename,
    size: meta.size,
    contentType: meta.contentType,
  }];
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const denied = checkAuth(request, env);
  if (denied) return denied;

  // List all meta: keys from KV
  const files = [];
  let cursor = undefined;
  let totalSize = 0;
  let totalFileCount = 0;

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
          });
          totalSize += size || 0;
          totalFileCount += fileMetas.length;
        } catch (e) {
          // skip corrupted entries
        }
      }
    }
    cursor = listResult.list_complete ? undefined : listResult.cursor;
  } while (cursor);

  return json({
    count: totalFileCount,
    transferCount: files.length,
    totalSize,
    files: files.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
  });
}
