const i18n = {
  en: {
    send: "Send",
    receive: "Receive",
    dropHint: "Drag & drop a file here, or click to select",
    maxSize: "Max 25 MB",
    ttlLabel: "Keep for",
    ttl1h: "1 hour",
    ttl1d: "1 day",
    ttl7d: "7 days",
    oneTimeLabel: "Delete after first download",
    generateCode: "Get Code",
    yourCode: "Your verification code",
    sendAnother: "Send another",
    enterCode: "Enter the 6-digit code",
    checkFile: "Check file",
    download: "Download",
    oneTimeWarn: "This file will be deleted after downloading. Please confirm before proceeding.",
    copied: "Copied!",
    uploadFailed: "Upload failed",
    fileNotFound: "Code not found or expired",
    serverError: "Server error",
    selectFileFirst: "Please select a file first",
    fillCode: "Please enter the full 6-digit code",
    preview: "Preview",
    previewNotSupported: "Preview not supported for this file type",
    loading: "Loading...",
  },
  zh: {
    send: "发送",
    receive: "接收",
    dropHint: "拖拽文件到此处，或点击选择",
    maxSize: "最大 25 MB",
    ttlLabel: "保留时间",
    ttl1h: "1 小时",
    ttl1d: "1 天",
    ttl7d: "7 天",
    oneTimeLabel: "下载一次后自动删除",
    generateCode: "生成验证码",
    yourCode: "你的验证码",
    sendAnother: "再传一个",
    enterCode: "输入 6 位验证码",
    checkFile: "查询文件",
    download: "下载",
    oneTimeWarn: "该文件设置了下载一次后自动删除，请确认后再下载。",
    copied: "已复制！",
    uploadFailed: "上传失败",
    fileNotFound: "验证码不存在或已过期",
    serverError: "服务器错误",
    selectFileFirst: "请先选择文件",
    fillCode: "请输入完整的 6 位验证码",
    preview: "预览",
    previewNotSupported: "该文件类型不支持预览",
    loading: "加载中...",
  },
};

let currentLang = "zh";
let currentFile = null;

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function t(key) {
  return i18n[currentLang]?.[key] || i18n.en[key] || key;
}

function applyLang() {
  document.documentElement.lang = currentLang === "zh" ? "zh-CN" : "en";
  $$('[data-t]').forEach(el => {
    const key = el.getAttribute('data-t');
    if (el.tagName === 'OPTION') el.textContent = t(key);
    else el.textContent = t(key);
  });
  $$('[data-t-placeholder]').forEach(el => {
    const key = el.getAttribute('data-t-placeholder');
    el.placeholder = t(key);
  });
}

function toggleLang() {
  currentLang = currentLang === 'zh' ? 'en' : 'zh';
  localStorage.setItem('ld-lang', currentLang);
  applyLang();
}

function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.classList.toggle('dark');
  localStorage.setItem('ld-theme', isDark ? 'dark' : 'light');
  updateThemeIcon();
}

