'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'records.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const PORT = Number(process.env.PORT) || 3000;

const DEFAULT_SETTINGS = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini'
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

let writeQueue = Promise.resolve();

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(
      DATA_FILE,
      JSON.stringify({ version: 1, records: [] }, null, 2),
      'utf8'
    );
    console.log('已创建数据文件:', DATA_FILE);
  }
  try {
    await fs.access(SETTINGS_FILE);
  } catch {
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8');
    console.log('已创建设置文件:', SETTINGS_FILE);
  }
}

async function readSettings() {
  const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(settings) {
  const task = writeQueue.then(async () => {
    const tmp = SETTINGS_FILE + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
    await fs.rename(tmp, SETTINGS_FILE);
  });
  writeQueue = task.catch(() => {});
  return task;
}

function maskKey(key) {
  const value = String(key || '');
  if (!value) return '';
  if (value.length <= 8) return value.slice(0, 2) + '****';
  return value.slice(0, 4) + '****' + value.slice(-4);
}

async function readStore() {
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('数据文件不是合法 JSON: ' + DATA_FILE);
  }
  if (!parsed || !Array.isArray(parsed.records)) {
    throw new Error('数据文件结构损坏: ' + DATA_FILE);
  }
  return parsed;
}

function writeStore(store) {
  const task = writeQueue.then(async () => {
    const tmp = DATA_FILE + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
    await fs.rename(tmp, DATA_FILE);
  });
  writeQueue = task.catch(() => {});
  return task;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 });
  }
}

const EDITABLE = ['status', 'step', 'concept', 'intention', 'teach', 'gaps', 'analogy', 'review', 'confidence'];

function pickEditable(body) {
  const out = {};
  for (const key of EDITABLE) {
    if (Object.prototype.hasOwnProperty.call(body, key)) out[key] = body[key];
  }
  return out;
}

function blankRecord() {
  return {
    status: 'in-progress',
    step: 0,
    concept: '',
    intention: '',
    teach: '',
    gaps: [],
    analogy: '',
    review: '',
    confidence: ''
  };
}

