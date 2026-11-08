import { json, requireAdmin } from "../_shared.js";

export async function onRequestPost(context) {
  const denied = requireAdmin(context.request, context.env);
  if (denied) return denied;
  return json({ ok: true });
}
