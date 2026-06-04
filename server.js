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

  // ── 網頁版資料夾瀏覽器 (提供所有用戶直接網頁開啟查看) ──
  if (url.pathname === '/view-folder' && req.method === 'GET') {
    const folderPath = url.searchParams.get('path');
    if (!folderPath) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h3>錯誤: 缺少 path 參數</h3>');
      return;
    }

    // 安全檢查：路徑防護，限制只能存取 SCAN_PATH 下的資料夾
    const normalizedPath = path.normalize(folderPath).toLowerCase().replace(/\\/g, '/');
    const normalizedScanRoot = path.normalize(SCAN_PATH).toLowerCase().replace(/\\/g, '/');
    if (!normalizedPath.startsWith(normalizedScanRoot)) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h3>錯誤: 拒絕存取，路徑超出 AI 工具目錄範圍</h3>');
      return;
    }

    try {
      const stats = fs.statSync(folderPath);
      if (!stats.isDirectory()) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h3>錯誤: 指定的路徑不是一個資料夾</h3>');
        return;
      }

      const items = fs.readdirSync(folderPath, { withFileTypes: true });
      const dirs = [];
      const files = [];

      items.forEach(item => {
        if (item.name.startsWith('.')) return; // 忽略隱藏檔
        const fullPath = path.join(folderPath, item.name);
        try {
          const itemStat = fs.statSync(fullPath);
          const updateTime = formatDateTime(itemStat.mtime);
          if (item.isDirectory()) {
            dirs.push({ name: item.name, path: fullPath, size: '-', time: updateTime });
          } else {
            const sizeKB = (itemStat.size / 1024).toFixed(1) + ' KB';
            files.push({ name: item.name, path: fullPath, size: sizeKB, time: updateTime });
          }
        } catch (e) {}
      });

      // 輔助 HTML 跳脫
      const esc = (txt) => {
        if (!txt) return '';
        return txt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      };

      const listHtml = [...dirs, ...files].map(item => {
        const isDir = item.size === '-';
        const icon = isDir ? '📁' : '📄';
        const action = isDir 
          ? `<a class="action-link view" href="/view-folder?path=${encodeURIComponent(item.path)}">開啟</a>`
          : `<a class="action-link download" href="/download-file?path=${encodeURIComponent(item.path)}" target="_blank">下載</a>`;
        
        return `
          <tr>
            <td><span class="file-icon">${icon}</span> ${esc(item.name)}</td>
            <td>${isDir ? '資料夾' : '檔案'}</td>
            <td style="text-align: right;">${item.size}</td>
            <td>${item.time}</td>
            <td style="text-align: center;">${action}</td>
          </tr>
        `;
      }).join('');

      const parentPath = path.dirname(folderPath);
      const isRoot = normalizedPath === normalizedScanRoot;
      const parentLink = isRoot 
        ? `<span class="back-btn disabled">已是根目錄</span>` 
        : `<a class="back-btn" href="/view-folder?path=${encodeURIComponent(parentPath)}">⬅️ 回上一層</a>`;

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>AI 工具網頁瀏覽器 - ${esc(path.basename(folderPath))}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            :root {
              --bg: #0f0f12;
              --surface: #1e1e24;
              --border: rgba(255,255,255,0.08);
              --text: #e2e8f0;
              --text-dim: #94a3b8;
              --accent: #6c63ff;
              --accent-hover: #8b5cf6;
              --green: #10b981;
            }
            body {
              background-color: var(--bg);
              color: var(--text);
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              margin: 0;
              padding: 24px;
            }
            .container {
              max-width: 1200px;
              margin: 0 auto;
              background: var(--surface);
              border: 1px solid var(--border);
              border-radius: 12px;
              padding: 24px;
              box-shadow: 0 8px 32px rgba(0,0,0,0.4);
            }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              border-bottom: 1px solid var(--border);
              padding-bottom: 16px;
              margin-bottom: 20px;
              flex-wrap: wrap;
              gap: 16px;
            }
            .title {
              margin: 0;
              font-size: 1.5rem;
              font-weight: 700;
              background: linear-gradient(135deg, #6c63ff, #00d2ff);
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              display: flex;
              align-items: center;
              gap: 10px;
            }
            .path-info {
              font-family: monospace;
              background: rgba(0,0,0,0.2);
              padding: 10px 14px;
              border-radius: 8px;
              border: 1px solid var(--border);
              font-size: 0.9rem;
              color: var(--text-dim);
              margin: 12px 0 20px 0;
              word-break: break-all;
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 16px;
            }
            .copy-btn {
              background: rgba(255,255,255,0.05);
              border: 1px solid var(--border);
              color: var(--text);
              padding: 6px 12px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 0.85rem;
              font-weight: 600;
              transition: all 0.2s;
              white-space: nowrap;
            }
            .copy-btn:hover {
              background: var(--accent);
              border-color: var(--accent);
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 10px;
            }
            th {
              background: rgba(255,255,255,0.02);
              text-align: left;
              padding: 14px 16px;
              font-weight: 600;
              color: var(--text);
              border-bottom: 2px solid var(--border);
            }
            td {
              padding: 12px 16px;
              border-bottom: 1px solid rgba(255,255,255,0.04);
              font-size: 0.95rem;
              color: var(--text-dim);
            }
            tr:hover td {
              color: var(--text);
              background: rgba(108,99,255,0.05);
            }
            .file-icon {
              font-size: 1.1rem;
              margin-right: 6px;
            }
            .back-btn {
              display: inline-flex;
              align-items: center;
              text-decoration: none;
              color: var(--text-dim);
              background: rgba(255,255,255,0.04);
              border: 1px solid var(--border);
              padding: 8px 16px;
              border-radius: 6px;
              font-size: 0.9rem;
              transition: all 0.2s;
            }
            .back-btn:hover:not(.disabled) {
              background: rgba(255,255,255,0.08);
              color: var(--text);
            }
            .back-btn.disabled {
              opacity: 0.5;
              cursor: not-allowed;
            }
            .action-link {
              text-decoration: none;
              padding: 6px 16px;
              border-radius: 6px;
              font-size: 0.85rem;
              font-weight: 600;
              display: inline-block;
              transition: all 0.2s;
            }
            .action-link.view {
              background: rgba(108,99,255,0.15);
              color: #a5a0ff;
              border: 1px solid rgba(108,99,255,0.3);
            }
            .action-link.view:hover {
              background: var(--accent);
              color: #fff;
            }
            .action-link.download {
              background: rgba(16,185,129,0.15);
              color: #34d399;
              border: 1px solid rgba(16,185,129,0.3);
            }
            .action-link.download:hover {
              background: var(--green);
              color: #fff;
            }
            .toast {
              position: fixed;
              bottom: 24px;
              left: 50%;
              transform: translateX(-50%);
              background: #10b981;
              color: white;
              padding: 12px 24px;
              border-radius: 8px;
              box-shadow: 0 8px 24px rgba(0,0,0,0.3);
              display: none;
              font-size: 0.9rem;
              font-weight: 600;
              z-index: 1000;
              animation: toastIn 0.2s ease-out;
            }
            @keyframes toastIn {
              from { transform: translate(-50%, 20px); opacity: 0; }
              to { transform: translate(-50%, 0); opacity: 1; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2 class="title">📂 AI 工具網頁瀏覽器</h2>
              ${parentLink}
            </div>
            <div class="path-info">
              <span>目前資料夾路徑: <span id="path-text">${esc(folderPath)}</span></span>
              <button class="copy-btn" onclick="copyPath()">📋 複製完整路徑</button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>名稱</th>
                  <th>類型</th>
                  <th style="text-align: right;">大小</th>
                  <th>修改時間</th>
                  <th style="text-align: center;">操作</th>
                </tr>
              </thead>
              <tbody>
                ${listHtml || '<tr><td colspan="5" style="text-align:center; padding: 40px 0;">此資料夾內沒有檔案或子資料夾</td></tr>'}
              </tbody>
            </table>
          </div>
          <div id="toast" class="toast">✅ 已複製路徑成功，可貼上至本機檔案總管！</div>
          <script>
            function copyPath() {
              const txt = document.getElementById('path-text').innerText;
              navigator.clipboard.writeText(txt).then(() => {
                const t = document.getElementById('toast');
                t.style.display = 'block';
                setTimeout(() => { t.style.display = 'none'; }, 2500);
              });
            }
          </script>
        </body>
        </html>
      `);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h3>讀取資料夾發生錯誤: ' + err.message + '</h3>');
    }
    return;
  }

  // ── 中介下載網頁 (為了解決安全 HTTPS 網頁對 HTTP 進行直接下載時被 Mixed Content 阻擋的問題) ──
  if (url.pathname === '/download-page' && req.method === 'GET') {
    const filePath = url.searchParams.get('path');
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h3>錯誤: 缺少 path 參數</h3>');
      return;
    }

    const esc = (txt) => {
      if (!txt) return '';
      return txt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };

    const fileName = path.basename(filePath);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>正在下載檔案 - ${esc(fileName)}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            background: #0f0f12;
            color: #fff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
          }
          .card {
            text-align: center;
            padding: 40px 30px;
            border-radius: 16px;
            background: #1e1e24;
            border: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 12px 40px rgba(0,0,0,0.5);
            max-width: 480px;
            width: 90%;
            box-sizing: border-box;
          }
          .icon {
            font-size: 3.5rem;
            margin-bottom: 20px;
            animation: bounce 2s infinite;
          }
          h3 {
            margin: 0 0 12px 0;
            font-size: 1.4rem;
            font-weight: 700;
            background: linear-gradient(135deg, #6c63ff, #00d2ff);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          .file-name {
            margin: 0 0 24px 0;
            color: #94a3b8;
            font-size: 0.95rem;
            word-break: break-all;
            background: rgba(0,0,0,0.2);
            padding: 10px 14px;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.04);
            font-family: monospace;
          }
          .tip {
            margin: 0;
            color: rgba(255,255,255,0.4);
            font-size: 0.85rem;
          }
          .tip a {
            color: #a5a0ff;
            text-decoration: none;
            font-weight: 600;
          }
          .tip a:hover {
            text-decoration: underline;
          }
          @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">⬇️</div>
          <h3>正在下載您的檔案</h3>
          <div class="file-name">${esc(fileName)}</div>
          <p class="tip">已為您觸發下載，本視窗將自動關閉。<br>若下載沒有開始，請 <a href="/download-file?path=${encodeURIComponent(filePath)}">點擊此處手動下載</a></p>
        </div>
        <script>
          // 透過同源導航觸發下載，避開 HTTPS 網域對 HTTP 下載的 Mixed Content 阻擋政策
          setTimeout(() => {
            window.location.href = "/download-file?path=" + encodeURIComponent("${filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}");
          }, 300);
          
          // 下載觸發後，2.5秒自動關閉本分頁
          setTimeout(() => {
            window.close();
          }, 2500);
        </script>
      </body>
      </html>
    `);
    return;
  }

  // ── 下載壓縮檔 或 整個資料夾打包 (所有用戶可用) ──
  if (url.pathname === '/download-file' && req.method === 'GET') {
    const filePath = url.searchParams.get('path');
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Missing path parameter' }));
      return;
    }

    try {
      const stat = fs.statSync(filePath);
      const fileName = path.basename(filePath);

      if (stat.isFile()) {
        // ── 壓縮檔下載 ──
        const ext = path.extname(filePath).toLowerCase();
        if (!ARCHIVE_EXTENSIONS.includes(ext)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Not a supported archive file' }));
          return;
        }

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
      } else if (stat.isDirectory()) {
        // ── 資料夾即時壓縮成 ZIP 下載 ──
        const tempZipName = `${fileName}.zip`;
        const tempZipPath = path.join(__dirname, `temp_download_${Date.now()}.zip`);
        
        writeLog(`🤐 Zipping folder for download: ${filePath} -> ${tempZipPath}`);
        
        const psPath = filePath.replace(/'/g, "''");
        const psDest = tempZipPath.replace(/'/g, "''");
        const cmd = `powershell -Command "Compress-Archive -Path '${psPath}' -DestinationPath '${psDest}' -Force"`;
        
        exec(cmd, (err) => {
          if (err) {
            writeLog(`[Error] Zipping failed: ${err.message}`);
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<h3>壓縮資料夾失敗: ${err.message}</h3>`);
            return;
          }

          try {
            const zipStat = fs.statSync(tempZipPath);
            writeLog(`⬇️ Downloading zipped folder: ${tempZipName} (${zipStat.size} bytes)`);

            res.writeHead(200, {
              'Content-Type': 'application/zip',
              'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(tempZipName)}`,
              'Content-Length': zipStat.size
            });

            const stream = fs.createReadStream(tempZipPath);
            stream.pipe(res);
            
            // 下載完成後刪除暫存 zip 檔
            res.on('finish', () => {
              fs.unlink(tempZipPath, (unlinkErr) => {
                if (unlinkErr) writeLog(`[Warning] Failed to delete temp zip: ${unlinkErr.message}`);
              });
            });
            
            stream.on('error', (streamErr) => {
              writeLog(`[Error] Zip stream error: ${streamErr.message}`);
              fs.unlink(tempZipPath, () => {});
            });
          } catch (statErr) {
            writeLog(`[Error] Zip file access error: ${statErr.message}`);
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<h3>檔案存取失敗: ${statErr.message}</h3>`);
          }
        });
      }
    } catch (err) {
      writeLog(`[Error] Path access error: ${err.message}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Path not found: ' + err.message }));
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

