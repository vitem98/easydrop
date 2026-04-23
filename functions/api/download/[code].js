import { err, contentDisposition } from "../../_shared.js";

export async function onRequestGet(context) {
  const { env, params, waitUntil } = context;
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

  // Get file data as stream for memory efficiency
  const fileData = await env.STORE.get(`file:${code}`, { type: "arrayBuffer" });
  if (!fileData) {
    return err("File not found", 404);
  }

  // If one-time download, delete both keys after sending
  if (meta.oneTime) {
    waitUntil(
      Promise.all([
        env.STORE.delete(`meta:${code}`).catch(() => {}),
        env.STORE.delete(`file:${code}`).catch(() => {}),
      ])
    );
  }

  const headers = new Headers();
  headers.set("Content-Type", meta.contentType || "application/octet-stream");
  headers.set("Content-Disposition", contentDisposition(meta.filename));
  headers.set("Content-Length", String(meta.size));
  headers.set("Cache-Control", "no-store");

  return new Response(fileData, { headers });
}
