const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// ★★★ GAS Web App 網址 ★★★
const GAS_URL = 'https://script.google.com/macros/s/AKfycbw9LPdsBzyKtCcXcubhMxPV-yji1oA-0QE0X8L2VaqfuvwYnaMR66Jag4FELfDEt-VIfg/exec';

// ★★★ 掃描網路磁碟機上的 AI 工具資料夾 ★★★
const SCAN_PATH = '\\\\192.168.44.100\\ts-qa\\品檢組\\0_GT測試交接\\AI工具';
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

// ====== 中央 Web + API 伺服器 ======
// 同時提供網頁、開啟資料夾、下載壓縮檔功能
// 監聽 0.0.0.0 讓整個區域網路的同事都能使用
const API_PORT = 3939;
const os = require('os');

const MIME_MAP = {
  '.rar': 'application/x-rar-compressed',
  '.7z':  'application/x-7z-compressed',
  '.zip': 'application/zip'
};

// 自動取得本機區域網路 IP
function getLanIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const apiServer = http.createServer((req, res) => {
  // CORS headers (讓 GitHub Pages 也能呼叫 API)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${API_PORT}`);

  // ── 首頁：提供 index.html ──
  if ((url.pathname === '/' || url.pathname === '/index.html') && req.method === 'GET') {
    const htmlPath = path.join(__dirname, 'index.html');
    try {
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error loading index.html: ' + err.message);
    }
    return;
  }

  // ── 開啟資料夾 (僅在伺服器本機有效) ──
  if (url.pathname === '/open-folder' && req.method === 'GET') {
    const folderPath = url.searchParams.get('path');
    const format = url.searchParams.get('format');
    if (!folderPath) {
      if (format === 'html') {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h3>錯誤: 缺少 path 參數</h3>');
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Missing path parameter' }));
      }
      return;
    }

    const cmd = `explorer "${folderPath.replace(/"/g, '')}"`;
    writeLog(`📂 Opening folder: ${folderPath}`);
    exec(cmd, (err) => {
      if (format === 'html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>正在開啟資料夾...</title>
          </head>
          <body style="background: #1e1e24; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
            <div style="text-align: center; padding: 30px; border-radius: 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 8px 32px rgba(0,0,0,0.3); font-size: 16px;">
              <div style="font-size: 3rem; margin-bottom: 16px;">📂</div>
              <h3 style="margin: 0 0 8px 0; font-weight: 600;">已嘗試開啟資料夾</h3>
              <p style="margin: 0; color: rgba(255,255,255,0.6); font-size: 0.9rem;">本視窗將於 0.5 秒後自動關閉</p>
            </div>
            <script>
              setTimeout(() => {
                window.close();
              }, 500);
            </script>
          </body>
          </html>
        `);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      }
    });
    return;
  }

  // ── 下載壓縮檔 (所有用戶可用) ──
  if (url.pathname === '/download-file' && req.method === 'GET') {
    const filePath = url.searchParams.get('path');
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Missing path parameter' }));
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    if (!ARCHIVE_EXTENSIONS.includes(ext)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Not a supported archive file' }));
      return;
    }

    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Path is not a file' }));
        return;
      }

      const fileName = path.basename(filePath);
      const mimeType = MIME_MAP[ext] || 'application/octet-stream';

      writeLog(`⬇️ Downloading file: ${filePath} (${stat.size} bytes)`);

      res.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Content-Length': stat.size
      });

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      stream.on('error', (err) => {
        writeLog(`[Error] File stream error: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
    } catch (err) {
      writeLog(`[Error] File access error: ${err.message}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'File not found: ' + err.message }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// 監聽 0.0.0.0 讓區域網路內所有電腦都可以連線
apiServer.listen(API_PORT, '0.0.0.0', () => {
  const lanIP = getLanIP();
  writeLog(`🌐 Web + API server running!`);
  writeLog(`   → 本機存取: http://localhost:${API_PORT}/`);
  writeLog(`   → 區域網路: http://${lanIP}:${API_PORT}/`);
  writeLog(`   → 下載 API:  http://${lanIP}:${API_PORT}/download-file?path=<path>`);
  writeLog(`   → 開資料夾:  http://${lanIP}:${API_PORT}/open-folder?path=<path>`);
  writeLog(`   📢 請將上方區域網路網址分享給同事使用！`);
});

