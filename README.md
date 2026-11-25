# 费曼学习室 · Feynman Learning Room

以教为学的四步学习台：选择概念 → 尝试教学 → 识别缺口 → 回顾简化。
可选接入任意 OpenAI 兼容接口（百炼 / DeepSeek / Kimi / OpenAI…）作为「辅助教练」，AI 只出草稿和追问，最终答案由自己改。

## 两种运行方式

### 1. 线上版（GitHub Pages，纯静态）

- 打开 Pages 地址即可使用，零安装。
- 学习记录与 AI 设置存在浏览器 localStorage（同一浏览器同一设备可见）。
- AI 辅助由浏览器直连服务商，**百炼 / DeepSeek / Kimi 支持跨域直连**；OpenAI 官方接口不允许跨域，线上不可用（本地可以）。

### 2. 本地版（Node 服务，数据落文件）

```bash
node server.js          # http://localhost:3000
```

- 记录写 `data/records.json`，设置（含 API Key）写 `data/settings.json`，都不会上传。
- 前端检测到有后端时自动走后端；没有后端时自动切浏览器本地模式（`public/api-shim.js`）。

## 结构

```
server.js            本地 Node 服务：静态文件 + /api/records、/api/settings、/api/assist
public/index.html    页面
public/app.js        前端逻辑（四步流程、费曼检查器、记录库、AI 设置）
public/styles.css    样式
public/api-shim.js   静态部署适配层：无后端时接管 /api/*（localStorage + 浏览器直连 AI）
.github/workflows/pages.yml  推送 main 自动发布到 GitHub Pages
```

## 说明

- 演示后想清空数据：浏览器控制台执行 `localStorage.removeItem('feynman.records.v1')`。
- AI Key 只存在你自己的浏览器 / 本地文件里，仓库里没有任何密钥。
