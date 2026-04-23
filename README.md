# EasyDrop

> Upload a file, get a 6-digit code. Enter the code on another device, download the file. That's it.

**100% Free** — runs entirely on Cloudflare Pages + KV. No credit card required.

[English](#features) | [中文](#中文说明)

---

## Features

- **Send** — drag & drop or select a file (≤ 25 MB), choose retention (1h / 1d / 7d), optionally enable one-time download, get a 6-digit code + QR code
- **Receive** — enter the 6-digit code, preview file info, click download
- **Dark mode** — follows system preference, manual toggle
- **Bilingual UI** — English / 中文, auto-detected, switchable
- **Admin panel** — password-protected dashboard at `/admin.html` to monitor and manage files
- **Auto-expire** — KV TTL handles expiration automatically, no cron needed

---

## How It Works

```
┌──────────┐       POST /api/upload        ┌──────────────────┐
│  Sender  │  ───────────────────────────▶  │  Pages Function   │
│ (Browser)│  ◀─── { code: "482913" } ───  │                  │
└──────────┘                                │  ┌────────────┐  │
                                            │  │ Cloudflare │  │
┌──────────┐       GET /api/download/482913 │  │     KV     │  │
│ Receiver │  ───────────────────────────▶  │  │            │  │
│ (Browser)│  ◀─── file binary stream ───  │  │ meta:{code}│  │
└──────────┘                                │  │ file:{code}│  │
                                            │  └────────────┘  │
                                            └──────────────────┘
```

| Layer | Cloudflare Service | Purpose |
|---|---|---|
| Frontend | Pages (static hosting) | Single-page HTML + JS + CSS, zero build step |
| Backend API | Pages Functions | `/api/upload`, `/api/info/:code`, `/api/download/:code`, `/api/admin/*` |
| Storage | KV | `file:{code}` → file bytes, `meta:{code}` → JSON metadata, both with TTL auto-expiry |

### Why KV instead of R2?

R2 has a generous free tier but **requires a credit card** to activate. KV's free tier **does not require a credit card**, making it truly zero-cost for personal file transfer.

---

## Free Tier Limits

| Resource | Free Quota | Usage per Transfer |
|---|---|---|
| Pages requests | Unlimited | Static frontend |
| Functions invocations | 100K/day | 1 per upload/download |
| KV storage | 1 GB | Auto-expires, won't accumulate |
| KV reads | 100K/day | 2 per download (meta + file) |
| KV writes | 1,000/day | 2 per upload → ~500 uploads/day |
| KV max value size | 25 MB | = max file size |

---

## Deploy (5 minutes)

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- A [Cloudflare](https://dash.cloudflare.com) account (free, no credit card)

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/easydrop.git
cd easydrop

# 2. Install dependencies
npm install

# 3. Login to Cloudflare
npx wrangler login

# 4. Create a KV namespace
npx wrangler kv namespace create STORE
# Output: { binding = "STORE", id = "xxxxxxxxxxxxxxxx" }

# 5. Edit wrangler.toml — paste your KV id and set admin password
#    id = "xxxxxxxxxxxxxxxx"
#    ADMIN_PASSWORD = "your_secret_password"

# 6. Deploy
npx wrangler pages deploy public
```

Done! Your app will be live at `https://<project-name>.pages.dev`.

Admin panel: `https://<project-name>.pages.dev/admin.html`

### (Optional) Rate limiting

Cloudflare Dashboard → Pages → your project → Settings → Functions → add a rate limit rule for `/api/upload` (e.g. 10 req/min per IP).

---

## Local Development

```bash
npx wrangler pages dev public
```

Starts a local dev server with KV simulation at `http://localhost:8788`.

---

## Project Structure

```
easydrop/
├── functions/
│   ├── _shared.js              # Shared utilities (helpers, constants)
│   └── api/
│       ├── upload.js            # POST /api/upload
│       ├── info/
│       │   └── [code].js       # GET  /api/info/:code
│       ├── download/
│       │   └── [code].js       # GET  /api/download/:code
│       └── admin/
│           ├── list.js          # GET  /api/admin/list
│           └── delete.js        # POST /api/admin/delete
├── public/
│   ├── index.html               # Main SPA (send / receive tabs)
│   ├── admin.html               # Admin dashboard (password-protected)
│   └── assets/
│       ├── app.js               # Frontend logic: i18n, theme, upload, QR
│       └── styles.css           # Minor CSS overrides
├── wrangler.toml                # Cloudflare Pages config (fill in KV id + password)
├── package.json
├── .gitignore
└── README.md
```

---

## Security

- **6-digit code** — 1M combinations + short TTL + rate limiting = brute force impractical. For stronger security, change `randomCode()` in `functions/_shared.js` to generate 8-char alphanumeric codes.
- **No auth for transfers** — anyone with the code can download. This is by design for quick personal transfers.
- **Chinese filenames** — RFC 5987 `filename*=UTF-8''...` encoding, works in all modern browsers.
- **Admin panel** — protected by `ADMIN_PASSWORD` env var. Change it before deploying.

---

## FAQ

**Q: Code generation keeps failing?**
A: Too many active codes causing collisions. Built-in 10 retries. For heavy use, increase code length to 7+ digits.

**Q: Receiver says code is invalid?**
A: Either expired (KV TTL) or already downloaded (one-time mode).

**Q: Can I use a custom domain?**
A: Yes. Cloudflare Dashboard → Pages → your project → Custom domains.

**Q: Need larger files?**
A: Two upgrade paths:
  - Enable R2 (requires credit card, free 10 GB, supports 100 MB+ files)
  - Use third-party storage like Supabase Storage (free 1 GB, no credit card)

---

## 中文说明

一台电脑上传文件 → 得到 6 位验证码 → 另一台电脑输入验证码 → 下载文件。

**完全免费**，只用 Cloudflare Pages + KV，不需要绑定信用卡。

### 快速部署

```bash
git clone https://github.com/YOUR_USERNAME/easydrop.git
cd easydrop && npm install
npx wrangler login
npx wrangler kv namespace create STORE
# 把输出的 id 填到 wrangler.toml，同时设置 ADMIN_PASSWORD
npx wrangler pages deploy public
```

### 功能一览

- 拖拽上传，保留时间可选（1 小时 / 1 天 / 7 天）
- 一次性下载开关
- 6 位验证码 + QR 码
- 暗色模式、中英双语
- 密码保护的管理面板（`/admin.html`）
- 文件自动过期，无需定时清理

详细说明见上方英文部分。

---

## License

MIT
