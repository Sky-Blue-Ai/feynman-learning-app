'use strict';

const STEPS = [
  {
    title: '选择概念',
    en: 'Pick a concept',
    color: '#378add',
    tint: '#e6f1fb',
    lead: '别只写下一个名字。名字不等于理解——写下你到底想搞清楚它的什么。',
    tipTitle: '命名 ≠ 理解',
    tipBody: '知道一只鸟在所有语言里的名字，你对这只鸟仍然一无所知。先写下名字，再写下你真正好奇的那个问题。'
  },
  {
    title: '尝试教学',
    en: 'Teach it',
    color: '#1d9e75',
    tint: '#e1f5ee',
    lead: '假装你在给一个六年级学生讲。只能用大白话。哪里讲不下去，就原样记下来，别修饰。',
    tipTitle: '讲不出来 = 没真懂',
    tipBody: '如果你不能把一件事简单解释给别人听，说明你自己还没搞清楚。术语不是理解，是遮羞布。'
  },
  {
    title: '识别缺口',
    en: 'Find the gaps',
    color: '#ba7517',
    tint: '#faeeda',
    lead: '回头看你刚才写的：哪里开始含糊？哪里你偷偷塞了个术语蒙混过关？诚实地列出来。',
    tipTitle: '别骗自己',
    tipBody: '第一原则是你最容易骗的就是自己。讲不清、卡住、只能举例不能解释的地方，就是缺口。找到它们不是失败，是这一步的目的。'
  },
  {
    title: '回顾简化',
    en: 'Review & simplify',
    color: '#d85a30',
    tint: '#faece7',
    lead: '回去补上那些缺口，然后删掉所有行话，用一个类比重新讲一遍。对比第一次的版本——真的变清楚了吗？',
    tipTitle: '把看不见的变成看得见的',
    tipBody: '好解释往往来自一个日常类比。但也要检查：这个类比在哪里会失效？类比不是答案，是脚手架。'
  }
];

const state = {
  records: [],
  current: null,
  step: 0,
  detailId: null,
  detailTab: 0,
  saveTimer: null,
  toastTimer: null,
  savedTimer: null,
  settings: null,
  aiDraft: null
};

const PRESETS = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: '阿里百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', bailian: true },
  { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { name: '自定义', baseUrl: '', model: '' }
];

const BAILIAN_MODELS = [
  'qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-flash', 'qwen3.8-max', 'qwen4-max',
  'deepseek-v4.1-flash', 'deepseek-v4.1-flash-1017', 'deepseek-v3'
];

const BAILIAN_GENERIC = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

const $ = (selector) => document.querySelector(selector);
const stepperEl = $('#stepper');
const stepContentEl = $('#step-content');
const prevBtn = $('#prev-btn');
const nextBtn = $('#next-btn');
const saveHint = $('#save-hint');
const historyList = $('#history-list');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function blankLocal() {
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

async function api(method, url, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function flashSaved() {
  saveHint.textContent = '已自动保存到本地';
  clearTimeout(state.savedTimer);
  state.savedTimer = setTimeout(() => { saveHint.textContent = ''; }, 2200);
}

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => { persist(); }, 600);
}

async function persist() {
  if (!state.current) return;
  try {
    let record;
    if (!state.current.id) {
      const result = await api('POST', '/api/records', state.current);
      record = result.record;
      state.records.unshift(record);
      localStorage.setItem('feynman-draft-id', record.id);
    } else {
      const result = await api('PUT', `/api/records/${state.current.id}`, state.current);
      record = result.record;
      const index = state.records.findIndex((item) => item.id === record.id);
      if (index >= 0) state.records[index] = record;
      else state.records.unshift(record);
    }
    state.current = record;
    localStorage.setItem('feynman-draft-step', String(state.step));
    updateCounts();
    flashSaved();
  } catch (error) {
    saveHint.textContent = '保存失败';
    toast('保存失败：' + error.message);
  }
}

function updateField(key, value) {
  if (!state.current) return;
  state.current[key] = value;
  scheduleSave();
}

