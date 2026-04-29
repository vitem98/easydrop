import { err, contentDisposition } from "../../_shared.js";

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

function getFileIndex(request, fileCount) {
  const value = new URL(request.url).searchParams.get("file");
  if (value === null || value === "") return 0;
  if (!/^\d+$/.test(value)) return null;
  const index = Number(value);
  if (index < 0 || index >= fileCount) return null;
  return index;
}

export async function onRequestGet(context) {
  const { request, env, params, waitUntil } = context;
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

  const hasFileList = Array.isArray(meta.files) && meta.files.length > 0;
  const files = normalizeFiles(meta);
  const fileIndex = getFileIndex(request, files.length);
  if (fileIndex === null) {
    return err("Invalid file index", 400);
  }

  const file = files[fileIndex];
  const storageKey = hasFileList ? `file:${code}:${fileIndex}` : `file:${code}`;

  // Get file data as stream for memory efficiency
  const fileData = await env.STORE.get(storageKey, { type: "arrayBuffer" });
  if (!fileData) {
    return err("File not found", 404);
  }

  // If one-time download, delete both keys after sending
  if (meta.oneTime) {
    const fileKeys = hasFileList
      ? [...files.map((_, index) => `file:${code}:${index}`), `file:${code}`]
      : [`file:${code}`];
    waitUntil(
      Promise.all([
        env.STORE.delete(`meta:${code}`).catch(() => {}),
        ...fileKeys.map((key) => env.STORE.delete(key).catch(() => {})),
      ])
    );
  }

  const headers = new Headers();
  headers.set("Content-Type", file.contentType || "application/octet-stream");
  headers.set("Content-Disposition", contentDisposition(file.filename));
  headers.set("Content-Length", String(file.size));
  headers.set("Cache-Control", "no-store");

  return new Response(fileData, { headers });
}
