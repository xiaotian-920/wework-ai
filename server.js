const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const app = express();
const PORT = 80;
const MESSAGES_FILE = '/data/messages.json';
const DEEPSEEK_KEY = 'sk-3638d2ab8b2945dbb1aef49b677c71fd';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

if (!fs.existsSync('/data')) fs.mkdirSync('/data', { recursive: true });
if (!fs.existsSync(MESSAGES_FILE)) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify({
    visitors: [], conversations: {},
    paidOrders: [],
    drafts: {}
  }));
}

function loadData() { return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8')); }
function saveData(data) { fs.writeFileSync(MESSAGES_FILE, JSON.stringify(data, null, 2)); }

// Call DeepSeek API
function askDeepSeek(messages) {
  return new Promise((resolve) => {
    const context = messages.slice(-6).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }));

    const systemPrompt = '你是小天，一个专业的AI中文写作助手。风格亲切高效。直接根据客户需求写出预览稿（300-500字），末尾提醒满意后再付款。先写后付。控制字数在500字内。';

    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'system', content: systemPrompt }, ...context],
      temperature: 0.7,
      max_tokens: 1000
    });

    const opts = {
      hostname: 'api.deepseek.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + DEEPSEEK_KEY
      }
    };

    try {
      const req = https.request(opts, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(d);
            resolve(json.choices?.[0]?.message?.content || '收到你的消息啦，我正在看需求，稍等回复你～');
          } catch(e) { resolve('收到你的消息啦，让我想想，马上回复你～'); }
        });
      });
      req.on('error', () => resolve('收到你的消息啦，稍等一下～'));
      req.write(body);
      req.end();
    } catch(e) { resolve('收到你的消息啦，马上处理～'); }
  });
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle message - with DeepSeek auto reply
app.post('/api/message', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const visitorId = req.headers['x-visitor-id'] || 'anon-' + Date.now();
  const data = loadData();

  if (!data.conversations[visitorId]) {
    data.conversations[visitorId] = { name: '访客', contact: '', messages: [] };
    if (!data.visitors.includes(visitorId)) data.visitors.push(visitorId);
  }

  data.conversations[visitorId].messages.push({ role: 'user', content, ts: Date.now() });
  saveData(data);
  res.json({ ok: true, visitorId });

  // Call DeepSeek asynchronously (non-blocking)
  askDeepSeek(data.conversations[visitorId].messages).then(reply => {
    try {
      const d = loadData();
      d.conversations[visitorId].messages.push({ role: 'assistant', content: reply, ts: Date.now() });
      saveData(d);
    } catch(e) { /* ignore save errors after response */ }
  });
});

// Get messages for a visitor
app.get('/api/messages/:visitorId', (req, res) => {
  const data = loadData();
  res.json(data.conversations[req.params.visitorId]?.messages || []);
});

// Get pending conversations
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

// Save a reply (for cron)
app.post('/api/reply', (req, res) => {
  const { visitorId, message } = req.body;
  if (!visitorId || !message) return res.status(400).json({ error: 'visitorId and message required' });
  const data = loadData();
  if (!data.conversations[visitorId]) return res.status(404).json({ error: 'not found' });
  data.conversations[visitorId].messages.push({ role: 'assistant', content: message, ts: Date.now() });
  saveData(data);
  res.json({ ok: true });
});

// Mark as paid
app.post('/api/paid', (req, res) => {
  const { visitorId } = req.body;
  if (!visitorId) return res.status(400).json({ error: 'visitorId required' });
  const data = loadData();
  if (!data.conversations[visitorId]) return res.status(404).json({ error: 'not found' });
  data.paidOrders.push({ visitorId, plan: 'standard', paidAt: Date.now() });
  data.conversations[visitorId].messages.push({
    role: 'assistant',
    content: '✅ 收款确认成功！🎉 感谢信任！以下是完整版文稿。如有修改需求，随时告诉我，无限修改免费！🙏',
    ts: Date.now()
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
