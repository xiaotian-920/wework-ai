const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = 80;
const MESSAGES_FILE = '/data/messages.json';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

if (!fs.existsSync('/data')) fs.mkdirSync('/data', { recursive: true });
if (!fs.existsSync(MESSAGES_FILE)) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify({ 
    visitors: [], conversations: {}, 
    paidOrders: [],
    drafts: {}
  }));
}

function loadData() {
  return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
}
function saveData(data) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(data, null, 2));
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Save a visitor's message
app.post('/api/message', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const ts = Date.now();
  const visitorId = req.headers['x-visitor-id'] || 'anon-' + ts;
  const data = loadData();
  
  if (!data.conversations[visitorId]) {
    data.conversations[visitorId] = { name: '访客', contact: '', messages: [] };
    if (!data.visitors.includes(visitorId)) data.visitors.push(visitorId);
  }
  
  data.conversations[visitorId].messages.push({ role: 'user', content, ts });
  saveData(data);
  res.json({ ok: true, visitorId });
});

// Get messages for a visitor
app.get('/api/messages/:visitorId', (req, res) => {
  const data = loadData();
  const conv = data.conversations[req.params.visitorId];
  res.json(conv ? conv.messages : []);
});

// Get pending conversations needing AI reply
app.get('/api/pending', (req, res) => {
  const data = loadData();
  const pending = [];
  for (const [vid, conv] of Object.entries(data.conversations)) {
    const msgs = conv.messages;
    const lastUser = [...msgs].reverse().find(m => m.role === 'user');
    const lastAi = [...msgs].reverse().find(m => m.role === 'assistant');
    if (lastUser && (!lastAi || lastUser.ts > lastAi.ts)) {
      pending.push({ visitorId: vid, name: conv.name, lastMessage: lastUser.content, ts: lastUser.ts, messages: msgs });
    }
  }
  pending.sort((a, b) => b.ts - a.ts);
  res.json(pending);
});

// AI saves a reply (for cron to call)
app.post('/api/reply', (req, res) => {
  const { visitorId, message } = req.body;
  if (!visitorId || !message) return res.status(400).json({ error: 'visitorId and message required' });
  const data = loadData();
  if (!data.conversations[visitorId]) return res.status(404).json({ error: 'visitor not found' });
  data.conversations[visitorId].messages.push({ role: 'assistant', content: message, ts: Date.now() });
  saveData(data);
  res.json({ ok: true });
});

// Mark as paid
app.post('/api/paid', (req, res) => {
  const { visitorId } = req.body;
  if (!visitorId) return res.status(400).json({ error: 'visitorId required' });
  const data = loadData();
  if (!data.conversations[visitorId]) return res.status(400).json({ error: 'conversation not found' });
  data.paidOrders.push({ visitorId, plan: 'standard', paidAt: Date.now() });
  data.conversations[visitorId].messages.push({
    role: 'assistant', content: '✅ 收款确认成功！🎉 感谢信任！完整版文稿已交付，有任何修改需求随时告诉我，无限修改！🙏', ts: Date.now()
  });
  saveData(data);
  res.json({ ok: true });
});

// Get unpaid orders
app.get('/api/unpaid', (req, res) => {
  const data = loadData();
  const paidIds = new Set(data.paidOrders.map(o => o.visitorId));
  const unpaid = [];
  for (const [vid, conv] of Object.entries(data.conversations)) {
    if (paidIds.has(vid)) continue;
    const msgs = conv.messages;
    const hasDraft = msgs.some(m => m.role === 'assistant' && 
      (m.content.includes('初稿') || m.content.includes('预览') || m.content.includes('写好了') || m.content.includes('以下是') || m.content.includes('满意')));
    if (hasDraft) {
      unpaid.push({ visitorId: vid, name: conv.name, needsReminder: true, lastActivity: msgs[msgs.length - 1]?.ts || 0 });
    }
  }
  unpaid.sort((a, b) => b.lastActivity - a.lastActivity);
  res.json(unpaid);
});

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