function teachFeedback(text, concept) {
  const clean = (text || '').trim();
  const length = clean.replace(/\s/g, '').length;
  const result = [];

  if (length === 0) {
    return [['hint', '写点什么吧。哪怕写「我不知道怎么讲」，也比空白诚实。']];
  }

  if (length < 30) {
    result.push(['warn', `只有 ${length} 个字。讲不满几句话，很可能你只是背下了它的名字。`]);
  } else {
    result.push(['good', `已经写了 ${length} 个字。继续往下讲，别急着跳到结论。`]);
  }

  if (concept && clean) {
    const remainder = clean.split(concept).join('').replace(/[\s，。！？、,.!?"'：:；;的了一个是就是就这个那个]/g, '');
    if (remainder.length < 8) {
      result.push(['warn', '你几乎只是在重复概念的名字。拆开它：由什么组成？怎么运作？']);
    }
  }

  const filler = ['本质上', '从某种意义上', '众所周知', '显而易见', '顾名思义', '你可以理解为', '换句话说就是'];
  const found = filler.filter((word) => clean.includes(word));
  if (found.length) {
    result.push(['warn', `删掉这些空话：${found.join('、')}。它们让你以为讲清楚了，其实什么都没说。`]);
  }

  if (/(就像|好比|想象一下|打个比方|类似于|如同)/.test(clean)) {
    result.push(['good', '你在用类比——这正是费曼的做法。记得检查类比在哪里会失效。']);
  }

  if (/[A-Za-z]{4,}/.test(clean)) {
    result.push(['hint', '出现了英文词。六年级学生听得懂吗？换成大白话试试。']);
  }

  return result;
}

function renderFeedback() {
  const box = $('#teach-feedback');
  if (!box || !state.current) return;
  const items = teachFeedback(state.current.teach, state.current.concept);
  box.innerHTML = items.map(([type, text]) =>
    `<div class="feedback-row ${type}"><span class="feedback-icon"></span><span>${escapeHtml(text)}</span></div>`
  ).join('');
}

function renderStepper() {
  stepperEl.innerHTML = STEPS.map((step, index) => {
    const status = index === state.step ? 'is-active' : (index < state.step ? 'is-done' : '');
    const number = index < state.step ? '✓' : String(index + 1).padStart(2, '0');
    return `<button type="button" class="rail-step ${status}" data-step="${index}" style="--step-color:${step.color};--step-tint:${step.tint}">
      <span class="rail-num">${number}</span>
      <span class="rail-text"><strong>${step.title}</strong><small>${step.en}</small></span>
    </button>`;
  }).join('');
}

function gapsHtml(gaps) {
  const list = Array.isArray(gaps) && gaps.length ? gaps : [{ where: '', why: '' }];
  return list.map((gap, index) => `
    <div class="gap-item">
      <div class="gap-num">${index + 1}</div>
      <div class="gap-fields">
        <input class="input" data-gap="where" data-index="${index}" placeholder="哪里卡住了？" value="${escapeHtml(stripMarkdown(gap.where))}">
        <input class="input" data-gap="why" data-index="${index}" placeholder="我当时是怎么含糊过去的？" value="${escapeHtml(stripMarkdown(gap.why))}">
      </div>
      <button class="gap-remove" data-remove="${index}" aria-label="删除这一项">×</button>
    </div>
  `).join('');
}

const AI_LABELS = [
  { btn: '帮我把问题问准', title: '第 1 步 · 把模糊的好奇变成好问题', hint: '草稿给你参考，改成你自己的问题' },
  { btn: '给我讲法参考', title: '第 2 步 · 一个可参考的讲法草稿', hint: '别照抄。用你自己的话讲一遍才算数' },
  { btn: '帮我找隐藏缺口', title: '第 3 步 · 你可能没发现的缺口', hint: 'AI 也未必对，只当第二双眼睛' },
  { btn: '帮我简化重讲', title: '第 4 步 · 更短更清楚的参考版', hint: '删掉不属于你的话，再讲一遍' }
];

function inlineMarkup(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

// 缺口条目是纯文本字段，去掉模型带出来的 Markdown 标记
function stripMarkdown(text) {
  return String(text || '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^\s*>\s*/, '')
    .replace(/^\s*(?:[-*•]|\d+[.)、])\s+/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

// 把 AI 草稿的轻量 Markdown 转成干净纯文本，再放进可编辑框。
// 保留段落和列表结构，但去掉 * / ** / # / > / 反引号等标记符号。
function draftToPlainText(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = lines.map((raw) => {
    let line = raw.trim();
    if (!line) return '';
    line = line.replace(/^#{1,6}\s*/, '');
    line = line.replace(/^(?:>\s*)+/, '');
    line = line.replace(/^\s*(?:[-*•]|\d+[.)、])\s+/, '· ');
    line = line.replace(/\*\*(.+?)\*\*/g, '$1');
    line = line.replace(/(^|[^*])\*([^*\n]+)\*([^*]|$)/g, '$1$2$3');
    line = line.replace(/\*{1,2}/g, '');
    line = line.replace(/`([^`]+)`/g, '$1');
    return line.trim();
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// textarea 随内容自动撑高，避免长草稿挤在滚动条里
function autoResizeTextarea(element) {
  if (!element || element.tagName !== 'TEXTAREA') return;
  element.style.height = 'auto';
  element.style.height = Math.max(element.scrollHeight, 96) + 'px';
}

// 把模型返回的轻量 Markdown 拆成卡片块：标题 / 正文 / 引用类比 / 清单
// 不依赖第三方库，先转义再组装，避免模型输出注入页面。
function draftBlocks(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let para = [], quote = [], list = [];

  const flushPara = () => {
    if (para.length) blocks.push({ type: 'text', text: para.join(' ') });
    para = [];
  };
  const flushQuote = () => {
    if (quote.length) blocks.push({ type: 'quote', text: quote.join('\n') });
    quote = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: 'list', items: [...list] });
    list = [];
  };
  const flushAll = () => { flushPara(); flushQuote(); flushList(); };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushAll(); continue; }

    const heading = line.match(/^#{1,6}\s*(.+)$/);
    if (heading) {
      flushAll();
      blocks.push({ type: 'title', text: heading[1] });
      continue;
    }

    const quoted = line.match(/^(?:>\s*)+(.*)$/);
    if (quoted) {
      flushPara(); flushList();
      quote.push(quoted[1]);
      continue;
    }
    flushQuote();

    const item = line.match(/^(?:[-*•]|\d+[.)、])\s+(.+)$/);
    if (item) {
      flushPara();
      list.push(item[1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushAll();
  return blocks;
}

function draftCardsHtml(text) {
  const blocks = draftBlocks(text);
  if (!blocks.length) return '<p class="draft-empty">草稿是空的</p>';

  return blocks.map((block) => {
    if (block.type === 'title') {
      return `<h4 class="draft-title">${inlineMarkup(block.text)}</h4>`;
    }
    if (block.type === 'quote') {
      const lines = block.text.split('\n').map((line) => inlineMarkup(line)).join('<br>');
      return `<blockquote class="draft-quote">${lines}</blockquote>`;
    }
    if (block.type === 'list') {
      return `<ul class="draft-list">${block.items.map((item) => `<li>${inlineMarkup(item)}</li>`).join('')}</ul>`;
    }
    return `<p class="draft-p">${inlineMarkup(block.text)}</p>`;
  }).join('');
}

function aiAssistHtml(stepIndex, record) {
  const label = AI_LABELS[stepIndex];
  const hasDraft = Boolean(state.aiDraft && state.aiDraft.step === stepIndex);
  const draftValue = hasDraft ? state.aiDraft.text : '';
  return `
    <div class="assist-panel">
      <div class="assist-head">
        <div class="assist-title">
          <span class="assist-eyebrow">AI 辅助 · 草稿仅供参考</span>
          <strong>${label.title}</strong>
          <span>${label.hint}</span>
        </div>
        <button class="ai-btn" id="ai-generate">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"></path></svg>
          ${label.btn}
        </button>
      </div>
      <div class="assist-body ${hasDraft ? '' : 'hidden'}" id="ai-draft-wrap">
        <div class="assist-meta">
          <span>参考稿 · 请改后使用</span>
          <span>${hasDraft ? escapeHtml(state.aiDraft.model || '') : ''}</span>
        </div>
        <div class="draft-sheet" id="ai-draft-cards">${hasDraft ? draftCardsHtml(draftValue) : ''}</div>
        <div class="assist-editor hidden" id="ai-draft-editor">
          <textarea class="ai-draft" id="ai-draft" rows="12" placeholder="AI 草稿会显示在这里……">${escapeHtml(draftValue)}</textarea>
        </div>
        <div class="assist-actions">
          <button class="btn btn-primary" id="ai-apply">采纳到本步</button>
          <button class="btn-text" id="ai-retry">重新生成</button>
          <button class="btn-text" id="ai-edit-toggle">修改原文</button>
          <span class="assist-hint">改完再采纳，别直接照搬</span>
        </div>
      </div>
    </div>`;
}

function buildPayload() {
  const record = state.current || blankLocal();
  return {
    concept: record.concept,
    intention: record.intention,
    teach: record.teach,
    gaps: record.gaps,
    analogy: record.analogy,
    review: record.review
  };
}

function applyAiDraft() {
  const textarea = document.getElementById('ai-draft');
  if (!textarea || !state.aiDraft) return;
  const value = textarea.value.trim();
  if (!value) { toast('草稿是空的，没什么可采纳'); return; }
  const stepIndex = state.aiDraft.step;
  const record = state.current;

  const plain = draftToPlainText(value);
  if (stepIndex === 0) {
    record.intention = plain;
  } else if (stepIndex === 1) {
    record.teach = plain;
  } else if (stepIndex === 2) {
    // 章节标题（##）不是缺口，只取正文、引用和清单条目
    const lines = [];
    draftBlocks(value).forEach((block) => {
      if (block.type === 'title') return;
      if (block.type === 'list') {
        block.items.forEach((item) => lines.push(stripMarkdown(item)));
      } else {
        block.text.split('\n').forEach((line) => lines.push(stripMarkdown(line)));
      }
    });
    const clean = lines.filter(Boolean);
    record.gaps = clean.length
      ? clean.map((line) => ({ where: line.slice(0, 160), why: '' }))
      : [{ where: stripMarkdown(value).slice(0, 160), why: '' }];
  } else {
    record.review = plain;
  }

  state.aiDraft = null;
  scheduleSave();
  renderStep();
  toast('已采纳，记得用自己的话再过一遍');
}

async function requestAi(stepIndex) {
  const button = document.getElementById('ai-generate');
  if (!button) return;

  const settings = state.settings || {};
  if (!settings.configured) {
    toast('先点右上角「AI 设置」填写 API Key');
    openSettings();
    return;
  }

  button.disabled = true;
  const originalLabel = button.innerHTML;
  button.innerHTML = '<span class="ai-spinner"></span> 正在生成草稿…';

  try {
    const result = await api('POST', '/api/assist', { stage: stepIndex, payload: buildPayload() });
    state.aiDraft = { step: stepIndex, text: result.text, model: settings.model };
    renderStep();
    document.getElementById('ai-draft-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    button.disabled = false;
    button.innerHTML = originalLabel;
    toast('生成失败：' + error.message);
  }
}

function bindAiEvents() {
  const generate = document.getElementById('ai-generate');
  if (generate) generate.addEventListener('click', () => requestAi(state.step));

  const retry = document.getElementById('ai-retry');
  if (retry) retry.addEventListener('click', () => requestAi(state.step));

  const apply = document.getElementById('ai-apply');
  if (apply) apply.addEventListener('click', applyAiDraft);

  const editToggle = document.getElementById('ai-edit-toggle');
  if (editToggle) editToggle.addEventListener('click', () => {
    const cards = document.getElementById('ai-draft-cards');
    const editor = document.getElementById('ai-draft-editor');
    if (!cards || !editor) return;
    const editing = editor.classList.toggle('hidden') === false;
    cards.classList.toggle('hidden', editing);
    editToggle.textContent = editing ? '看卡片' : '修改原文';
    if (editing) {
      document.getElementById('ai-draft')?.focus();
    } else {
      // 编辑过原文后切回卡片视图，卡片要跟着更新
      const textarea = document.getElementById('ai-draft');
      if (textarea) cards.innerHTML = draftCardsHtml(textarea.value);
    }
  });
}

function renderStep() {
  const step = STEPS[state.step];
  const record = state.current || blankLocal();
  stepContentEl.style.setProperty('--step-color', step.color);
  stepContentEl.style.setProperty('--step-tint', step.tint);

  let body = '';

  if (state.step === 0) {
    body = `
      <div class="field">
        <label class="field-label" for="f-concept">我要搞懂的概念</label>
        <input id="f-concept" class="input input-lg" placeholder="例如：熵、复利、认知失调…" value="${escapeHtml(record.concept)}">
        <span class="field-hint">先写下名字，下一步才是重头戏</span>
      </div>
      <div class="field">
        <label class="field-label" for="f-intention">我真正想知道的是</label>
        <textarea id="f-intention" class="input" rows="4" placeholder="别写「什么是熵」，写「为什么房间会自己变乱，而且很难收拾回来」">${escapeHtml(draftToPlainText(record.intention))}</textarea>
      </div>`;
  } else if (state.step === 1) {
    body = `
      <div class="field">
        <label class="field-label" for="f-teach">用六年级学生能听懂的话讲一遍</label>
        <textarea id="f-teach" class="input" rows="9" placeholder="想象你面前坐着一个六年级学生，从他已知的东西讲起……">${escapeHtml(draftToPlainText(record.teach))}</textarea>
        <span class="field-hint">卡住的地方先照实写下来，不用修饰</span>
      </div>
      <div class="feedback-box">
        <div class="feedback-head">费曼检查器 · 边写边看</div>
        <div id="teach-feedback"></div>
      </div>`;
  } else if (state.step === 2) {
    body = `
      <div class="field">
        <span class="field-label">我讲不清 / 含糊过去的地方</span>
        <div id="gap-list">${gapsHtml(record.gaps)}</div>
        <button class="add-gap" id="add-gap">+ 再加一个缺口</button>
        <span class="field-hint">诚实一点。找到缺口是这一步的收获，不是失败</span>
      </div>`;
  } else {
    const confidence = record.confidence;
    body = `
      <div class="field">
        <label class="field-label" for="f-analogy">我用的类比</label>
        <input id="f-analogy" class="input" placeholder="例如：熵就像一个越来越乱的房间……" value="${escapeHtml(draftToPlainText(record.analogy).replace(/\n/g, ' '))}">
      </div>
      <div class="field">
        <label class="field-label" for="f-review">简化后，再讲一遍</label>
        <textarea id="f-review" class="input" rows="7" placeholder="删掉术语，用上面的类比重新讲一遍。和第一次比，清楚了吗？">${escapeHtml(draftToPlainText(record.review))}</textarea>
      </div>
      <div class="field">
        <span class="field-label">补完之后，你觉得自己……</span>
        <div class="choice-row">
          <button class="choice ${confidence === '清楚多了' ? 'is-selected' : ''}" data-confidence="清楚多了">清楚多了</button>
          <button class="choice ${confidence === '还差一点' ? 'is-selected' : ''}" data-confidence="还差一点">还差一点</button>
          <button class="choice ${confidence === '还是不懂' ? 'is-selected' : ''}" data-confidence="还是不懂">还是不懂</button>
        </div>
      </div>`;
  }

  stepContentEl.innerHTML = `
    <div class="stage-head">
      <div class="stage-kicker">STEP ${String(state.step + 1).padStart(2, '0')} / ${step.en}</div>
      <h2>${step.title}</h2>
      <p class="stage-lead">${step.lead}</p>
    </div>
    <div class="stage-body">${body}</div>
    ${aiAssistHtml(state.step, record)}
    <div class="stage-note">
      <strong>${step.tipTitle}</strong>
      <p>${step.tipBody}</p>
    </div>`;

  prevBtn.disabled = state.step === 0;
  nextBtn.textContent = state.step === 3 ? '完成这一轮' : '下一步 →';
  bindStepEvents();
  bindAiEvents();
  document.querySelectorAll('.stage-body textarea.input').forEach(autoResizeTextarea);
}

function bindStepEvents() {
  const fields = [
    ['f-concept', 'concept'],
    ['f-intention', 'intention'],
    ['f-teach', 'teach'],
    ['f-analogy', 'analogy'],
    ['f-review', 'review']
  ];

  fields.forEach(([id, key]) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.addEventListener('input', () => {
      updateField(key, element.value);
      autoResizeTextarea(element);
      if (key === 'teach') renderFeedback();
    });
  });

  document.querySelectorAll('[data-gap]').forEach((element) => {
    element.addEventListener('input', () => {
      const index = Number(element.dataset.index);
      const key = element.dataset.gap;
      if (!Array.isArray(state.current.gaps)) state.current.gaps = [];
      if (!state.current.gaps[index]) state.current.gaps[index] = { where: '', why: '' };
      state.current.gaps[index][key] = element.value;
      scheduleSave();
    });
  });

  document.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      state.current.gaps.splice(Number(button.dataset.remove), 1);
      if (!state.current.gaps.length) state.current.gaps = [{ where: '', why: '' }];
      renderStep();
      scheduleSave();
    });
  });

  const addButton = $('#add-gap');
  if (addButton) {
    addButton.addEventListener('click', () => {
      if (!Array.isArray(state.current.gaps)) state.current.gaps = [];
      state.current.gaps.push({ where: '', why: '' });
      renderStep();
      const inputs = document.querySelectorAll('[data-gap="where"]');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });
  }

  document.querySelectorAll('[data-confidence]').forEach((button) => {
    button.addEventListener('click', () => {
      state.current.confidence = button.dataset.confidence;
      document.querySelectorAll('[data-confidence]').forEach((item) => {
        item.classList.toggle('is-selected', item === button);
      });
      scheduleSave();
    });
  });

  renderFeedback();
}

function goStep(next) {
  if (next < 0 || next > 3) return;
  state.step = next;
  if (state.current) {
    state.current.step = next;
    localStorage.setItem('feynman-draft-step', String(next));
    scheduleSave();
  }
  renderStepper();
  renderStep();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function finishRound() {
  state.current.status = 'completed';
  state.current.step = 3;
  await persist();
  toast('完成！理解是循环的，随时可以再讲一遍');
  localStorage.removeItem('feynman-draft-id');
  localStorage.removeItem('feynman-draft-step');
  state.current = blankLocal();
  state.step = 0;
  render();
  switchTab('history');
}

function formatTime(iso) {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return `今天 ${time}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

function updateCounts() {
  $('#record-count').textContent = String(state.records.length);
}

function renderHistory() {
  if (!state.records.length) {
    historyList.innerHTML = `
      <div class="empty-state">
        <strong>还没有记录</strong>
        <p>去学习台选一个概念，开始你的第一轮吧</p>
      </div>`;
    return;
  }

  historyList.innerHTML = state.records.map((record) => {
    const done = record.status === 'completed';
    const excerpt = (record.intention || record.teach || record.review || '').trim() || '（还没有写下内容）';
    const gaps = Array.isArray(record.gaps)
      ? record.gaps.filter((gap) => gap && (gap.where || gap.why)).length
      : 0;
    return `<article class="record-card" data-id="${record.id}">
      <div class="record-top">
        <span class="status-pill ${done ? 'done' : 'progress'}"><span class="mini-dot"></span>${done ? '已完成' : '进行中'}</span>
        <time class="record-time">${formatTime(record.updatedAt)}</time>
      </div>
      <h3>${escapeHtml(record.concept || '未命名概念')}</h3>
      <p class="record-excerpt">${escapeHtml(excerpt)}</p>
      <div class="record-meta">
        <span>进度 ${Number(record.step || 0) + 1}/4</span>
        <span>缺口 ${gaps} 处</span>
      </div>
    </article>`;
  }).join('');

  document.querySelectorAll('.record-card').forEach((card) => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
}

function detailRichText(value) {
  const text = (value || '').trim();
  if (!text) return '<p class="detail-empty">（未填写）</p>';
  return `<div class="detail-rich">${draftCardsHtml(text)}</div>`;
}

function detailBlock(number, caption, content) {
  const index = number - 1;
  const step = STEPS[index];
  return `<section class="detail-panel" data-detail-panel="${index}" style="--step-color:${step.color};--step-tint:${step.tint}">
    <div class="detail-panel-head">
      <span class="detail-panel-heading">${step.title}</span>
      <span class="detail-label-en">${step.en}</span>
    </div>
    <div class="detail-content">
      <span class="detail-caption">${caption}</span>
      ${content}
    </div>
  </section>`;
}

function detailTabsHtml(record) {
  const filled = [
    !!(record.intention || '').trim(),
    !!(record.teach || '').trim(),
    Array.isArray(record.gaps) && record.gaps.some((gap) => gap && (gap.where || gap.why)),
    !!((record.analogy || '').trim() || (record.review || '').trim())
  ];
  return STEPS.map((step, index) => `
    <button class="detail-tab" data-detail-step="${index}" style="--step-color:${step.color};--step-tint:${step.tint}">
      <span class="detail-tab-num">${String(index + 1).padStart(2, '0')}</span>
      <span class="detail-tab-text"><strong>${step.title}</strong><small>${step.en}</small></span>
      <span class="detail-tab-dot ${filled[index] ? 'is-filled' : ''}" title="${filled[index] ? '已填写' : '未填写'}"></span>
    </button>`).join('');
}

function setDetailTab(index) {
  state.detailTab = index;
  document.querySelectorAll('.detail-tab').forEach((element) => {
    element.classList.toggle('is-active', Number(element.dataset.detailStep) === index);
  });
  document.querySelectorAll('.detail-panel').forEach((element) => {
    element.classList.toggle('is-active', Number(element.dataset.detailPanel) === index);
  });
  const body = $('#detail-body');
  if (body) body.scrollTop = 0;
}

function openDetail(id) {
  const record = state.records.find((item) => item.id === id);
  if (!record) return;
  state.detailId = id;
  const done = record.status === 'completed';
  $('#detail-title').textContent = record.concept || '未命名概念';
  $('#detail-eyebrow').textContent = `学习记录 · ${done ? '已完成' : '进行中'} · ${formatTime(record.updatedAt)}`;

  const gaps = Array.isArray(record.gaps)
    ? record.gaps.filter((gap) => gap && (gap.where || gap.why))
    : [];
  const gapsHtmlText = gaps.length
    ? `<div class="detail-gap-list">${gaps.map((gap, index) => {
        const why = stripMarkdown(gap.why);
        return `<div class="detail-gap">
          <span class="detail-gap-num">${String(index + 1).padStart(2, '0')}</span>
          <div>
            <strong>${escapeHtml(stripMarkdown(gap.where) || '未注明位置')}</strong>
            ${why ? `<p>${escapeHtml(why)}</p>` : ''}
          </div>
        </div>`;
      }).join('')}</div>`
    : '<p class="detail-empty">（未记录缺口）</p>';

  const analogyText = record.analogy && record.analogy.trim()
    ? `<blockquote class="detail-analogy">${escapeHtml(record.analogy.trim())}</blockquote>`
    : '<p class="detail-empty">（未填写）</p>';

  const reviewText = detailRichText(record.review) +
    (record.confidence ? `<div class="detail-confidence"><span>自评</span><strong>${escapeHtml(record.confidence)}</strong></div>` : '');

  $('#detail-body').innerHTML = `
    <div class="detail-layout">
      <nav class="detail-tabs" id="detail-tabs">${detailTabsHtml(record)}</nav>
      <div class="detail-panels">
        ${detailBlock(1, '我真正想知道的是', detailRichText(record.intention))}
        ${detailBlock(2, '我打算这样讲给六年级学生听', detailRichText(record.teach))}
        ${detailBlock(3, '我讲不清、卡住的地方', gapsHtmlText)}
        ${detailBlock(4, '我用的类比与简化后的讲法',
          '<span class="detail-caption">我用的类比</span>' + analogyText +
          '<span class="detail-caption">简化后重讲</span>' + reviewText)}
      </div>
    </div>`;

  setDetailTab(0);
  $('#detail-modal').classList.remove('hidden');
}

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach((element) => {
    element.classList.toggle('is-active', element.dataset.tab === tab);
  });
  document.querySelectorAll('.view').forEach((element) => {
    element.classList.toggle('is-active', element.id === `view-${tab}`);
  });
}

function render() {
  renderStepper();
  renderStep();
  renderHistory();
  updateCounts();
}

function restoreDraft() {
  const draftId = localStorage.getItem('feynman-draft-id');
  const draftStep = Number(localStorage.getItem('feynman-draft-step') || 0);
  if (draftId) {
    const found = state.records.find((item) => item.id === draftId);
    if (found && found.status === 'in-progress') {
      state.current = found;
      state.step = Math.min(Math.max(draftStep, 0), 3);
      return;
    }
  }
  const recent = state.records.find((item) => item.status === 'in-progress');
  if (recent) {
    state.current = recent;
    state.step = Number(recent.step) || 0;
  } else {
    state.current = blankLocal();
    state.step = 0;
  }
}

async function loadRecords() {
  const data = await api('GET', '/api/records');
  state.records = data.records;
  renderHistory();
  updateCounts();
}

nextBtn.addEventListener('click', async () => {
  if (state.step === 0) {
    const concept = (state.current?.concept || '').trim();
    if (!concept) {
      toast('先写下你要搞懂的概念');
      document.getElementById('f-concept')?.focus();
      return;
    }
  }
  if (state.step === 3) {
    await finishRound();
    return;
  }
  goStep(state.step + 1);
});

prevBtn.addEventListener('click', () => goStep(state.step - 1));

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

stepperEl.addEventListener('click', (event) => {
  const target = event.target.closest('[data-step]');
  if (target) goStep(Number(target.dataset.step));
});

$('#new-record-btn').addEventListener('click', () => {
  state.current = blankLocal();
  state.step = 0;
  localStorage.removeItem('feynman-draft-id');
  localStorage.removeItem('feynman-draft-step');
  switchTab('workspace');
  render();
  document.getElementById('f-concept')?.focus();
});

$('#detail-body').addEventListener('click', (event) => {
  const tab = event.target.closest('.detail-tab');
  if (tab) setDetailTab(Number(tab.dataset.detailStep));
});

$('#detail-close').addEventListener('click', () => $('#detail-modal').classList.add('hidden'));
$('#detail-modal').addEventListener('click', (event) => {
  if (event.target === $('#detail-modal')) $('#detail-modal').classList.add('hidden');
});

$('#detail-continue').addEventListener('click', () => {
  const record = state.records.find((item) => item.id === state.detailId);
  if (!record) return;
  state.current = record;
  state.step = Number(record.step) || 0;
  localStorage.setItem('feynman-draft-id', record.id);
  localStorage.setItem('feynman-draft-step', String(state.step));
  $('#detail-modal').classList.add('hidden');
  switchTab('workspace');
  render();
});

$('#detail-delete').addEventListener('click', async () => {
  if (!state.detailId) return;
  if (!confirm('确定删除这条学习记录吗？此操作不可撤销。')) return;
  try {
    await api('DELETE', `/api/records/${state.detailId}`);
    state.records = state.records.filter((item) => item.id !== state.detailId);
    if (state.current?.id === state.detailId) {
      state.current = blankLocal();
      state.step = 0;
    }
    $('#detail-modal').classList.add('hidden');
    render();
    toast('记录已删除');
  } catch (error) {
    toast('删除失败：' + error.message);
  }
});

function renderPresets() {
  const current = $('#setting-baseurl').value.trim().replace(/\/+$/, '');
  $('#preset-row').innerHTML = PRESETS.map((preset) => {
    const active = preset.baseUrl && preset.baseUrl.replace(/\/+$/, '') === current;
    return `<button type="button" class="preset ${active ? 'is-active' : ''}" data-preset="${escapeHtml(preset.name)}">${escapeHtml(preset.name)}</button>`;
  }).join('');

  document.querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      const preset = PRESETS.find((item) => item.name === button.dataset.preset);
      if (!preset || !preset.baseUrl) return;
      $('#setting-baseurl').value = preset.baseUrl;
      $('#setting-model').value = preset.model;
      syncBailianPanel();
      renderPresets();
    });
  });
}

function renderBailingModels() {
  const current = $('#setting-model').value.trim();
  $('#bailing-model-row').innerHTML = BAILIAN_MODELS.map((name) =>
    `<button type="button" class="preset ${name === current ? 'is-active' : ''}" data-bmodel="${name}">${name}</button>`
  ).join('');
  document.querySelectorAll('[data-bmodel]').forEach((button) => {
    button.addEventListener('click', () => {
      $('#setting-model').value = button.dataset.bmodel;
      renderBailingModels();
    });
  });
}

function isBailianUrl(url) {
  return /dashscope|maas\.aliyuncs\.com/i.test(String(url || ''));
}

function applyBailianUrl() {
  const workspaceId = $('#bailing-ws').value.trim();
  const region = $('#bailing-region').value;
  if (workspaceId) {
    $('#setting-baseurl').value = `https://${workspaceId}.${region}.maas.aliyuncs.com/compatible-mode/v1`;
  } else {
    $('#setting-baseurl').value = BAILIAN_GENERIC;
  }
  renderPresets();
  toast(workspaceId ? '已生成百炼专属地址' : '已使用百炼通用地址');
}

function syncBailianPanel() {
  const url = $('#setting-baseurl').value;
  const show = isBailianUrl(url);
  $('#bailing-panel').classList.toggle('hidden', !show);
  $('#bailing-toggle').textContent = show ? '收起' : '通用域名 →';
  if (show) renderBailingModels();
}

function setTestResult(type, message) {
  const box = $('#test-result');
  box.className = `test-result ${type}`;
  box.textContent = message;
}

async function loadSettings() {
  try {
    const data = await api('GET', '/api/settings');
    state.settings = data;
    $('#setting-baseurl').value = data.baseUrl || '';
    $('#setting-model').value = data.model || '';
    $('#setting-key').value = '';
    $('#key-hint').textContent = data.configured
      ? `已保存密钥 ${data.keyMasked}，留空表示不修改`
      : '还没有配置密钥';
    $('#settings-dot').classList.toggle('hidden', !data.configured);
    renderPresets();
    syncBailianPanel();
  } catch (error) {
    toast('读取 AI 设置失败：' + error.message);
  }
}

function openSettings() {
  $('#settings-modal').classList.remove('hidden');
  $('#test-result').classList.add('hidden');
  loadSettings();
}

function closeSettings() {
  $('#settings-modal').classList.add('hidden');
}

async function saveSettings() {
  const body = {
    baseUrl: $('#setting-baseurl').value.trim(),
    model: $('#setting-model').value.trim()
  };
  const key = $('#setting-key').value.trim();
  if (key) body.apiKey = key;

  try {
    const data = await api('POST', '/api/settings', body);
    state.settings = data;
    $('#setting-key').value = '';
    $('#key-hint').textContent = data.configured
      ? `已保存密钥 ${data.keyMasked}，留空表示不修改`
      : '还没有配置密钥';
    $('#settings-dot').classList.toggle('hidden', !data.configured);
    toast('AI 设置已保存到本地');
    return true;
  } catch (error) {
    toast('保存失败：' + error.message);
    return false;
  }
}

async function testSettings() {
  const saved = await saveSettings();
  if (!saved) return;
  setTestResult('loading', '正在测试连接…');
  try {
    await api('POST', '/api/assist', { stage: 'test', payload: {} });
    setTestResult('ok', '连接正常，AI 可以使用了');
  } catch (error) {
    setTestResult('fail', '连接失败：' + error.message);
  }
}

$('#settings-trigger').addEventListener('click', openSettings);
$('#settings-close').addEventListener('click', closeSettings);
$('#settings-modal').addEventListener('click', (event) => {
  if (event.target === $('#settings-modal')) closeSettings();
});
$('#setting-baseurl').addEventListener('input', () => {
  renderPresets();
  syncBailianPanel();
});
$('#bailing-gen').addEventListener('click', applyBailianUrl);
$('#bailing-toggle').addEventListener('click', () => {
  const panel = $('#bailing-panel');
  const isHidden = panel.classList.contains('hidden');
  if (isHidden) {
    panel.classList.remove('hidden');
    $('#bailing-toggle').textContent = '收起';
    $('#setting-baseurl').value = BAILIAN_GENERIC;
    $('#setting-model').value = 'qwen-plus';
    renderPresets();
    renderBailingModels();
  } else {
    panel.classList.add('hidden');
    $('#bailing-toggle').textContent = '通用域名 →';
  }
});
$('#settings-save').addEventListener('click', saveSettings);
$('#settings-test').addEventListener('click', testSettings);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    $('#detail-modal').classList.add('hidden');
    closeSettings();
  }
});

async function init() {
  loadSettings();
  try {
    await loadRecords();
    restoreDraft();
    render();
  } catch (error) {
    toast('加载失败：' + error.message);
    state.current = blankLocal();
    render();
  }
}

init();