function updateThemeIcon() {
  const isDark = document.documentElement.classList.contains('dark');
  $('#icon-moon').classList.toggle('hidden', !isDark);
  $('#icon-sun').classList.toggle('hidden', isDark);
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('opacity-0');
  setTimeout(() => el.classList.add('opacity-0'), 2000);
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function switchTab(name) {
  $$('.tab-btn').forEach(btn => {
    const active = btn.dataset.tab === name;
    btn.classList.toggle('bg-white', active);
    btn.classList.toggle('dark:bg-gray-700', active);
    btn.classList.toggle('shadow-sm', active);
    btn.classList.toggle('text-gray-500', !active);
    btn.classList.toggle('dark:text-gray-400', !active);
    btn.classList.toggle('text-gray-900', active);
    btn.classList.toggle('dark:text-gray-100', active);
  });
  $('#panel-send').classList.toggle('hidden', name !== 'send');
  $('#panel-receive').classList.toggle('hidden', name !== 'receive');
  if (name === 'receive') {
    // Focus first input
    setTimeout(() => $$('.code-input')[0]?.focus(), 50);
  }
}

function showFileInfo(file) {
  currentFile = file;
  $('#fileName').textContent = file.name;
  $('#fileSize').textContent = formatSize(file.size);
  $('#fileInfo').classList.remove('hidden');
  $('#dropzone').classList.add('hidden');
  $('#btnUpload').disabled = false;
}

function clearFile() {
  currentFile = null;
  $('#fileInfo').classList.add('hidden');
  $('#dropzone').classList.remove('hidden');
  $('#btnUpload').disabled = true;
  $('#fileInput').value = '';
}

function resetUploadUI() {
  clearFile();
  $('#uploadResult').classList.add('hidden');
  $('#uploadProgress').classList.add('hidden');
  $('#progressBar').style.width = '0%';
  $('#progressText').textContent = '0%';
  $('#btnUpload').disabled = true;
  $('#ttl').value = '86400';
  $('#oneTime').checked = false;
}

function generateQR(url) {
  const canvas = $('#qrCanvas');
  QRCode.toCanvas(canvas, url, {
    width: 180,
    margin: 2,
    color: {
      dark: document.documentElement.classList.contains('dark') ? '#e5e7eb' : '#1f2937',
      light: document.documentElement.classList.contains('dark') ? '#111827' : '#ffffff',
    },
  }, (e) => {
    if (e) console.error(e);
  });
}

function doUpload() {
  if (!currentFile) {
    toast(t('selectFileFirst'));
    return;
  }
  $('#btnUpload').disabled = true;
  $('#uploadProgress').classList.remove('hidden');

  const fd = new FormData();
  fd.append('file', currentFile);
  fd.append('ttl', $('#ttl').value);
  fd.append('oneTime', $('#oneTime').checked ? '1' : '0');

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');

  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      $('#progressBar').style.width = pct + '%';
      $('#progressText').textContent = pct + '%';
    }
  });

  xhr.addEventListener('load', () => {
    $('#uploadProgress').classList.add('hidden');
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const data = JSON.parse(xhr.responseText);
        $('#resultCode').textContent = data.code;
        $('#resultMeta').textContent = `${data.filename} · ${formatSize(data.size)} · ${new Date(data.expiresAt * 1000).toLocaleString()}`;
        $('#uploadResult').classList.remove('hidden');
        const url = `${window.location.origin}/?code=${encodeURIComponent(data.code)}`;
        generateQR(url);
      } catch {
        toast(t('serverError'));
      }
    } else {
      let msg = t('uploadFailed');
      try {
        const d = JSON.parse(xhr.responseText);
        if (d.error) msg = d.error;
      } catch {}
      toast(msg);
      $('#btnUpload').disabled = false;
    }
  });

  xhr.addEventListener('error', () => {
    $('#uploadProgress').classList.add('hidden');
    toast(t('uploadFailed'));
    $('#btnUpload').disabled = false;
  });

  xhr.send(fd);
}

function getCodeFromInputs() {
  return Array.from($$('.code-input')).map(i => i.value).join('');
}

function fillCodeInputs(code) {
  const digits = code.replace(/\D/g, '').slice(0, 6).split('');
  const inputs = $$('.code-input');
  inputs.forEach((input, i) => {
    input.value = digits[i] || '';
  });
  if (digits.length === 6) {
    inputs[5].focus();
  } else if (digits.length < 6) {
    inputs[digits.length].focus();
  }
}

async function fetchFileInfo() {
  const code = getCodeFromInputs();
  if (!/^\d{6}$/.test(code)) {
    toast(t('fillCode'));
    return;
  }
  $('#btnFetch').disabled = true;
  try {
    const res = await fetch(`/api/info/${code}`);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast(d.error || t('fileNotFound'));
      $('#receiveInfo').classList.add('hidden');
      return;
    }
    const data = await res.json();
    $('#recvFilename').textContent = data.filename;
    const expiry = new Date(data.expiresAt * 1000).toLocaleString();
    $('#recvMeta').textContent = `${formatSize(data.size)} · ${expiry}${data.oneTime ? ' · ' + (currentLang === 'zh' ? '一次性' : 'One-time') : ''}`;
    $('#recvWarn').classList.toggle('hidden', !data.oneTime);
    $('#btnDownload').href = `/api/download/${code}`;
    $('#btnDownload').download = data.filename;
    $('#receiveInfo').classList.remove('hidden');
    // Show preview button for supported types
    const previewable = isPreviewable(data.filename, data.contentType);
    $('#btnPreview').classList.toggle('hidden', !previewable);
    if (previewable) {
      $('#btnPreview').dataset.code = code;
      $('#btnPreview').dataset.filename = data.filename;
      $('#btnPreview').dataset.contentType = data.contentType || guessContentType(data.filename);
    }
  } catch {
    toast(t('serverError'));
  } finally {
    $('#btnFetch').disabled = false;
  }
}

