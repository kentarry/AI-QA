const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8899;
const DB_FILE = path.join(__dirname, 'kanban_data.json');

// 確保資料庫檔案存在
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, '[]');
}

// 取得本機 IP 以方便分享給同事
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const server = http.createServer((req, res) => {
  // 處理 CORS 設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // API: 讀取資料
  if (req.url === '/api/data' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    const data = fs.readFileSync(DB_FILE, 'utf8');
    res.end(data);
    return;
  }

  // API: 儲存資料
  if (req.url === '/api/data' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        JSON.parse(body); // 確保是合法的 JSON 才寫入
        fs.writeFileSync(DB_FILE, body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // 靜態網頁伺服器：讀取 HTML 檔
  let filePath = req.url === '/' ? '/antigravity_kanban.html' : req.url;
  // 安全性處理，防止目錄遍歷
  filePath = path.join(__dirname, path.normalize(filePath).replace(/^(\.\.[\/\\])+/, ''));
  
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const mimeMap = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json'
    };
    res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'text/plain' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('404 Not Found');
  }
});

const localIp = getLocalIp();

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 品檢流程看板伺服器已啟動！');
  console.log('='.repeat(60));
  console.log(`💻 【你自己用】請開啟: http://localhost:${PORT}`);
  console.log(`🤝 【傳給同事】請提供: http://${localIp}:${PORT}`);
  console.log('='.repeat(60));
  console.log('請讓這個視窗保持開啟，關閉視窗即停止伺服器。\n(如需中斷可按下 Ctrl + C)');
});
