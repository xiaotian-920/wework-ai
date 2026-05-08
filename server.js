const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 80;
const STATIC_DIR = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let filePath;
  
  if (url.pathname === '/') {
    filePath = path.join(STATIC_DIR, 'landing.html');
    if (!fs.existsSync(filePath)) {
      filePath = path.join(STATIC_DIR, 'index.html');
    }
  } else {
    filePath = path.join(STATIC_DIR, url.pathname);
  }
  
  serveFile(res, filePath);
});

server.listen(PORT, () => {
  console.log('Server running on port', PORT);
});
