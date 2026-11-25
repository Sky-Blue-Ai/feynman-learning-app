'use strict';

/*
 * 静态部署适配层（GitHub Pages 用）
 *
 * 作用：拦截前端对 /api/* 的请求。
 *   1) 优先打真实后端（本地 `node server.js` 时存在）；
 *   2) 后端不在（GitHub Pages 纯静态）时，自动切到浏览器本地模式：
 *      - 学习记录 / 设置存 localStorage
 *      - AI 辅助由浏览器直连服务商（百炼 / DeepSeek / Kimi 支持跨域）
 *
 * 前端 app.js 完全不感知这里，仓库里一份代码，本地和线上都能跑。
 */
(function () {
  const RECORDS_KEY = 'feynman.records.v1';
  const SETTINGS_KEY = 'feynman.settings.v1';

  const DEFAULT_SETTINGS = {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini'
  };

  const EDITABLE = ['status', 'step', 'concept', 'intention', 'teach', 'gaps', 'analogy', 'review', 'confidence'];
  const realFetch = window.fetch.bind(window);
  let backendAvailable = null; // null = 未知，true / false = 已判定

  /* ---------- 本地存储 ---------- */

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      throw Object.assign(new Error('浏览器本地存储写入失败（可能已满或被浏览器限制）'), { status: 507 });
    }
  }

  function readStore() {
    const store = readJson(RECORDS_KEY, { version: 1, records: [] });
    if (!Array.isArray(store.records)) store.records = [];
    return store;
  }

  function readSettings() {
    return { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_KEY, {}) };
  }

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function maskKey(key) {
    const value = String(key || '');
    if (!value) return '';
    if (value.length <= 8) return value.slice(0, 2) + '****';
    return value.slice(0, 4) + '****' + value.slice(-4);
  }

  function jsonResponse(payload, status) {
    return new Response(JSON.stringify(payload), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  function fail(message, status) {
    return jsonResponse({ error: message }, status || 400);
  }

  function pickEditable(body) {
    const out = {};
    EDITABLE.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(body, key)) out[key] = body[key];
    });
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

  /* ---------- AI 提示词（与 server.js 保持一致） ---------- */

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
        '学习者在第 1 步「选择概念」：',
        '概念名称：' + (concept || '（还没填）'),
        '他想搞懂的问题：' + (intention || '（还没填）'),
        '',
        '请输出三部分：',
        '1. 一个更好的探究问题：把一个模糊的「了解 XX」改写成一个具体、可验证的问题。',
        '2. 三个拆解角度：把这个问题切成可以逐一搞清楚的小块。',
        '3. 一句费曼式提醒：指出只记住概念名字的陷阱。',
        '如果信息太少，就提出两个关键追问，而不是替他猜。'
      ].join('\n');
    } else if (stage === 1) {
      user = [
        '学习者在第 2 步「尝试教学」：',
        '概念：' + (concept || '（未填）'),
        '想搞懂的问题：' + (intention || '（未填）'),
        '他自己写的讲解（这是重点）：',
        '---',
        teach || '（还没写）',
        '---',
        '',
        '请输出三部分：',
        '1. 讲解草稿：示范如何用六年级学生能听懂的大白话和一个日常类比来讲这个概念。这是给他参考修改的草稿，不是标准答案。',
        '2. 卡壳预警：指出这段讲解里哪些地方一旦讲给别人听会卡住、含糊或只能举例子不能解释。',
        '3. 一个追问：用一个问题逼他把最模糊的地方想清楚。',
        '不要评价他的对错，帮他看得更清楚。'
      ].join('\n');
    } else if (stage === 2) {
      const gapList = gaps.map((g, i) => (i + 1) + '. ' + (g.where || g.text || '') + (g.why ? '（他自述：' + g.why + '）' : '')).join('\n');
      user = [
        '学习者在第 3 步「识别缺口」：',
        '概念：' + (concept || '（未填）'),
        '他写的讲解：',
        '---',
        teach || '（空）',
        '---',
        '他自己已经找到的缺口：',
        gapList || '（还没填）',
        '',
        '请输出两部分：',
        '1. 隐藏缺口：列出 2-4 处他自己没意识到、但其实讲不清的地方。重点找：只用了术语没解释、只有结论没有为什么、换一种问法就不会了。',
        '2. 一句话点破：用最直白的话指出他可能在哪件事上骗了自己。',
        '如果他写得确实清楚，就诚实地说找不到明显缺口，不要硬凑。'
      ].join('\n');
    } else if (stage === 3) {
      const gapList = gaps.map((g, i) => (i + 1) + '. ' + (g.where || g.text || '') + (g.why ? '（' + g.why + '）' : '')).join('\n');
      user = [
        '学习者在第 4 步「回顾简化」：',
        '概念：' + (concept || '（未填）'),
        '第一次的讲解：',
        '---',
        teach || '（空）',
        '---',
        '找到的缺口：',
        gapList || '（无）',
        '他用的类比：' + (analogy || '（没写）'),
        '简化后重讲：',
        '---',
        review || '（空）',
        '---',
        '',
        '请输出两部分：',
        '1. 简化草稿：一个更短、更清楚、去掉术语的重讲版本，供他修改。不超过 150 字。',
        '2. 类比体检：他用的类比贴切吗？在哪里会失效？给出一个更贴切的类比（如果原类比已经很好就说明好在哪）。',
        '提醒：简化的目的不是好听，是让一个外行真的能懂。'
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
    const url = baseUrl.endsWith('/chat/completions') ? baseUrl : baseUrl + '/chat/completions';

    let response;
    try {
      response = await realFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + settings.apiKey
        },
        body: JSON.stringify({
          model: settings.model || 'gpt-4o-mini',
          messages,
          temperature: 0.7,
          max_tokens: 1200
        }),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined
      });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw Object.assign(new Error('AI 服务响应超时，请稍后重试'), { status: 504 });
      }
      throw Object.assign(new Error(
        '浏览器直连 AI 服务失败（大概率是跨域被拦）。百炼 / DeepSeek / Kimi 支持网页直连；' +
        'OpenAI 官方接口不允许跨域，本地 `node server.js` 跑是走服务器代理，线上需要换一个支持跨域的服务商。'
      ), { status: 502 });
    }

    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw Object.assign(new Error('AI 服务返回了无法解析的内容'), { status: 502 });
    }

    if (!response.ok) {
      const detail = data && data.error && data.error.message ? data.error.message : 'HTTP ' + response.status;
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

  /* ---------- 本地路由（与 server.js 的 /api 行为对齐） ---------- */

  async function handleLocal(method, pathname, body) {
    if (pathname === '/api/settings' && method === 'GET') {
      const settings = readSettings();
      return jsonResponse({
        baseUrl: settings.baseUrl,
        model: settings.model,
        keyMasked: maskKey(settings.apiKey),
        configured: Boolean(settings.apiKey)
      });
    }

    if (pathname === '/api/settings' && method === 'POST') {
      const settings = readSettings();
      const next = { ...settings };
      if (Object.prototype.hasOwnProperty.call(body, 'baseUrl')) {
        const value = String(body.baseUrl || '').trim().replace(/\/+$/, '');
        if (!/^https?:\/\//i.test(value)) return fail('Base URL 必须以 http:// 或 https:// 开头');
        next.baseUrl = value;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'apiKey')) {
        const value = String(body.apiKey || '').trim();
        if (value) next.apiKey = value;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'model')) {
        const value = String(body.model || '').trim();
        if (!value) return fail('模型名不能为空');
        next.model = value;
      }
      writeJson(SETTINGS_KEY, next);
      return jsonResponse({
        baseUrl: next.baseUrl,
        model: next.model,
        keyMasked: maskKey(next.apiKey),
        configured: Boolean(next.apiKey)
      });
    }

    if (pathname === '/api/assist' && method === 'POST') {
      const messages = buildMessages(body.stage, body.payload);
      const text = await callLlm(readSettings(), messages);
      return jsonResponse({ text });
    }

    if (pathname === '/api/records' && method === 'GET') {
      const store = readStore();
      const records = [...store.records].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return jsonResponse({ records });
    }

    if (pathname === '/api/records' && method === 'POST') {
      const now = new Date().toISOString();
      const record = { id: newId(), createdAt: now, updatedAt: now, ...blankRecord(), ...pickEditable(body) };
      const store = readStore();
      store.records.push(record);
      writeJson(RECORDS_KEY, store);
      return jsonResponse({ record }, 201);
    }

    const match = pathname.match(/^\/api\/records\/([^/]+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const store = readStore();
      const index = store.records.findIndex((item) => item.id === id);
      if (index === -1) return fail('记录不存在', 404);

      if (method === 'GET') return jsonResponse({ record: store.records[index] });

      if (method === 'PUT') {
        const updated = { ...store.records[index], ...pickEditable(body), updatedAt: new Date().toISOString() };
        store.records[index] = updated;
        writeJson(RECORDS_KEY, store);
        return jsonResponse({ record: updated });
      }

      if (method === 'DELETE') {
        store.records.splice(index, 1);
        writeJson(RECORDS_KEY, store);
        return jsonResponse({ ok: true });
      }
    }

    return fail('未找到该接口', 404);
  }

  /* ---------- fetch 拦截 ---------- */

  function parseBody(init) {
    if (!init || init.body === undefined || init.body === null) return {};
    if (typeof init.body !== 'string') return {};
    try {
      return JSON.parse(init.body);
    } catch {
      return {};
    }
  }

  window.fetch = async function (input, init) {
    const rawUrl = typeof input === 'string' ? input : (input && input.url) || '';
    let pathname = '';
    try {
      pathname = new URL(rawUrl, window.location.href).pathname;
    } catch {
      return realFetch(input, init);
    }

    if (!pathname.startsWith('/api/')) return realFetch(input, init);

    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();

    if (backendAvailable !== false) {
      try {
        const response = await realFetch(input, init);
        const type = response.headers.get('content-type') || '';
        if (type.indexOf('application/json') !== -1) {
          backendAvailable = true;
          return response;
        }
        // 返回 HTML（GitHub Pages 的 404 页）说明没有后端，转本地模式
        backendAvailable = false;
      } catch {
        backendAvailable = false;
      }
    }

    try {
      return await handleLocal(method, pathname, parseBody(init));
    } catch (error) {
      return fail(error.message || '本地请求失败', error.status || 500);
    }
  };
})();