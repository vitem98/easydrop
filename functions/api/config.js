import {
  KV_MAX_BYTES,
  CHUNK_BYTES,
  SINGLE_REQUEST_MAX_BYTES,
  MAX_FILE_COUNT,
  json,
  uploadLimit,
} from "../_shared.js";

// Public. Tells the page how large an upload may be.
export async function onRequestGet(context) {
  const { env } = context;
  return json({
    maxUploadBytes: await uploadLimit(env),
    kvMaxBytes: KV_MAX_BYTES,
    chunkBytes: CHUNK_BYTES,
    singleRequestMaxBytes: SINGLE_REQUEST_MAX_BYTES,
    maxFileCount: MAX_FILE_COUNT,
  });
}
