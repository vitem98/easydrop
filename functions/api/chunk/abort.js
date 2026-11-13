import { json, readPending, discardPending } from "../../_shared.js";

// Called by the page when a chunked upload fails, to free what was stored.
export async function onRequestPost(context) {
  const { request, env } = context;
  let body = {};
  try {
    body = await request.json();
  } catch {
    // Treated as an unknown session below.
  }
  const code = String(body.code || "");
  const pending = await readPending(env, code, body.token);
  if (pending) await discardPending(env, code, pending);
  return json({ ok: true });
}
