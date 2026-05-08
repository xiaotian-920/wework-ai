const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = 80;
const MESSAGES_FILE = '/data/messages.json';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure messages file exists
if (!fs.existsSync('/data')) {
  fs.mkdirSync('/data', { recursive: true });
}
if (!fs.existsSync(MESSAGES_FILE)) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify({ visitors: [], conversations: {} }));
}

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Save a visitor's message
app.post('/api/message', (req, res) => {
  const { name, contact, content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });

  const ts = Date.now();
  const visitorId = req.headers['x-visitor-id'] || 'anon-' + ts;
  const data = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));

  if (!data.conversations[visitorId]) {
    data.conversations[visitorId] = { name: name || '访客', contact: contact || '', messages: [] };
    if (!data.visitors.includes(visitorId)) data.visitors.push(visitorId);
  }

  data.conversations[visitorId].messages.push({
    role: 'user',
    content,
    ts
  });

  // Auto-reply with a welcome / processing message
  data.conversations[visitorId].messages.push({
    role: 'assistant',
    content: '收到你的消息啦！✍️ 我正在看你的需求，稍等片刻马上回复你～',
    ts: Date.now()
  });

  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(data, null, 2));
  res.json({ ok: true, visitorId });
});

// Get messages for a visitor
app.get('/api/messages/:visitorId', (req, res) => {
  const data = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
  const conv = data.conversations[req.params.visitorId];
  res.json(conv ? conv.messages : []);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