// Init
(function init() {
  // Theme
  const savedTheme = localStorage.getItem('ld-theme');
  if (savedTheme) {
    document.documentElement.classList.toggle('dark', savedTheme === 'dark');
  } else {
    document.documentElement.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  updateThemeIcon();

  // Lang
  const savedLang = localStorage.getItem('ld-lang');
  const navLang = navigator.language.startsWith('zh') ? 'zh' : 'en';
  currentLang = savedLang || navLang;
  applyLang();

  // Tabs
  const hash = new URLSearchParams(window.location.search);
  const codeFromUrl = hash.get('code');
  if (codeFromUrl) {
    switchTab('receive');
    setTimeout(() => fillCodeInputs(codeFromUrl), 0);
  } else {
    switchTab('send');
  }

  // Bindings
  $('#btn-theme').addEventListener('click', toggleTheme);
  $('#btn-lang').addEventListener('click', toggleLang);
  $$('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  $('#dropzone').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) showFileInfo(f);
  });
  $('#removeFile').addEventListener('click', clearFile);
  $('#btnUpload').addEventListener('click', doUpload);
  $('#btnNewUpload').addEventListener('click', resetUploadUI);

  $('#btnCopy').addEventListener('click', async () => {
    const code = $('#resultCode').textContent;
    try {
      await navigator.clipboard.writeText(code);
      toast(t('copied'));
    } catch {
      toast('Copy failed');
    }
  });

  // Drag & drop
  const dz = $('#dropzone');
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });
  dz.addEventListener('dragenter', () => dz.classList.add('border-brand-500', 'bg-brand-50', 'dark:bg-brand-900/20'));
  dz.addEventListener('dragleave', () => dz.classList.remove('border-brand-500', 'bg-brand-50', 'dark:bg-brand-900/20'));
  dz.addEventListener('drop', (e) => {
    dz.classList.remove('border-brand-500', 'bg-brand-50', 'dark:bg-brand-900/20');
    const f = e.dataTransfer.files[0];
    if (f) showFileInfo(f);
  });

  // Code inputs
  const inputs = $$('.code-input');
  inputs.forEach((input, idx) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && idx > 0) {
        inputs[idx - 1].focus();
      }
    });
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 1);
      if (input.value && idx < 5) {
        inputs[idx + 1].focus();
      }
      if (getCodeFromInputs().length === 6) {
        fetchFileInfo();
      }
    });
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
      fillCodeInputs(text);
      if (text.length === 6) fetchFileInfo();
    });
  });

  $('#btnFetch').addEventListener('click', fetchFileInfo);

  // Preview
  $('#btnPreview').addEventListener('click', () => {
    const btn = $('#btnPreview');
    openPreview(btn.dataset.code, btn.dataset.filename, btn.dataset.contentType);
  });
  $('#previewClose').addEventListener('click', closePreview);
  $('#previewBackdrop').addEventListener('click', closePreview);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePreview();
  });
})();

// --- Preview ---

const PREVIEW_IMAGE = ['image/jpeg','image/png','image/gif','image/webp','image/svg+xml','image/bmp'];
const PREVIEW_VIDEO = ['video/mp4','video/webm'];
const PREVIEW_AUDIO = ['audio/mpeg','audio/wav','audio/ogg','audio/webm','audio/mp4'];
const PREVIEW_PDF = ['application/pdf'];
const PREVIEW_TEXT_TYPES = ['application/json','application/xml','application/javascript','text/xml'];
const PREVIEW_TEXT_EXT = ['txt','md','json','xml','csv','js','ts','css','html','htm','yaml','yml','toml','ini','cfg','conf','log','sh','bat','py','rb','java','c','cpp','h','go','rs','sql'];

