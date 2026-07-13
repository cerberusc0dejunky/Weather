const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const ARCHIVE_FILE = path.join(__dirname, 'notebooklm', 'telemetry_archive.json');

// Ensure the directory and file exist
if (!fs.existsSync(path.dirname(ARCHIVE_FILE))) {
  fs.mkdirSync(path.dirname(ARCHIVE_FILE), { recursive: true });
}
if (!fs.existsSync(ARCHIVE_FILE)) {
  fs.writeFileSync(ARCHIVE_FILE, JSON.stringify([], null, 2));
}

const server = http.createServer((req, res) => {
  // Handle CORS Preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/log') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        
        // Append a server timestamp to track when it was ingested
        payload._ingestedAt = new Date().toISOString();

        // Read existing archive
        const existingData = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8'));
        existingData.push(payload);

        // Write back
        fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(existingData, null, 2));

        console.log(`[+] Telemetry successfully archived. Total entries: ${existingData.length}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Telemetry archived locally' }));
      } catch (err) {
        console.error('[-] Failed to process telemetry payload:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`📡 DAISY Local Telemetry Logger Running on Port ${PORT}`);
  console.log(`💾 Archiving all ground-truth data to: ${ARCHIVE_FILE}`);
  console.log(`====================================================`);
});
