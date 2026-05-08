const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const app = express();
const PORT = 80;
const MESSAGES_FILE = '/data/messages.json';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

if (!fs.existsSync('/data')) {
  fs.mkdirSync('/data', { recursive: true });
}
if (!fs.existsSync(MESSAGES_FILE)) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify({ visitors: [], conversations: {}, lastReplyTs: {} }));
}

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
  data.conversations[visitorId].messages.push({ role: 'user', content, ts });
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

// Get all conversations with pending user messages (unreplied by real AI)
app.get('/api/pending', (req, res) => {
  const data = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
  const pending = [];
  for (const [vid, conv] of Object.entries(data.conversations)) {
    const msgs = conv.messages;
    const lastUser = msgs.filter(m => m.role === 'user').pop();
    const lastAi = msgs.filter(m => m.role === 'assistant' && !m.content.includes('正在看你的需求')).pop();
    if (lastUser && (!lastAi || lastUser.ts > lastAi.ts)) {
      pending.push({ visitorId: vid, name: conv.name, contact: conv.contact, lastMessage: lastUser.content, ts: lastUser.ts, messages: msgs });
    }
  }
  pending.sort((a, b) => b.ts - a.ts);
  res.json(pending);
});

// AI Reply - call DeepSeek to generate and save response
app.post('/api/reply', (req, res) => {
  const { visitorId, message } = req.body;
  if (!visitorId || !message) return res.status(400).json({ error: 'visitorId and message required' });
  const data = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
  if (!data.conversations[visitorId]) return res.status(404).json({ error: 'visitor not found' });
  
  data.conversations[visitorId].messages.push({ role: 'assistant', content: message, ts: Date.now() });
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(data, null, 2));
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Chat server running on port ${PORT}`);
});