function buildMessages(stage, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const concept = String(input.concept || '').slice(0, 300);
  const intention = String(input.intention || '').slice(0, 1000);
  const teach = String(input.teach || '').slice(0, 4000);
  const gaps = Array.isArray(input.gaps) ? input.gaps.slice(0, 30) : [];
  const analogy = String(input.analogy || '').slice(0, 600);
  const review = String(input.review || '').slice(0, 4000);

  const system = [
    '你是费曼学习法的辅助教练，不是答题机。',
    '你的产出永远是「草稿」和「追问」，供用户自己修改，绝不输出可直接照搬的最终答案。',
    '核心原则：命名不等于理解；如果用户只是在背术语，要指出来。',
    '语气口语、短句、像在跟一个认真思考的朋友说话。用简体中文。',
    '用简洁的条目或短段落，不要长篇大论。'
  ].join('\n');

  let user = '';
  if (stage === 0) {
    user = [
      `学习者在第 1 步「选择概念」：`,
      `概念名称：${concept || '（还没填）'}`,
      `他想搞懂的问题：${intention || '（还没填）'}`,
      ``,
      `请输出三部分：`,
      `1. 一个更好的探究问题：把一个模糊的「了解 XX」改写成一个具体、可验证的问题。`,
      `2. 三个拆解角度：把这个问题切成可以逐一搞清楚的小块。`,
      `3. 一句费曼式提醒：指出只记住概念名字的陷阱。`,
      `如果信息太少，就提出两个关键追问，而不是替他猜。`
    ].join('\n');
  } else if (stage === 1) {
    user = [
      `学习者在第 2 步「尝试教学」：`,
      `概念：${concept || '（未填）'}`,
      `想搞懂的问题：${intention || '（未填）'}`,
      `他自己写的讲解（这是重点）：`,
      `---`,
      teach || '（还没写）',
      `---`,
      ``,
      `请输出三部分：`,
      `1. 讲解草稿：示范如何用六年级学生能听懂的大白话和一个日常类比来讲这个概念。这是给他参考修改的草稿，不是标准答案。`,
      `2. 卡壳预警：指出这段讲解里哪些地方一旦讲给别人听会卡住、含糊或只能举例子不能解释。`,
      `3. 一个追问：用一个问题逼他把最模糊的地方想清楚。`,
      `不要评价他的对错，帮他看得更清楚。`
    ].join('\n');
  } else if (stage === 2) {
    const gapList = gaps.map((g, i) => `${i + 1}. ${g.where || g.text || ''}${g.why ? '（他自述：' + g.why + '）' : ''}`).join('\n');
    user = [
      `学习者在第 3 步「识别缺口」：`,
      `概念：${concept || '（未填）'}`,
      `他写的讲解：`,
      `---`,
      teach || '（空）',
      `---`,
      `他自己已经找到的缺口：`,
      gapList || '（还没填）',
      ``,
      `请输出两部分：`,
      `1. 隐藏缺口：列出 2-4 处他自己没意识到、但其实讲不清的地方。重点找：只用了术语没解释、只有结论没有为什么、换一种问法就不会了。`,
      `2. 一句话点破：用最直白的话指出他可能在哪件事上骗了自己。`,
      `如果他写得确实清楚，就诚实地说找不到明显缺口，不要硬凑。`
    ].join('\n');
  } else if (stage === 3) {
    const gapList = gaps.map((g, i) => `${i + 1}. ${g.where || g.text || ''}${g.why ? '（' + g.why + '）' : ''}`).join('\n');
    user = [
      `学习者在第 4 步「回顾简化」：`,
      `概念：${concept || '（未填）'}`,
      `第一次的讲解：`,
      `---`,
      teach || '（空）',
      `---`,
      `找到的缺口：`,
      gapList || '（无）',
      `他用的类比：${analogy || '（没写）'}`,
      `简化后重讲：`,
      `---`,
      review || '（空）',
      `---`,
      ``,
      `请输出两部分：`,
      `1. 简化草稿：一个更短、更清楚、去掉术语的重讲版本，供他修改。不超过 150 字。`,
      `2. 类比体检：他用的类比贴切吗？在哪里会失效？给出一个更贴切的类比（如果原类比已经很好就说明好在哪）。`,
      `提醒：简化的目的不是好听，是让一个外行真的能懂。`
    ].join('\n');
  } else if (stage === 'test') {
    user = '请只回复四个字：连接正常。';
  } else {
    throw Object.assign(new Error('未知的辅助环节'), { status: 400 });
  }

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

async function callLlm(settings, messages) {
  if (!settings.apiKey) {
    throw Object.assign(new Error('还没有配置 API Key，请先在「AI 设置」里填写'), { status: 400 });
  }
  const baseUrl = String(settings.baseUrl || '').replace(/\/+$/, '');
  const url = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model || 'gpt-4o-mini',
        messages,
        temperature: 0.7,
        max_tokens: 1200
      }),
      signal: AbortSignal.timeout(60000)
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw Object.assign(new Error('AI 服务响应超时，请稍后重试'), { status: 504 });
    }
    throw Object.assign(new Error('无法连接 AI 服务：' + error.message), { status: 502 });
  }

  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('AI 服务返回了无法解析的内容'), { status: 502 });
  }

  if (!response.ok) {
    const detail = data && data.error && data.error.message ? data.error.message : `HTTP ${response.status}`;
    const friendly = response.status === 401 ? 'API Key 无效或已过期'
      : response.status === 429 ? '调用太频繁或额度不足'
      : response.status === 404 ? '接口地址或模型名不对，检查 Base URL 和模型'
      : detail;
    throw Object.assign(new Error(friendly), { status: response.status });
  }

  const text = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  if (!text) throw Object.assign(new Error('AI 没有返回内容'), { status: 502 });
  return String(text).trim();
}

