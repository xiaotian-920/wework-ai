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
    paidOrders: [], drafts: {}
  }));
}

function loadData() { return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8')); }
function saveData(data) { fs.writeFileSync(MESSAGES_FILE, JSON.stringify(data, null, 2)); }

// Call DeepSeek
function askDeepSeek(messages) {
  return new Promise((resolve) => {
    const context = messages.slice(-6).map(m => ({ role: m.role, content: m.content }));
    const sys = '你是小天，专业的AI中文写作助手。根据用户需求直接写出预览稿（300-500字），风格亲切。末尾问"满意吗？满意的话记得付款哦"。控制字数。';
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'system', content: sys }, ...context],
      temperature: 0.7, max_tokens: 1000
    });
    const opts = {
      hostname: 'api.deepseek.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + DEEPSEEK_KEY }
    };
    try {
      const req = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { resolve(JSON.parse(d).choices?.[0]?.message?.content || '收到！'); } catch(e){ resolve('收到！'); }}); });
      req.on('error', () => resolve('收到！'));
      req.write(body); req.end();
    } catch(e) { resolve('收到！'); }
  });
}

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// Save message + auto DeepSeek reply
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

  // Auto-reply with DeepSeek (non-blocking)
  askDeepSeek(data.conversations[visitorId].messages).then(reply => {
    try {
      const d = loadData();
      d.conversations[visitorId].messages.push({ role: 'assistant', content: reply, ts: Date.now() });
      saveData(d);
      console.log('AI replied to', visitorId);
    } catch(e) {}
  }).catch(() => {});
});

app.get('/api/messages/:visitorId', (req, res) => {
  const data = loadData();
  res.json(data.conversations[req.params.visitorId]?.messages || []);
});

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

app.post('/api/reply', (req, res) => {
  const { visitorId, message } = req.body;
  if (!visitorId || !message) return res.status(400).json({ error: 'required' });
  const data = loadData();
  if (!data.conversations[visitorId]) return res.status(404).json({ error: 'not found' });
  data.conversations[visitorId].messages.push({ role: 'assistant', content: message, ts: Date.now() });
  saveData(data);
  res.json({ ok: true });
});

app.post('/api/paid', async (req, res) => {
  const { visitorId } = req.body;
  if (!visitorId) return res.status(400).json({ error: 'visitorId required' });
  const data = loadData();
  if (!data.conversations[visitorId]) return res.status(404).json({ error: 'not found' });
  
  // Mark as paid
  data.paidOrders.push({ visitorId, plan: 'standard', paidAt: Date.now() });
  
  // Get original user request
  const msgs = data.conversations[visitorId].messages;
  const firstUserMsg = msgs.find(m => m.role === 'user');
  const userRequest = firstUserMsg ? firstUserMsg.content : '';
  
  // Generate full version via DeepSeek
  const fullVersionPrompt = '根据用户的需求，写一份完整、专业、详细的文稿（800-1500字）。这是客户付款后的完整版交付，结构要完整、内容要充实。\n\n用户需求：' + userRequest;
  
  // Send confirmation immediately
  const confirmation = '✅ 收款成功！🎉 感谢信任！正在为您生成完整版文稿……请稍等片刻✍️';
  msgs.push({ role: 'assistant', content: confirmation, ts: Date.now() });
  saveData(data);
  res.json({ ok: true });
  
  // Generate full version (async, non-blocking)
  try {
    const fullContent = await askDeepSeek([
      { role: 'system', content: '你是小天，专业AI写作助手。客户已付款，现在需要交付完整版文稿。写得越详细越好、越专业越好，800-1500字。结构完整，直接给出成品。' },
      { role: 'user', content: userRequest }
    ]);
    const d = loadData();
    d.conversations[visitorId].messages.push({
      role: 'assistant',
      content: '📄 **完整版文稿**（已交付）\n\n' + fullContent + '\n\n---\n有任何修改需求随时告诉我，无限修改！🙏',
      ts: Date.now()
    });
    saveData(d);
    console.log('Full version delivered to', visitorId);
  } catch(e) {
    console.error('Failed to generate full version:', e.message);
  }
});

app.get('/api/unpaid', (req, res) => {
  const data = loadData();
  const paidIds = new Set(data.paidOrders.map(o => o.visitorId));
  const unpaid = [];
  for (const [vid, conv] of Object.entries(data.conversations)) {
    if (paidIds.has(vid)) continue;
    const msgs = conv.messages;
    const hasDraft = msgs.some(m => m.role === 'assistant' && (m.content.includes('初稿') || m.content.includes('预览') || m.content.includes('写好了') || m.content.includes('以下是') || m.content.includes('满意')));
    if (hasDraft) unpaid.push({ visitorId: vid, name: conv.name, needsReminder: true, lastActivity: msgs[msgs.length-1]?.ts || 0 });
  }
  unpaid.sort((a, b) => b.lastActivity - a.lastActivity);
  res.json(unpaid);
});

app.listen(PORT, () => console.log('Server on port ' + PORT));
