import {
  err,
  contentDisposition,
  listStoredItems,
  deleteStoredItems,
  streamAndThen,
  logEvent,
} from "../../_shared.js";

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
    return err("验证码无效", 400);
  }

  const raw = await env.STORE.get(`meta:${code}`);
  if (!raw) {
    return err("验证码不存在或已过期", 404);
  }

  let meta;
  try {
    meta = JSON.parse(raw);
  } catch {
    return err("记录已损坏", 500);
  }

  if (meta.kind === "text") {
    const text = await env.STORE.get(`text:${code}`);
    if (text == null) {
      return err("文字不存在或已过期", 404);
    }
    waitUntil(logEvent(env, request, {
      action: "download",
      kind: "text",
      code,
      name: meta.filename,
      size: meta.size,
    }));
    if (meta.oneTime) {
      waitUntil((async () => {
        await env.STORE.delete(`meta:${code}`).catch(() => {});
        await env.STORE.delete(`text:${code}`).catch(() => {});
      })());
    }
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
  const fileIndex = getFileIndex(request, files.length);
  if (fileIndex === null) {
    return err("文件序号无效", 400);
  }

  const file = files[fileIndex];
  const storageKey = hasFileList ? `file:${code}:${fileIndex}` : `file:${code}`;
  const storage = file.storage === "r2" ? "r2" : "kv";

  let body;
  if (storage === "r2") {
    if (!env.BUCKET) return err("R2 未配置", 500);
    const object = await env.BUCKET.get(storageKey);
    if (!object) return err("文件不存在", 404);
    body = object.body;
  } else {
    body = await env.STORE.get(storageKey, { type: "arrayBuffer" });
    if (!body) return err("文件不存在", 404);
  }

  waitUntil(logEvent(env, request, {
    action: "download",
    kind: "file",
    code,
    name: file.filename,
    size: file.size,
  }));

  if (meta.oneTime) {
    const current = { key: storageKey, storage };
    const others = listStoredItems(code, meta).filter((item) => item.key !== current.key || item.storage !== current.storage);
    const removeOthers = async () => {
      await env.STORE.delete(`meta:${code}`).catch(() => {});
      await deleteStoredItems(env, others);
    };
    if (storage === "r2") {
      waitUntil(removeOthers());
      body = streamAndThen(body, () => deleteStoredItems(env, [current]));
    } else {
      waitUntil((async () => {
        await removeOthers();
        await deleteStoredItems(env, [current]);
      })());
    }
  }

  const headers = new Headers();
  headers.set("Content-Type", file.contentType || "application/octet-stream");
  headers.set("Content-Disposition", contentDisposition(file.filename));
  if (typeof file.size === "number") headers.set("Content-Length", String(file.size));
  headers.set("Cache-Control", "no-store");

  return new Response(body, { headers });
}