function guessContentType(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  const map = {
    jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',bmp:'image/bmp',
    mp4:'video/mp4',webm:'video/webm',
    mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',
    pdf:'application/pdf',
    json:'application/json',xml:'application/xml',js:'application/javascript',
    txt:'text/plain',md:'text/plain',csv:'text/csv',html:'text/html',css:'text/css',
  };
  return map[ext] || '';
}

function isPreviewable(filename, contentType) {
  const ct = contentType || guessContentType(filename);
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (PREVIEW_IMAGE.includes(ct)) return true;
  if (PREVIEW_VIDEO.includes(ct)) return true;
  if (PREVIEW_AUDIO.includes(ct)) return true;
  if (PREVIEW_PDF.includes(ct)) return true;
  if (ct.startsWith('text/')) return true;
  if (PREVIEW_TEXT_TYPES.includes(ct)) return true;
  if (PREVIEW_TEXT_EXT.includes(ext)) return true;
  return false;
}

function getPreviewType(filename, contentType) {
  const ct = contentType || guessContentType(filename);
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (PREVIEW_IMAGE.includes(ct)) return 'image';
  if (PREVIEW_VIDEO.includes(ct)) return 'video';
  if (PREVIEW_AUDIO.includes(ct)) return 'audio';
  if (PREVIEW_PDF.includes(ct)) return 'pdf';
  if (ct.startsWith('text/') || PREVIEW_TEXT_TYPES.includes(ct) || PREVIEW_TEXT_EXT.includes(ext)) return 'text';
  return null;
}

async function openPreview(code, filename, contentType) {
  const modal = $('#previewModal');
  const content = $('#previewContent');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  $('#previewTitle').textContent = filename;
  content.innerHTML = `<p class="text-gray-400 dark:text-gray-500 text-sm">${t('loading')}</p>`;

  const downloadUrl = `/api/download/${code}`;
  $('#previewDownloadBtn').href = downloadUrl;
  $('#previewDownloadBtn').download = filename;

  const type = getPreviewType(filename, contentType);

  try {
    if (type === 'image') {
      const img = document.createElement('img');
      img.src = downloadUrl;
      img.className = 'max-w-full max-h-full rounded-lg shadow-lg object-contain';
      img.onload = () => { content.innerHTML = ''; content.appendChild(img); };
      img.onerror = () => { content.innerHTML = `<p class="text-red-400 text-sm">${t('previewNotSupported')}</p>`; };
    } else if (type === 'video') {
      content.innerHTML = `<video controls autoplay class="max-w-full max-h-full rounded-lg shadow-lg"><source src="${downloadUrl}" type="${contentType}"></video>`;
    } else if (type === 'audio') {
      content.innerHTML = `<div class="bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-lg text-center space-y-4">
        <svg class="w-16 h-16 mx-auto text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path></svg>
        <p class="text-sm font-medium">${filename}</p>
        <audio controls autoplay class="w-full"><source src="${downloadUrl}" type="${contentType}"></audio>
      </div>`;
    } else if (type === 'pdf') {
      content.innerHTML = `<iframe src="${downloadUrl}" class="w-full h-full rounded-lg border-0" style="min-height:80vh"></iframe>`;
    } else if (type === 'text') {
      const res = await fetch(downloadUrl);
      if (!res.ok) throw new Error('fetch failed');
      const text = await res.text();
      const pre = document.createElement('pre');
      pre.className = 'w-full max-h-full overflow-auto bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-xs font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words';
      pre.textContent = text.slice(0, 500000);
      content.innerHTML = '';
      content.appendChild(pre);
    } else {
      content.innerHTML = `<p class="text-gray-400 dark:text-gray-500 text-sm">${t('previewNotSupported')}</p>`;
    }
  } catch (e) {
    content.innerHTML = `<p class="text-red-400 text-sm">${t('serverError')}</p>`;
  }
}

function closePreview() {
  $('#previewModal').classList.add('hidden');
  $('#previewContent').innerHTML = '';
  document.body.style.overflow = '';
}
