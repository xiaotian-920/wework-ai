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
    paidOrders: [], // { visitorId, plan, amount, paidAt }
    drafts: {}      // { visitorId: { draftContent, deliveredAt } }
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
  const { name, contact, content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const ts = Date.now();
  const visitorId = req.headers['x-visitor-id'] || 'anon-' + ts;
  const data = loadData();
  
  if (!data.conversations[visitorId]) {
    data.conversations[visitorId] = { name: name || '访客', contact: contact || '', messages: [] };
    if (!data.visitors.includes(visitorId)) data.visitors.push(visitorId);
  }
  
  data.conversations[visitorId].messages.push({ role: 'user', content, ts });
  
  // Auto-reply with welcome
  data.conversations[visitorId].messages.push({ 
    role: 'assistant', content: '收到你的消息啦！✍️ 我正在看你的需求，稍等片刻马上回复你～', ts 
  });
  
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
    const lastRealAi = msgs.filter(m => m.role === 'assistant' && !m.content.includes('正在看你的需求')).pop();
    if (lastUser && (!lastRealAi || lastUser.ts > lastRealAi.ts)) {
      pending.push({ visitorId: vid, name: conv.name, contact: conv.contact, lastMessage: lastUser.content, ts: lastUser.ts, messages: msgs });
    }
  }
  pending.sort((a, b) => b.ts - a.ts);
  res.json(pending);
});

// AI saves a reply
app.post('/api/reply', (req, res) => {
  const { visitorId, message } = req.body;
  if (!visitorId || !message) return res.status(400).json({ error: 'visitorId and message required' });
  const data = loadData();
  if (!data.conversations[visitorId]) return res.status(404).json({ error: 'visitor not found' });
  data.conversations[visitorId].messages.push({ role: 'assistant', content: message, ts: Date.now() });
  saveData(data);
  res.json({ ok: true });
});

// AI marks an order as paid
app.post('/api/paid', (req, res) => {
  const { visitorId, plan, amount } = req.body;
  if (!visitorId) return res.status(400).json({ error: 'visitorId required' });
  const data = loadData();
  data.paidOrders.push({ visitorId, plan: plan || 'standard', amount: amount || 99, paidAt: Date.now() });
  saveData(data);
  // Send a thank-you and mention full delivery
  data.conversations[visitorId].messages.push({
    role: 'assistant', content: '✅ 已确认收款！完整版文稿将在5分钟内发送给你～感谢信任！🙏', ts: Date.now()
  });
  saveData(data);
  res.json({ ok: true });
});

// Get unpaid orders needing payment reminders
app.get('/api/unpaid', (req, res) => {
  const data = loadData();
  const paidVisitorIds = new Set(data.paidOrders.map(o => o.visitorId));
  const unpaid = [];
  for (const [vid, conv] of Object.entries(data.conversations)) {
    if (paidVisitorIds.has(vid)) continue; // already paid
    // Check if a draft was delivered (AI mentioned preview/completed a draft)
    const msgs = conv.messages;
    const hasDraft = msgs.some(m => m.role === 'assistant' && (m.content.includes('初稿') || m.content.includes('预览') || m.content.includes('写好了') || m.content.includes('以下是')));
    const hasAskedPay = msgs.some(m => m.role === 'assistant' && (m.content.includes('满意') || m.content.includes('付款') || m.content.includes('扫码')));
    if (hasDraft) {
      const lastDraftMsg = [...msgs].reverse().find(m => m.role === 'assistant' && (m.content.includes('初稿') || m.content.includes('预览') || m.content.includes('写好了') || m.content.includes('以下是')));
      const lastUserMsg = [...msgs].reverse().find(m => m.role === 'user');
      const lastReplySinceDraft = lastUserMsg && lastDraftMsg && lastUserMsg.ts > lastDraftMsg.ts;
      unpaid.push({ 
        visitorId: vid, name: conv.name, contact: conv.contact, 
        hasAskedPay, needsReminder: !hasAskedPay || lastReplySinceDraft,
        lastActivity: msgs[msgs.length - 1]?.ts || 0
      });
    }
  }
  unpaid.sort((a, b) => b.lastActivity - a.lastActivity);
  res.json(unpaid);
});

app.listen(PORT, () => {
  console.log(`Chat server running on port ${PORT}`);
});
