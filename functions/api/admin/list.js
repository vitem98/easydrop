import {
  json,
  requireAdmin,
  storageSummary,
  isOwnedR2Key,
  nowSec,
  readEvents,
  LOG_DAYS,
} from "../../_shared.js";

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

const R2_USAGE_BUCKETS = [
  ["easydrop", "BUCKET"],
  ["ak-ar-groups", "R2_AK_AR_GROUPS"],
  ["ak-ar-submissions", "R2_AK_AR_SUBMISSIONS"],
];

async function measureR2(env) {
  let easydropUsed = 0;
  let easydropCount = 0;
  let otherUsed = 0;
  let otherCount = 0;
  let configured = false;

  for (const [name, binding] of R2_USAGE_BUCKETS) {
    const bucket = env[binding];
    if (!bucket || typeof bucket.list !== "function") continue;
    configured = true;
    const splitOwned = name === "easydrop";
    let cursor;
    do {
      const listed = await bucket.list({ cursor, limit: 1000 });
      for (const object of listed.objects || []) {
        const size = object.size || 0;
        if (splitOwned && isOwnedR2Key(object.key)) {
          easydropUsed += size;
          easydropCount += 1;
        } else {
          otherUsed += size;
          otherCount += 1;
        }
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }

  return {
    used: easydropUsed + otherUsed,
    count: easydropCount + otherCount,
    configured,
    easydrop: { used: easydropUsed, count: easydropCount },
    other: { used: otherUsed, count: otherCount },
  };
}

const RECENT_EVENT_LIMIT = 200;

function pickClient(source) {
  return {
    ip: source.ip || "",
    country: source.country || "",
    region: source.region || "",
    city: source.city || "",
    isp: source.isp || "",
    device: source.device || "",
  };
}

// Events arrive newest first. People are told apart by IP address.
function buildUsage(events, truncated) {
  const dayAgo = nowSec() - 86400;
  const users = new Map();
  const todayIps = new Set();
  const summary = {
    users: 0,
    uploads: 0,
    downloads: 0,
    uploadBytes: 0,
    downloadBytes: 0,
    today: { users: 0, uploads: 0, downloads: 0 },
  };

  for (const event of events) {
    const ip = event.ip || "";
    const isDownload = event.action === "download";
    const size = Number(event.size) || 0;
    const recent = event.t >= dayAgo;

    let user = users.get(ip);
    if (!user) {
      user = {
        ...pickClient(event),
        devices: [],
        uploads: 0,
        downloads: 0,
        uploadBytes: 0,
        downloadBytes: 0,
        lastSeen: event.t,
        firstSeen: event.t,
      };
      users.set(ip, user);
    }
    user.firstSeen = Math.min(user.firstSeen, event.t);
    if (event.device && !user.devices.includes(event.device) && user.devices.length < 5) {
      user.devices.push(event.device);
    }

    if (isDownload) {
      user.downloads += 1;
      user.downloadBytes += size;
      summary.downloads += 1;
      summary.downloadBytes += size;
      if (recent) summary.today.downloads += 1;
    } else {
      user.uploads += 1;
      user.uploadBytes += size;
      summary.uploads += 1;
      summary.uploadBytes += size;
      if (recent) summary.today.uploads += 1;
    }
    if (recent) todayIps.add(ip);
  }

  summary.users = users.size;
  summary.today.users = todayIps.size;

  return {
    days: LOG_DAYS,
    truncated,
    summary,
    users: [...users.values()].sort((a, b) => b.lastSeen - a.lastSeen),
    events: events.slice(0, RECENT_EVENT_LIMIT),
  };
}

function countDownloads(events, code, createdAt) {
  const since = Number(createdAt) || 0;
  let count = 0;
  for (const event of events) {
    if (event.action === "download" && event.code === code && event.t >= since) count += 1;
  }
  return count;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const denied = requireAdmin(request, env);
  if (denied) return denied;

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
            uploader: meta.uploader ? pickClient(meta.uploader) : null,
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

  let logged = { events: [], truncated: false };
  try {
    logged = await readEvents(env);
  } catch {
    // The usage log is optional. The file list still loads without it.
  }
  for (const file of files) {
    file.downloads = countDownloads(logged.events, file.code, file.createdAt);
  }

  return json({
    count: totalFileCount,
    transferCount: files.length,
    totalSize,
    storage: {
      kv: { used: kvUsed, limit: KV_STORAGE_LIMIT, count: kvCount },
      r2: {
        used: r2.used,
        limit: R2_STORAGE_LIMIT,
        count: r2.count,
        configured: r2.configured,
        easydrop: r2.easydrop,
        other: r2.other,
      },
    },
    usage: buildUsage(logged.events, logged.truncated),
    files: files.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
  });
}
