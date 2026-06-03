const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ★★★ GAS Web App 網址 ★★★
const GAS_URL = 'https://script.google.com/macros/s/AKfycbw9LPdsBzyKtCcXcubhMxPV-yji1oA-0QE0X8L2VaqfuvwYnaMR66Jag4FELfDEt-VIfg/exec';

// 動態路徑：掃描上層資料夾
const SCAN_PATH = path.resolve(__dirname, '..');
const ARCHIVE_EXTENSIONS = ['.rar', '.7z', '.zip'];
const LOG_FILE = path.join(__dirname, 'sync_log.txt');

// 同步週期：每 5 分鐘
const SYNC_INTERVAL = 5 * 60 * 1000;

function writeLog(message) {
  const time = new Date().toLocaleString();
  const line = `[${time}] ${message}\n`;
  console.log(message);
  try {
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch (e) { }
}

// 每次啟動清空舊日誌
try { fs.writeFileSync(LOG_FILE, `=== AI Sync Log Start ===\n`, 'utf8'); } catch (e) { }

function formatDateTime(date) {
  const y = date.getFullYear();
  const M = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}/${M}/${d} ${h}:${m}:${s}`;
}

function parseToolNameAndVersion(entryName, isFile) {
  let baseName = entryName;
  if (isFile) {
    const ext = path.extname(entryName);
    baseName = entryName.slice(0, -ext.length);
  }
  const match = baseName.match(/([_\-]?)((?:v?\d)[\dv.]*)$/i);
  if (match && match[2]) {
    const toolName = baseName.substring(0, match.index).trim();
    if (toolName) {
      const ver = match[2];
      return { toolName, version: ver.toLowerCase().startsWith('v') ? ver : 'v' + ver };
    }
  }
  return { toolName: baseName.trim(), version: 'v1.0.0' };
}

function scanTools() {
  const tools = [];
  try {
    writeLog(`Scanning directory: ${SCAN_PATH}`);
    const entries = fs.readdirSync(SCAN_PATH, { withFileTypes: true });
    writeLog(`Found ${entries.length} raw entries in directory.`);

    let idx = 0;
    entries.forEach(entry => {
      const ext = path.extname(entry.name).toLowerCase();

      if (['.js', '.bat', '.vbs', '.cmd', '.ps1', '.json', '.html', '.txt', '.md'].includes(ext)) return;
      if (entry.name.startsWith('.')) return;
      if (entry.name === '系統後台') return;

      const fullPath = path.join(SCAN_PATH, entry.name);
      const isDir = entry.isDirectory();
      const isArchive = !isDir && ARCHIVE_EXTENSIONS.includes(ext);

      if (!isDir && !isArchive) return;

      idx++;
      const { toolName, version } = parseToolNameAndVersion(entry.name, !isDir);

      let updateTime = '';
      try { updateTime = formatDateTime(fs.statSync(fullPath).mtime); }
      catch (e) { updateTime = '-'; }

      tools.push({ id: String(idx), toolName, version, pathOutline: fullPath, description: '', updateTime });
    });

    writeLog(`Total matching tools found: ${tools.length}`);
  } catch (err) {
    writeLog(`[Error] Failed to scan directory: ${err.message}`);
  }
  return tools;
}

function syncToGAS(tools) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(tools);
    function doRequest(reqUrl, data, redir) {
      if (redir > 5) { reject(new Error('Too many redirects')); return; }
      const u = new URL(reqUrl);
      const lib = u.protocol === 'https:' ? https : http;
      const opts = {
        hostname: u.hostname, port: u.protocol === 'https:' ? 443 : 80,
        path: u.pathname + u.search,
        method: data !== null ? 'POST' : 'GET',
        headers: data !== null ? { 'Content-Type': 'text/plain;charset=utf-8', 'Content-Length': Buffer.byteLength(data) } : {}
      };
      const req = lib.request(opts, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doRequest(res.headers.location, null, redir + 1); res.resume(); return;
        }
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({ raw: body }); } });
      });
      req.on('error', err => reject(err));
      if (data !== null) req.write(data);
      req.end();
    }
    doRequest(GAS_URL + '?type=aitools', postData, 0);
  });
}

// ── 單次同步 ──
async function runSync() {
  writeLog('🤖 Running AI Tools sync...');
  const tools = scanTools();
  if (tools.length === 0) {
    writeLog('⏭️ No tools found to sync.');
    return;
  }
  try {
    writeLog(`Sending payload of ${tools.length} items to GAS...`);
    const result = await syncToGAS(tools);
    writeLog(`Sync Success: ${JSON.stringify(result)}`);
  } catch (err) {
    writeLog(`Sync Error: ${err.message}`);
  }
}

// ── 持續背景同步 ──
writeLog('🚀 AI Tools Auto-Sync Service started (background mode).');
writeLog(`📂 Scan path: ${SCAN_PATH}`);
writeLog(`🔄 Sync interval: ${SYNC_INTERVAL / 1000} seconds`);

// 首次立即同步
runSync();

// 之後每 5 分鐘同步一次
setInterval(runSync, SYNC_INTERVAL);
