import { err, requireAdmin, contentDisposition, isOwnedR2Key } from "../../_shared.js";

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

export async function onRequestGet(context) {
  const { request, env } = context;
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  if (!/^\d{6}$/.test(code)) return err("验证码无效", 400);

  const raw = await env.STORE.get(`meta:${code}`);
  if (!raw) return err("验证码不存在或已过期", 404);

  let meta;
  try {
    meta = JSON.parse(raw);
  } catch {
    return err("记录已损坏", 500);
  }

  if (meta.kind === "text") {
    const text = await env.STORE.get(`text:${code}`);
    if (text == null) return err("文字不存在或已过期", 404);
    return new Response(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": "inline",
        "Cache-Control": "no-store",
      },
    });
  }

  const hasFileList = Array.isArray(meta.files) && meta.files.length > 0;
  const files = normalizeFiles(meta);
  const requested = url.searchParams.get("file");
  const fileIndex = requested === null || requested === "" ? 0 : Number(requested);
  if (!Number.isInteger(fileIndex) || fileIndex < 0 || fileIndex >= files.length) {
    return err("文件序号无效", 400);
  }

  const file = files[fileIndex];
  const storageKey = hasFileList ? `file:${code}:${fileIndex}` : `file:${code}`;
  const storage = file.storage === "r2" ? "r2" : "kv";
  let body;

  if (storage === "r2") {
    if (!isOwnedR2Key(storageKey) || !env.BUCKET) return err("文件不存在", 404);
    const object = await env.BUCKET.get(storageKey);
    if (!object) return err("文件不存在", 404);
    body = object.body;
  } else {
    body = await env.STORE.get(storageKey, { type: "arrayBuffer" });
    if (!body) return err("文件不存在", 404);
  }

  const headers = new Headers();
  headers.set("Content-Type", file.contentType || "application/octet-stream");
  headers.set("Content-Disposition", contentDisposition(file.filename || "file"));
  if (typeof file.size === "number") headers.set("Content-Length", String(file.size));
  headers.set("Cache-Control", "no-store");
  return new Response(body, { headers });
}