function validateSettings(body) {
  const out = {};
  if (Object.prototype.hasOwnProperty.call(body, 'baseUrl')) {
    const value = String(body.baseUrl || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(value)) throw Object.assign(new Error('Base URL 必须以 http:// 或 https:// 开头'), { status: 400 });
    out.baseUrl = value;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'apiKey')) {
    const value = String(body.apiKey || '').trim();
    if (value) out.apiKey = value;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'model')) {
    const value = String(body.model || '').trim();
    if (!value) throw Object.assign(new Error('模型名不能为空'), { status: 400 });
    out.model = value;
  }
  return out;
}

async function handleApi(req, res, pathname) {
  const parts = pathname.split('/').filter(Boolean);

  if (pathname === '/api/settings' && req.method === 'GET') {
    const settings = await readSettings();
    return sendJson(res, 200, {
      baseUrl: settings.baseUrl,
      model: settings.model,
      keyMasked: maskKey(settings.apiKey),
      configured: Boolean(settings.apiKey)
    });
  }

  if (pathname === '/api/settings' && req.method === 'POST') {
    const body = await readBody(req);
    const patch = validateSettings(body);
    const settings = await readSettings();
    const next = { ...settings, ...patch };
    await writeSettings(next);
    return sendJson(res, 200, {
      baseUrl: next.baseUrl,
      model: next.model,
      keyMasked: maskKey(next.apiKey),
      configured: Boolean(next.apiKey)
    });
  }

  if (pathname === '/api/assist' && req.method === 'POST') {
    const body = await readBody(req);
    const stage = body.stage;
    const messages = buildMessages(stage, body.payload);
    const settings = await readSettings();
    const text = await callLlm(settings, messages);
    return sendJson(res, 200, { text });
  }

  if (pathname === '/api/records' && req.method === 'GET') {
    const store = await readStore();
    const records = [...store.records].sort((a, b) =>
      String(b.updatedAt).localeCompare(String(a.updatedAt))
    );
    return sendJson(res, 200, { records });
  }

  if (pathname === '/api/records' && req.method === 'POST') {
    const body = await readBody(req);
    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...blankRecord(),
      ...pickEditable(body)
    };
    const store = await readStore();
    store.records.push(record);
    await writeStore(store);
    return sendJson(res, 201, { record });
  }

  if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'records') {
    const id = parts[2];
    const store = await readStore();
    const index = store.records.findIndex((item) => item.id === id);
    if (index === -1) {
      return sendJson(res, 404, { error: '记录不存在' });
    }

    if (req.method === 'GET') {
      return sendJson(res, 200, { record: store.records[index] });
    }

    if (req.method === 'PUT') {
      const body = await readBody(req);
      const updated = {
        ...store.records[index],
        ...pickEditable(body),
        updatedAt: new Date().toISOString()
      };
      store.records[index] = updated;
      await writeStore(store);
      return sendJson(res, 200, { record: updated });
    }

    if (req.method === 'DELETE') {
      store.records.splice(index, 1);
      await writeStore(store);
      return sendJson(res, 200, { ok: true });
    }
  }

  return sendJson(res, 404, { error: '未找到该接口' });
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? '/index.html' : pathname;
  let decoded;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }

  const filePath = path.join(PUBLIC_DIR, decoded);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('页面不存在');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
    } else {
      await serveStatic(req, res, pathname);
    }
  } catch (error) {
    console.error('请求处理失败:', error);
    if (!res.headersSent) {
      const status = error.status || 500;
      sendJson(res, status, { error: error.message || '服务器内部错误' });
    } else {
      res.end();
    }
  }
});

ensureStore()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`费曼学习室已启动: http://localhost:${PORT}`);
      console.log(`数据文件: ${DATA_FILE}`);
    });
  })
  .catch((error) => {
    console.error('启动失败:', error);
    process.exit(1);
  });
