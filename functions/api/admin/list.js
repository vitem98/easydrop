import { json, err } from "../../_shared.js";

function checkAuth(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!env.ADMIN_PASSWORD || token !== env.ADMIN_PASSWORD) {
    return err("Unauthorized", 401);
  }
  return null;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const denied = checkAuth(request, env);
  if (denied) return denied;

  // List all meta: keys from KV
  const files = [];
  let cursor = undefined;
  let totalSize = 0;

  do {
    const listResult = await env.STORE.list({ prefix: "meta:", cursor, limit: 100 });
    for (const key of listResult.keys) {
      const code = key.name.replace("meta:", "");
      const raw = await env.STORE.get(key.name);
      if (raw) {
        try {
          const meta = JSON.parse(raw);
          files.push({
            code,
            filename: meta.filename,
            size: meta.size,
            contentType: meta.contentType,
            expiresAt: meta.expiresAt,
            oneTime: meta.oneTime,
            createdAt: meta.createdAt,
          });
          totalSize += meta.size || 0;
        } catch (e) {
          // skip corrupted entries
        }
      }
    }
    cursor = listResult.list_complete ? undefined : listResult.cursor;
  } while (cursor);

  return json({
    count: files.length,
    totalSize,
    files: files.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
  });
}
