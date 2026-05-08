const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 10000;
const MESSAGES_FILE = '/data/messages.json';
const DEEPSEEK_KEY = 'sk-3638d2ab8b2945dbb1aef49b677c71fd';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Init data file
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
  return new Promise((resolve, reject) => {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const context = messages.slice(-8).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }));

    const systemPrompt = `你是小天，一个专业的AI中文写作助手。你的风格：亲切、专业、高效。
你可以写：小红书文案、公众号文章、商业计划书、演讲稿、简历、工作总结、推广文案等。
定价：短文¥49(≤500字)、标准¥99(500-1500字)、长文¥199(1500-3000字)、深度¥299(3000-5000字)。
服务模式：先写稿→满意后付款→无限修改。
规则：
1. 客户需求明确时，直接写稿预览（300-500字预览稿），末尾提醒满意后再付款
2. 客户仅咨询时，友好解答
3. 先写后付，不要让客户先付款
4. 每次回复控制在500字以内
5. 尽量自然中文交流`;

    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        ...context
      ],
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

    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          const reply = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
          resolve(reply || '收到你的消息啦！✍️ 我正在处理，稍等一下～');
        } catch(e) {
          resolve('收到你的消息啦！✍️ 让我想想，马上回复你～');
        }
      });
    });
    req.on('error', () => resolve('收到你的消息啦！✍️ 稍等我一下～'));
    req.write(body);
    req.end();
  });
}

// Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle message - with DeepSeek auto reply
app.post('/api/message', async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });

  const visitorId = req.headers['x-visitor-id'] || 'anon-' + Date.now();
  const data = loadData();

  if (!data.conversations[visitorId]) {
    data.conversations[visitorId] = { name: '访客', contact: '', messages: [] };
    if (!data.visitors.includes(visitorId)) data.visitors.push(visitorId);
  }

  // Save user message
  data.conversations[visitorId].messages.push({ role: 'user', content, ts: Date.now() });
  saveData(data);

  // Call DeepSeek in background (don't block response)
  const conv = data.conversations[visitorId];
  
  askDeepSeek(conv.messages).then(reply => {
    const d = loadData();
    d.conversations[visitorId].messages.push({ role: 'assistant', content: reply, ts: Date.now() });
    saveData(d);
    console.log('AI replied to', visitorId, '- length:', reply.length);
  }).catch(err => {
    console.error('DeepSeek error for', visitorId, ':', err.message);
  });

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
    // Check if user message is newer than last AI reply (needs processing)
    if (lastUser && (!lastAi || lastUser.ts > lastAi.ts)) {
      pending.push({
        visitorId: vid, name: conv.name,
        lastMessage: lastUser.content, ts: lastUser.ts,
        messages: msgs
      });
    }
  }
  pending.sort((a, b) => b.ts - a.ts);
  res.json(pending);
});

// AI saves a reply (for when the check cron calls)
app.post('/api/reply', (req, res) => {
  const { visitorId, message } = req.body;
  if (!visitorId || !message) return res.status(400).json({ error: 'visitorId and message required' });
  const data = loadData();
  if (!data.conversations[visitorId]) return res.status(404).json({ error: 'visitor not found' });
  data.conversations[visitorId].messages.push({ role: 'assistant', content: message, ts: Date.now() });
  saveData(data);
  res.json({ ok: true });
});

// Mark as paid + send full version
app.post('/api/paid', (req, res) => {
  const { visitorId } = req.body;
  if (!visitorId) return res.status(400).json({ error: 'visitorId required' });

  const data = loadData();
  if (!data.conversations[visitorId]) return res.status(404).json({ error: 'conversation not found' });

  data.paidOrders.push({
    visitorId,
    plan: 'standard',
    amount: 'paid',
    paidAt: Date.now()
  });

  // Send full delivery message
  const fullVersion = data.drafts[visitorId] || '完整版文稿内容';
  const reply = '✅ 收款确认成功！🎉\n\n感谢你的信任和支持！以下是完整版文稿：\n\n' +
    '📄 完整版文稿\n\n' +
    fullVersion + '\n\n' +
    '如果你需要修改或调整任何内容，随时告诉我，无限修改免费！🙏';

  data.conversations[visitorId].messages.push({ role: 'assistant', content: reply, ts: Date.now() });
  saveData(data);

  res.json({ ok: true });
});

// Get unpaid orders needing reminders
app.get('/api/unpaid', (req, res) => {
  const data = loadData();
  const paidVisitorIds = new Set(data.paidOrders.map(o => o.visitorId));
  const unpaid = [];

  for (const [vid, conv] of Object.entries(data.conversations)) {
    if (paidVisitorIds.has(vid)) continue;

    const msgs = conv.messages;
    const hasDraft = msgs.some(m =>
      m.role === 'assistant' &&
      (m.content.includes('初稿') || m.content.includes('预览') ||
       m.content.includes('写好了') || m.content.includes('以下是') ||
       m.content.includes('觉得怎么样') || m.content.includes('满意'))
    );

    if (hasDraft) {
      const lastReply = msgs[msgs.length - 1];
      unpaid.push({
        visitorId: vid, name: conv.name,
        needsReminder: true,
        lastActivity: lastReply ? lastReply.ts : 0
      });
    }
  }

  unpaid.sort((a, b) => b.lastActivity - a.lastActivity);
  res.json(unpaid);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
