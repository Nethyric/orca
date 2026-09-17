'use strict';
// The agentic loop: streaming, tool calls, approvals (autonomy levels), plan mode,
// checkpoints, model fallback, ask_user pauses, stop.
const os = require('os');
const config = require('./config');
const remote = require('./remote');
const vault = require('./vault');
config.setVaultProbe(() => vault.enabled());

// Expand a logical model config into the concrete upstreams to try, in order.
//   built-in ("orca/<alias>") → live vault upstreams (rotation + cooldown handled by vault.js)
//   anything else            → itself
function expand(cfg) {
  if (!vault.isVaultModel(cfg)) return [cfg];
  const cands = vault.candidates(vault.aliasOf(cfg));
  return cands.map((u) => ({ ...cfg, baseUrl: String(u.url).replace(/\/+$/, ''), apiKey: u.key, model: u.model, maxTokens: Math.min(cfg.maxTokens || 4096, u.maxTokens || 4096), upstream: u, api: u.api || apiKind(u.url), extraHeaders: u.headers || null, poolSize: cands.length }));
}
// OpenAI-compatible everywhere except Anthropic's native Messages API
const apiKind = (url) => (/api\.anthropic\.com/.test(url || '') ? 'anthropic' : 'openai');
function authHeadersFor(cfg) {
  if ((cfg.api || apiKind(cfg.baseUrl)) === 'anthropic') return { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' };
  return { authorization: 'Bearer ' + cfg.apiKey };
}
const tools = require('./tools');
const store = require('./store');
const APP = (() => { try { return require('../../orca.config.json'); } catch (_) { return {}; } })();
const APP_VERSION = 'v' + ((() => { try { return require('../../package.json').version; } catch (_) { return '0.0.0'; } })());
function nowString() {
  const d = new Date();
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) { return ''; } })();
  const off = -d.getTimezoneOffset(); const sign = off >= 0 ? '+' : '-'; const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0'); const mm = String(Math.abs(off) % 60).padStart(2, '0');
  const wd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
  const pad = (n) => String(n).padStart(2, '0');
  return `${wd}, ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} local time (UTC${sign}${hh}:${mm}${tz ? ', ' + tz : ''})`;
}

function memorySnippet() {
  try {
    const f = require('path').join(config.getDataDir(), 'memory.md');
    const txt = require('fs').readFileSync(f, 'utf8').trim();
    if (!txt) return '';
    const lines = txt.split('\n').filter(Boolean).slice(-40).join('\n');
    return `\n\nLONG-TERM MEMORY (notes you saved earlier about this user/projects; use them, keep them updated with remember):\n${lines.slice(0, 4000)}`;
  } catch (_) { return ''; }
}

const STR = {
  fa: { busyWait: (s) => `همهٔ مدل‌ها شلوغ‌اند — ${s} ثانیهٔ دیگر دوباره تلاش می‌شود`, vaultDown: 'مدل‌های داخلی در دسترس نیستند (اتصال به GitHub برقرار نشد). کلید خودتان را در تنظیمات اضافه کنید یا بعداً دوباره امتحان کنید.', thinking: (m, s) => `${m} در حال فکر کردن… (مرحلهٔ ${s})`, fallback: (a, b) => `↩︎ ${a} در دسترس نبود — سوییچ به ${b}`, retry: (e) => `⚠ ${e} — تلاش مجدد`, empty: 'پاسخ خالی بود — درخواست پاسخ نهایی', allFailed: 'همهٔ مدل‌ها ناموفق بودند. آخرین خطا: ', cap: '⚠️ به سقف مراحل رسیدم. اگر بخواهید ادامه می‌دهم — بگویید «ادامه بده».', running: (n) => `اجرای ${n} ابزار به‌صورت موازی…`, noAnswer: '(پاسخ خالی)', compacting: 'گفتگو طولانی شد — فشرده‌سازی خودکار تاریخچه…', continuing: 'ادامهٔ پاسخ…' },
  en: { busyWait: (s) => `All models are busy — retrying in ${s} s`, vaultDown: 'Built-in models unavailable (could not reach GitHub). Add your own key in Settings or try again later.', thinking: (m, s) => `${m} is thinking… (step ${s})`, fallback: (a, b) => `↩︎ ${a} unavailable — switched to ${b}`, retry: (e) => `⚠ ${e} — retrying`, empty: 'Empty answer — requesting final answer', allFailed: 'All models failed. Last error: ', cap: '⚠️ Step limit reached. Say "continue" and I will carry on.', running: (n) => `running ${n} tools in parallel…`, noAnswer: '(empty answer)', compacting: 'Long conversation — auto-compacting history…', continuing: 'continuing…' },
  ru: { busyWait: (s) => `Все модели заняты — повтор через ${s} с`, vaultDown: 'Встроенные модели недоступны (нет связи с GitHub). Добавьте свой ключ в настройках или повторите позже.', thinking: (m, s) => `${m} думает… (шаг ${s})`, fallback: (a, b) => `↩︎ ${a} недоступна — переключение на ${b}`, retry: (e) => `⚠ ${e} — повтор`, empty: 'Пустой ответ — запрашиваю финальный ответ', allFailed: 'Все модели недоступны. Последняя ошибка: ', cap: '⚠️ Достигнут лимит шагов. Напишите «продолжай», и я продолжу.', running: (n) => `выполняю ${n} инструментов параллельно…`, noAnswer: '(пустой ответ)', compacting: 'Долгий диалог — автоматическое сжатие истории…', continuing: 'продолжаю…' },
  zh: { busyWait: (s) => `所有模型都忙 — ${s} 秒后重试`, vaultDown: '内置模型不可用（无法连接 GitHub）。请在设置中添加自己的密钥或稍后重试。', thinking: (m, s) => `${m} 正在思考…（第 ${s} 步）`, fallback: (a, b) => `↩︎ ${a} 不可用 — 已切换到 ${b}`, retry: (e) => `⚠ ${e} — 重试中`, empty: '回答为空 — 请求最终回答', allFailed: '所有模型均失败。最后错误：', cap: '⚠️ 已达到步骤上限。说“继续”我会接着做。', running: (n) => `并行运行 ${n} 个工具…`, noAnswer: '（空回答）', compacting: '对话过长 — 自动压缩历史…', continuing: '继续…' },
};
const L = () => STR[config.load().lang] || STR.en;

// ---- auto router: fast model for light requests, strong model for real work ----
const HEAVY = /(بساز|ایجاد کن|درست کن|پیاده|پروژه|کد|برنامه|اسکریپت|نصب|تحلیل|دیباگ|رفع|باگ|تست|فایل|پوشه|سایت|اپ\b|بازی|الگوریتم|بهینه|ریفکتور|دیتابیس|سرور|بنویس.*(کد|تابع|کلاس)|\bbuild\b|\bcreate\b|\bimplement\b|\bwrite (a |an |the )?(code|script|program|app|function|class|module)|\bfix\b|\bdebug\b|\brefactor\b|\binstall\b|\bdeploy\b|\banaly[sz]e\b|\bproject\b|\btest\b|\bfile\b|\bfolder\b|\bscript\b|\bapi\b|\bdatabase\b|\bwebsite\b|\bgame\b|\balgorithm\b|\boptimi[sz]e\b|\bmigrate\b|```)/i;
function routeAuto({ text = '', history = [], planMode = false, hasFiles = false }) {
  const models = config.allModels().filter((m) => config.resolve(m.key)?.apiKey);
  const live = (m) => !vault.isVaultModel(m) || vault.liveCount(vault.aliasOf(m)) > 0;
  let strong = models.find((m) => m.tier === 'strong') || models[0];
  let fast = models.find((m) => m.tier === 'fast') || strong;
  if (!strong || !fast) return config.load().defaultModel;
  if (!live(fast) && live(strong)) fast = strong; // the fast model is rate-limited right now → the strong one answers faster
  if (!live(strong) && live(fast)) strong = fast;
  if (planMode || hasFiles || text.length > 700 || HEAVY.test(text)) return strong.key;
  // continuing a task where tools were just used → stay strong
  const lastA = [...history].reverse().find((m) => m.role === 'assistant');
  if (lastA && (lastA.events || []).some((e) => e.event === 'tool_call' && !['web_search', 'fetch_page', 'recall'].includes(e.data?.name))) return strong.key;
  return fast.key;
}

// ---- context window management: keep system + recent turns within a char budget ----
function fitContext(msgs, budget = 160000) {
  const sys = msgs[0];
  const rest = msgs.slice(1);
  const size = (m) => (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content || '').length) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
  // group into turns starting at each user message
  const turns = [];
  for (const m of rest) { if (m.role === 'user' || !turns.length) turns.push([m]); else turns[turns.length - 1].push(m); }
  // shrink tool results in older turns first
  const shrink = (turn, max) => turn.map((m) => (m.role === 'tool' && typeof m.content === 'string' && m.content.length > max ? { ...m, content: m.content.slice(0, max) + `…[truncated ${m.content.length - max} chars]` } : m));
  let out = turns.map((t, i) => (i < turns.length - 2 ? shrink(t, 1200) : t));
  let total = size(sys) + out.flat().reduce((a, m) => a + size(m), 0);
  while (total > budget && out.length > 1) { const dropped = out.shift(); total -= dropped.reduce((a, m) => a + size(m), 0); }
  if (total > budget) { // still too big: shrink the current turn's tool results too
    out = out.map((t) => shrink(t, 4000));
  }
  const flat = out.flat();
  return [sys, ...(out.length < turns.length ? [{ role: 'user', content: '[system] Earlier parts of this long conversation were trimmed to fit the context window. Continue from the latest messages.' }] : []), ...flat];
}

function projectMemory() {
  try { const pm = tools.extras.projectMemory(); if (!pm) return ''; return `\n\nPROJECT MEMORY (${pm.file} in the workspace — follow it; update it with edit_file when decisions change):\n${pm.text}`; } catch (_) { return ''; }
}

function systemPrompt(opts = {}) {
  const c = config.load();
  const ws = config.workspaceDir();
  const py = tools.findPython();
  const vision = (() => { try { return tools.extras.visionModel(); } catch (_) { return null; } })();
  const lang = ({ en: 'English', fa: 'Persian (Farsi)', ru: 'Russian', zh: 'Simplified Chinese' })[c.lang] || 'English';
  const persona = (c.persona || '').trim() ? `\n\nABOUT THE USER: ${c.persona.trim().slice(0, 1500)}` : '';
  const rules = (c.rules || '').trim() ? `\n\nUSER RULES (always follow):\n${c.rules.trim().slice(0, 6000)}` : '';
  const notes = (opts.notes || '').trim() ? `\n\nCHAT NOTES (the user's own notes for this conversation — decisions, terminology, constraints; treat as current truth):\n${opts.notes.trim().slice(0, 4000)}` : '';
  const pins = Array.isArray(opts.pinned) && opts.pinned.length ? `\n\nPINNED MESSAGES (the user pinned these earlier in this conversation; they stay binding no matter how long the chat gets):\n${opts.pinned.map((p, i) => `${i + 1}. [${p.role}] ${String(p.text || '').replace(/\s+/g, ' ').trim().slice(0, 700)}`).join('\n').slice(0, 5000)}` : '';
  const web = opts.webMode ? `\n\nWEB MODE IS ON for this message: research first (web_search, then fetch_page the best 1-3 sources), then answer with inline source links. Do not answer from memory alone.` : '';
  const effort = c.reasoningEffort === 'high' ? '\n- Think carefully and thoroughly before acting; double-check edge cases and verify results twice.' : c.reasoningEffort === 'low' ? '\n- Be quick and pragmatic; skip deep deliberation for simple tasks.' : '';
  const plan = opts.planMode ? `

PLAN MODE IS ON: do NOT modify anything. Investigate (read files, search) as needed, then reply with a concise numbered implementation plan (files to create/change, commands to run, risks). End with exactly the phrase "Shall I execute?" translated into the user's language (fa: "اجرا کنم؟", ru: "Выполнить?", zh: "要执行吗？") and wait.` : '';
  const model = opts.modelLabel ? `\nThe language model currently serving you is "${opts.modelLabel}" (built into ORCA; it can change between messages). You are ORCA, not that model — never introduce yourself as it or as a product of its vendor.` : '';
  return `You are ORCA ${APP_VERSION}, an open-source autonomous AI agent made by ${APP.company || 'Nethyric'}, running as a desktop app on the user's computer (${os.platform()} ${os.release()} ${os.arch()}).

IDENTITY (answer these from here, instantly, without tools): maker/company: ${APP.company || 'Nethyric'} · product: ORCA · version: ${APP_VERSION} · source code, releases and updates: ${APP.homepage || 'https://github.com/' + (APP.repo || 'Nethyric/orca')} · bug reports: https://github.com/${APP.repo || 'Nethyric/orca'}/issues · license: MIT · new versions are announced automatically inside the app.${model}
NOW: ${nowString()}. Use this for anything time-related ("today", "this year", deadlines, ages, "latest"); your training data is older than this date, so verify recent facts with web_search.

TOOLS (real, executed on this machine — never fake a result): shell (${process.platform === 'win32' ? 'cmd.exe by default; PowerShell auto-detected' : 'bash'}), run_node (always available), ${py ? 'run_python (' + py + ')' : 'NO Python — use run_node'}, files (read_file/write_file/edit_file/delete_file/list_files/glob/grep) in workspace "${ws}" (shell cwd; relative paths resolve there), diagnostics (syntax check), todo_write/todo_read (visible checklist), task (sub-agents with fresh context, run in parallel), web_search + fetch_page + http_request, VISION: view_image (OCR eng+fas${vision ? ' + vision model ' + vision.model : '; no vision model configured — text-only models, OCR is what you get'}), screenshot (headless Chrome), browser_check (headless Chrome: runtime errors + screenshot of any HTML/URL — use it instead of installing playwright/puppeteer), SOCIAL: social_download (Instagram/TikTok/X/YouTube/… videos, photos, carousels, profiles, playlists → downloads/), social_trending (TikTok explore feed & search, YouTube trending, X trends, Instagram user posts; download=true to fetch), GENERATE: generate_image (text→image, free provider built in), generate_video (text→video; real T2V with a Replicate/fal key, otherwise animated AI key-frames), OFFICE: write_docx/read_docx (Word), write_xlsx/read_xlsx (Excel, formulas, csv), write_pptx (designed PowerPoint decks), read_pdf, MEDIA (built-in ffmpeg, no install): media_info, media_edit (trim/convert/resize/compress/extract_audio/speed/gif/thumbnail/text watermark/crop/rotate/volume/fade), media_concat, media_from_images (slideshow), media_subtitles; remember/recall long-term memory, project_init (ORCA.md project memory), ask_user.

HOW TO WORK
- Act first, ask only when a wrong guess would be costly. Never open with a questionnaire: pick sensible defaults, state them in one line, and start building; the user can redirect you. If the user answers a question with a bare choice/token/number, that IS the answer — continue immediately. Decompose big goals; call independent tools together in one turn (they run in parallel).
- Secrets the user pastes (API tokens, keys) go into a config file or .env, never hard-coded into source and never echoed back in full.
- Build real things end-to-end: create files, run them, read errors, fix, re-run. Never stop at "you could…" when you can do it.
- THINKING: for greetings, identity/date questions and other simple requests do not deliberate — answer directly (at most 2 short lines of thought). Think longer only for real problems. Never run a tool just to echo/print text you could simply write ("reply with X" → write X, no shell); a tool that already succeeded is not re-run "to verify".
- OUTPUT LIMIT: about 4000 tokens per turn, thinking included. Long answers are fine: ORCA automatically lets you continue where you stopped, so never shorten or summarize because of length — just write; if you are cut off you will be asked to continue seamlessly. Never put more than ~5 000 characters in one tool call (≈100 lines of code, but only ~50 lines of prose — long paragraphs count): write_file the first part, then append=true for the rest. Never embed long text or code inside a run_shell/run_python/run_node command (heredocs, python -c "…") — save it with write_file first, then run the short command.
- LONG TEXT the user pasted arrives as <attached_text path="…"> with only a preview inline: the full text is already saved in that workspace file. NEVER retype or copy it into a tool call — read it with read_file/grep, or process it with run_python/run_node reading the file. Split code into small modules (e.g. api.js, handlers.js, store.js, main.js), or write the first ~100 lines and continue with write_file(append=true). Keep thinking short when you are about to write code. One giant call gets cut off and wastes minutes.
- Verify: after writing code run it or test it; after edits re-read if unsure. Own your mistakes and fix them.
- Stay on task: do exactly what the current message asks; never run unrelated tools (e.g. social_trending or generate_image) unless the user asked for that in this conversation.
- Prefer zero-dependency solutions (node:test/assert, python stdlib, plain HTML/CSS/JS) over installing frameworks unless asked. If the same command fails twice, do NOT retry variations of it — change approach (simplify, drop the dependency) or report the blocker.
- Unsure facts (news, prices, versions, docs, dates): web_search, then fetch_page the best 1-3 sources, cite URLs.
- Math/data: compute with run_node or run_python, never in your head.
- Office work (reports, letters, tables, decks): produce the real file (docx/xlsx/pptx) with the office tools — not just Markdown — then tell the user the path. For video/audio edits run media_info first, then media_edit; the user's files are usually in the workspace or an absolute path they give you (copy them into the workspace with the shell if needed).
- Files the user mentions by absolute path outside the workspace: copy them in with run_shell first (tools only touch the workspace).
- Destructive/high-impact actions (deleting, force-push, system changes): say why first.
- Memory: user preferences, names, project facts and decisions → remember. Memory below is already loaded.
- PROJECT MEMORY (ORCA.md): when a workspace has one, keep it current as you work — append to "Decided" when the user chooses something, to "Inferred" when you assumed, to "Tried and failed" when an approach failed (so it is never retried), and "Current state" at the end of a multi-step job. Before a new task in an existing project, read ORCA.md instead of re-exploring the repository.
- Multi-step jobs (3+ steps): first call todo_write with the full checklist, then keep statuses current (in_progress → done) as you work; the user watches it live. Big independent sub-problems → task sub-agents in parallel.
- Images the user attaches are saved under attachments/ and pre-analyzed for you (OCR text${vision ? ' + vision description' : ''} appears inside <attached_image>). Use view_image on any image path/URL to inspect it (question= what to look for). Never claim you cannot see images without trying view_image first; if only OCR is available, say what the OCR read and what could not be determined.
- Social media: for "download this link" use social_download directly (no research needed). For "trending/explore/popular videos" use social_trending (platform, region, query, download=true, max_download). Instagram Explore/stories/private content need the user's cookies — say so briefly and offer the alternatives instead of failing silently. Report every saved file path.
- WEB APPS, SITES & GAMES: build them properly, not as demos. Structure: index.html + style.css + main.js (+ modules) unless the user asks for a single file. Include a real layout (header/nav/hero/sections/footer for sites; HUD, menu, pause, game-over, restart, best score for games), responsive CSS, keyboard + touch input, sensible defaults, no external CDNs (offline must work), no placeholder lorem ipsum. After writing, ALWAYS run browser_check on the entry HTML: it loads the page in headless Chrome, reports console errors/uncaught exceptions and takes a screenshot — fix every error and re-check before you answer. If browser_check is unavailable, run a quick node --check on the JS and a static sanity pass (matching braces, referenced ids exist). Tell the user the path and that they can open it from the Files tab.
- Final answer: concise Markdown in the user's language (default ${lang}); code, commands and paths in English. Write only the answer itself — never narrate your process ("The user asked…", "I'll answer concisely", "Let me…") and never restate the same answer twice. State what you did, results, file paths. Files you produced (images, videos, docs) → list their paths so the UI can preview them. No tool-output dumps unless asked.${effort}${plan}${web}${persona}${rules}${notes}${pins}${projectMemory()}${memorySnippet()}`;
}

// Recover answer text from an unterminated <think> block. Some servers (vLLM w/ MiniMax) swallow
// the closing </think> tag, leaving "reasoning\n\n\nanswer". The reasoning is English monologue;
// the answer follows a blank-line gap. Split at the last "\n\n\n" (or the last paragraph if it
// contains markdown / non-Latin script and the head looks like monologue).
function recoverUnterminated(text) {
  const t = text.replace(/\s+$/, '');
  let i = t.lastIndexOf('\n\n\n');
  if (i === -1) {
    const paras = t.split(/\n\n+/);
    if (paras.length >= 2) {
      const head = paras.slice(0, -1).join('\n\n'), tail = paras[paras.length - 1];
      const monologue = /\b(I|Let me|The user|I'll|I need|I should|we|Now)\b/i.test(head.slice(0, 200));
      const answerish = /[\u0600-\u06FF\u4e00-\u9fff]|\*\*|^#|```|^\s*[-*\d]+[.)]\s/m.test(tail);
      if (monologue && answerish) return { reasoning: head, content: tail };
    }
    return { reasoning: t, content: '' };
  }
  return { reasoning: t.slice(0, i), content: t.slice(i + 3) };
}

function splitReasoning(msg) {
  let content = msg.content || '';
  let reasoning = msg.reasoning_content || msg.reasoning || '';
  const blocks = [...content.matchAll(/<think>([\s\S]*?)<\/think>/g)].map((m) => m[1]);
  if (blocks.length) { reasoning = (reasoning + '\n' + blocks.join('\n')).trim(); content = content.replace(/<think>[\s\S]*?<\/think>/g, ''); }
  const oi = content.indexOf('<think>');
  if (oi !== -1) {
    const rec = recoverUnterminated(content.slice(oi + 7));
    reasoning = (reasoning + '\n' + rec.reasoning).trim();
    content = content.slice(0, oi) + rec.content;
  }
  return { content: content.replace(/<\/?think>/g, '').trim(), reasoning: reasoning.replace(/<\/?think>/g, '').trim() };
}

// Final-answer hygiene for models that leak their template into the text: stray tool-call XML
// fragments (GLM: "</arg_value></tool_call>"), reasoning echoed verbatim into the content, and
// the same paragraph repeated back-to-back.
// Some models (DeepSeek V4 on Dahl) sometimes write their tool calls as XML in the text instead of the
// tool_calls field: <｜DSML｜invoke name="run_shell"><｜DSML｜parameter name="command" string="true">echo ok</｜DSML｜parameter></｜DSML｜invoke>.
// Turn those into real tool calls so they are executed (and never shown to the user as gibberish).
const TEXT_CALL_RE = /<(?:｜DSML｜|\|DSML\||)invoke\s+name="([\w.-]+)"\s*>([\s\S]*?)<\/(?:｜DSML｜|\|DSML\||)invoke>/g;
function parseTextToolCalls(text) {
  const out = []; let m; let rest = String(text || '');
  if (!/invoke\s+name=/.test(rest)) return { calls: out, text: rest };
  const known = new Set(tools.SCHEMAS.map((s) => s.function.name));
  while ((m = TEXT_CALL_RE.exec(rest))) {
    const name = m[1]; if (!known.has(name)) continue;
    const args = {};
    for (const pm of m[2].matchAll(/<(?:｜DSML｜|\|DSML\||)parameter\s+name="([\w.-]+)"([^>]*)>([\s\S]*?)<\/(?:｜DSML｜|\|DSML\||)parameter>/g)) {
      const raw = pm[3]; const isStr = /string="true"/.test(pm[2]);
      let v = raw; if (!isStr) { try { v = JSON.parse(raw); } catch (_) { v = raw.trim() === 'true' ? true : raw.trim() === 'false' ? false : /^-?\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : raw; } }
      args[pm[1]] = v;
    }
    out.push({ id: 'call_txt_' + Math.random().toString(36).slice(2, 10), type: 'function', function: { name, arguments: JSON.stringify(args) } });
  }
  if (out.length) rest = rest.replace(TEXT_CALL_RE, '').replace(/<\/?(?:｜DSML｜|\|DSML\||)tool_calls[^>]*>/g, '').trim();
  return { calls: out, text: rest };
}

function tidyAnswer(content, reasoning) {
  let t = String(content || '');
  t = t.replace(TEXT_CALL_RE, '').replace(/<\/?(?:｜DSML｜|\|DSML\|)[\w-]*[^>]*>/g, ''); // stray DSML tool-call markup
  t = t.replace(/<\/?(tool_call|arg_key|arg_value|function|invoke|parameter|tool_response|observation)[^>]*>/g, '');
  t = t.replace(/<\|[a-z_]+\|>/g, ''); // <|im_end|>, <|observation|> …
  t = t.replace(/<\/?(?:minimax|kimi|glm|deepseek|qwen)?:?tool_calls?[^>]*>/gi, ''); // stray "</minimax:tool_call>" tokens some samplers emit
  if (reasoning) {
    const r = String(reasoning).replace(/\s+/g, ' ').trim();
    if (r.length > 40) {
      const paras = t.split(/\n{2,}/);
      const kept = paras.filter((p) => { const n = p.replace(/\s+/g, ' ').trim(); return !(n.length > 40 && (r.includes(n) || n.includes(r))); });
      if (kept.length && kept.join('').trim()) t = kept.join('\n\n');
      else if (paras.length) { // everything looked like reasoning: keep the shortest paragraph that isn't (likely the actual answer)
        const cand = paras.map((p) => p.trim()).filter(Boolean).filter((p) => !r.includes(p.replace(/\s+/g, ' ')));
        if (cand.length) t = cand.join('\n\n');
      }
      // reasoning glued to the answer without a blank line: "PING The user asked me…"
      const glued = t.indexOf(String(reasoning).trim().slice(0, 60));
      if (glued > 0 && String(reasoning).trim().length > 60) t = t.slice(0, glued).trim();
    }
  }
  // Process narration that leaked into the answer as a trailing paragraph ("The user's request is simple and clear.
  // I should reply with… No tools are needed…") — the model talked to itself after answering. Drop such paragraphs
  // when the answer has real content before them.
  {
    const NARR = /^(?:the user(?:'s request| asked| wants| is asking| requested| just wants)|i should (?:reply|answer|respond|just|simply|now)|i(?:'ll| will) (?:now )?(?:reply|answer|respond|stop)|no tools? (?:are|is) (?:needed|required)|this (?:is a |request is )(?:simple|straightforward|direct)|the (?:response|answer) is (?:straightforward|simple|complete))/i;
    const paras = t.split(/\n{2,}/);
    if (paras.length > 1) {
      let end = paras.length;
      while (end > 1 && (!paras[end - 1].trim() || NARR.test(paras[end - 1].trim()))) end--;
      if (end < paras.length && paras.slice(0, end).join('').trim()) t = paras.slice(0, end).join('\n\n');
    }
  }
  // a doubled opening ("Paris.Paris. The capital…", "سلام!سلام! …") — some models echo their first token
  t = t.replace(/^([^\n.!?؟。]{1,60}[.!?؟。])\s*\1(?=\s|$)/, '$1');
  // collapse immediate duplicate paragraphs / lines ("PING\nPING")
  const out = []; for (const p of t.split(/\n{2,}/)) { if (out.length && out[out.length - 1].trim() === p.trim()) continue; out.push(p); }
  t = out.join('\n\n');
  const lines = t.split('\n'); const dl = []; for (const l of lines) { if (dl.length && l.trim() && dl[dl.length - 1].trim() === l.trim()) continue; dl.push(l); }
  t = dl.join('\n').trim();
  // the whole (short) answer written twice back-to-back, the second time with Markdown emphasis:
  // "Nethyric made me — ORCA v0.0.2. (…)Nethyric made me — **ORCA v0.0.2**. (…)" → keep the formatted half
  if (t.length < 1200) {
    const plain = (x) => x.replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();
    for (let cut = Math.floor(t.length / 2) - 40; cut <= Math.floor(t.length / 2) + 40 && cut > 20; cut++) {
      const a = t.slice(0, cut), b = t.slice(cut);
      if (plain(a) === plain(b)) { t = b.trim(); break; }
    }
  }
  return t;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Degenerate repetition guard. Served open models sometimes fall into a loop ("Paris. No further
// reasoning needed. The capital of France is Paris. Answered directly…" × 100) and only stop at the
// token cap — minutes of garbage, and a naive auto-continue would extend it. Shingle uniqueness of the
// tail tells a loop from normal prose/code (which is > 0.8 unique) regardless of the period length.
function looksRepetitive(text) {
  const t = String(text || ''); if (t.length < 900) return false;
  const tail = t.slice(-3000);
  const lines = tail.split('\n').filter((l) => l.trim());
  if (lines.length >= 8 && tail.length / lines.length < 60) return false; // dense table/list rows may legitimately repeat — leave those alone
  const seen = new Set(); let n = 0;
  for (let i = 0; i + 40 <= tail.length; i++) { seen.add(tail.slice(i, i + 40)); n++; } // every offset: periods of any length count
  return seen.size / n < 0.35; // normal prose/code is ≈ 1.0; a loop with period P scores ≈ P / 3000
}
function cutRepetition(text) {
  const t = String(text || '');
  // period P = the smallest block at the end that is immediately preceded by an identical block
  let P = 0;
  for (let L = 6; L <= 800 && 2 * L <= t.length; L++) { if (t.slice(-L) === t.slice(-2 * L, -L)) { P = L; break; } }
  if (!P) return t.trim();
  let e = t.length; while (e - 2 * P >= 0 && t.slice(e - 2 * P, e - P) === t.slice(e - P, e)) e -= P;
  const prefix = t.slice(0, e - P), copy = t.slice(e - P, e); // prefix + first copy of the loop
  const firstSentence = ((copy.match(/^\s*[^.!?؟。\n]*[.!?؟。\n]/) || [copy])[0]).trim();
  if (firstSentence && prefix.includes(firstSentence)) return prefix.trim() || copy.trim(); // the loop just echoes what was already said
  let out = prefix + copy; const m = out.match(/^[\s\S]*[.!?؟。\n]/); if (m && m[0].length > out.length * 0.5) out = m[0];
  return out.trim();
}

// A short answer that is mostly one word/sentence repeated ("Paris.Paris.Paris. responseParis.") is a sampler
// glitch some free endpoints produce on trivial prompts. We ask the next model instead of showing it.
function degenerate(text) {
  const t = String(text || '').trim(); if (!t || t.length > 1500) return false;
  // a glitched sampler sometimes emits one long run of digits/symbols with no words at all ("7583100921064030118…")
  if (t.length >= 80 && !/\s/.test(t) && !/[\p{L}]{2}/u.test(t)) return true;
  if (t.length >= 120 && (t.match(/\d/g) || []).length / t.length > 0.9) return true;
  const words = t.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []; if (words.length < 4) return false;
  const freq = new Map(); for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  const [top, n] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
  if (n >= 4 && n / words.length >= 0.45 && top.length >= 2 && !/^(ha|he|no|la|na|да|不|哈)$/.test(top)) return true;
  const sents = t.split(/(?<=[.!?؟。])\s*/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  let run = 1; for (let i = 1; i < sents.length; i++) { if (sents[i] === sents[i - 1] && sents[i].length > 1) { if (++run >= 3) return true; } else run = 1; }
  return false;
}
// last resort when every model glitched the same way: collapse the repeats
function collapseRepeats(text) {
  let t = String(text || '');
  t = t.replace(/(\S[^\n.!?؟。]{0,60}[.!?؟。]?)(?:\s*(?:response)?\s*\1){2,}/g, '$1');
  t = t.replace(/\s+response(?=\p{Lu}|\s|$)/gu, ' ').trim();
  return t.replace(/^(.{1,80}?[.!?؟。])\s*(.{1,80}?)$/s, (m, a, b) => (a.startsWith(b) ? a : m)); // "Paris.Paris" → "Paris."
}

// A "stop" that cannot be a real stop: a long answer ending inside an open ``` block, or a stream that ran into the
// proxy's time limit (~300 s) and ends mid-sentence. Some gateways report their own cut as finish_reason "stop".
function suspiciousStop(text, elapsedMs) {
  const t = String(text || ''); if (t.length < 2000) return false;
  const openFence = (t.match(/```/g) || []).length % 2 === 1;
  if (openFence) return true;
  const tail = t.trimEnd().slice(-1);
  return elapsedMs >= 270000 && !/[.!?؟。:)\]`*_>|-]$/.test(tail);
}

// rough token estimate when the provider sends no usage chunk (stream cut) — 1 token ≈ 4 chars of English/code, ≈ 2 chars of Persian/CJK
function estimateUsage(messages, content, reasoning, toolArgs) {
  const tok = (t) => { t = String(t || ''); const wide = (t.match(/[\u0600-\u06FF\u0400-\u04FF\u4e00-\u9fff\u3040-\u30ff]/g) || []).length; return Math.round((t.length - wide) / 4 + wide / 2); };
  const prompt = messages.reduce((a, m) => a + tok(typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')) + (m.tool_calls ? tok(JSON.stringify(m.tool_calls)) : 0), 0) + 5000;
  return { prompt_tokens: prompt, completion_tokens: tok(content) + tok(reasoning) + tok(toolArgs), estimated: true };
}
const ARG_BYTES_MAX = 24000; // a single tool call's JSON arguments — beyond this the proxy cuts the stream anyway (≈300 s); we cut earlier and salvage
const MAX_CONTINUATIONS = 8; // ≈ 9 × 4k tokens ≈ 100 KB of answer before we give up stitching

// Stitch a continuation onto the text that was cut off: drop any overlap the model repeated
// (it often restarts the last sentence or code line) so the seam is invisible.
function joinContinuation(prev, next) {
  if (!prev) return next;
  let b = String(next || '').replace(/^\s+/, ''); let fenceStripped = false;
  // cut happened inside a ``` block and the model re-opened a fence → drop the duplicate opener
  if ((prev.match(/```/g) || []).length % 2 === 1) { const m = b.match(/^```[\w+-]*[ \t]*\n/); if (m) { b = b.slice(m[0].length); fenceStripped = true; } }
  // 1) exact overlap: the continuation repeats the last words
  const max = Math.min(400, prev.length, b.length);
  for (let k = max; k >= 12; k--) if (prev.endsWith(b.slice(0, k))) return prev + b.slice(k);
  // 2) the model restarted the (partial) last line
  const nl = prev.lastIndexOf('\n'); const lastLine = prev.slice(nl + 1);
  if (lastLine.trim().length >= 6 && b.startsWith(lastLine.trimStart())) return prev.slice(0, nl + 1) + b;
  // 3) it restarted from an earlier line/sentence that is still in the tail of what we have
  const head = b.slice(0, 60);
  if (head.length >= 20) { const i = prev.lastIndexOf(head); if (i !== -1 && prev.length - i <= 600) return prev.slice(0, i) + b; }
  if (fenceStripped) return prev + (/\n$/.test(prev) ? '' : '\n') + b;
  return prev + next; // keep the model's own leading whitespace ("…the server" + " with node")
}

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

// ---- streaming call: yields deltas via onDelta({type:'content'|'reasoning', text}) ----
async function streamOnce(cfg, messages, onDelta, signal, useTools, temperature, connectMs = 25000, attempt = 0) {
  const body = { model: cfg.model, messages, stream: true, max_tokens: cfg.maxTokens, temperature };
  if (useTools) { body.tools = tools.SCHEMAS; body.tool_choice = 'auto'; }
  // watchdog: abort if the provider stalls (no bytes for STALL_MS) or never answers (CONNECT_MS)
  const ctl = new AbortController();
  const startedAt = Date.now();
  let stalled = false, looped = false, loopCheckedAt = 0, oversized = false, slow = false, firstAt = 0;
  const calls = new Map(); // tool calls by index (declared here so the catch handlers can salvage partial arguments)
  let drain = () => {}; // assigned below (needs the stream's buffers); the catch handlers call it too
  let content = '', reasoning = '', usage = null;
  const onAbort = () => ctl.abort();
  if (signal) { if (signal.aborted) throw new Error('aborted'); signal.addEventListener('abort', onAbort, { once: true }); }
  let timer = setTimeout(() => { stalled = true; ctl.abort(); }, connectMs);
  const kick = (ms) => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; ctl.abort(); }, ms); };
  const stallErr = () => { const e = new Error('provider stalled (no data for a while)'); e.status = 504; return e; };
  try {
  if ((cfg.api || apiKind(cfg.baseUrl)) === 'anthropic') return await anthropicOnce(cfg, messages, onDelta, ctl, kick, useTools, temperature);
  const r = await fetch(cfg.baseUrl + '/chat/completions', {
    method: 'POST', signal: ctl.signal,
    headers: { ...authHeadersFor(cfg), 'content-type': 'application/json', 'HTTP-Referer': 'https://github.com/' + remote.REPO, 'X-Title': 'ORCA', ...(cfg.extraHeaders || {}) },
    body: JSON.stringify(body),
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); const e = new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`); e.status = r.status; throw e; }
  kick(120000);
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) { // provider ignored stream=true
    const j = await r.json();
    const m = j.choices?.[0]?.message || {};
    const sr = splitReasoning(m);
    if (sr.reasoning) onDelta({ type: 'reasoning', text: sr.reasoning });
    if (sr.content) onDelta({ type: 'content', text: sr.content });
    return { content: sr.content, reasoning: sr.reasoning, tool_calls: m.tool_calls || [], usage: j.usage, finish: j.choices?.[0]?.finish_reason || '' };
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let finish = '', sawDone = false;
  let buf = '', inThink = false, pending = '';
  // Tag-safe splitter: <think>…</think> goes to reasoning, everything else to content.
  // Tags may arrive split across chunks ("<thi" + "nk>"), so hold back a partial-tag tail.
  let softClosed = false, softMark = 0; // we guessed the end of an unterminated <think> at a "\n\n\n" gap
  drain = (final) => {
    while (pending.length) {
      let tag = inThink ? '</think>' : '<think>';
      let i = pending.indexOf(tag);
      if (softClosed && !inThink) { const j = pending.indexOf('</think>'); if (j !== -1 && (i === -1 || j < i)) { tag = '</think>'; i = j; } }
      const reopen = inThink ? pending.indexOf('<think>') : -1;
      if (inThink && (i === -1 || (reopen !== -1 && reopen < i))) {
        // No closing tag yet. Some servers drop </think>; the answer then follows a blank-line gap ("\n\n\n").
        // Hold the text after such a gap until we can tell whether it looks like an answer, then show it as content.
        if (reopen !== -1) {
          // a second <think> opens before the first closed: whatever followed the last blank-line gap was the answer
          const before = pending.slice(0, reopen); const all = reasoning + before; const g = all.lastIndexOf('\n\n\n');
          const ans = g !== -1 ? all.slice(g + 3) : '';
          if (ans.trim() && ans.length < 3000) { reasoning = all.slice(0, g); content += ans; onDelta({ type: 'reset' }); if (reasoning) onDelta({ type: 'reasoning', text: reasoning }); if (content) onDelta({ type: 'content', text: content }); }
          else if (before) { reasoning += before; onDelta({ type: 'reasoning', text: before }); }
          pending = pending.slice(reopen + 7); continue; // still inThink
        }
        const gap = pending.indexOf('\n\n\n');
        if (gap !== -1 && reasoning.length + gap > 30) {
          const after = pending.slice(gap + 3);
          if (after.length < 24 && !final) { const seg = pending.slice(0, gap); if (seg) { reasoning += seg; onDelta({ type: 'reasoning', text: seg }); } pending = pending.slice(gap); break; }
          if (/^\s*(#{1,6}\s|```|\*\*|[-*]\s|\d+[.)]\s|[\u0600-\u06FF\u0400-\u04FF\u4e00-\u9fff]|[A-Z][a-z]+[^\n]{0,80}[.:!]\s)/.test(after) || (final && after.trim().length > 40)) {
            const seg = pending.slice(0, gap); if (seg) { reasoning += seg; onDelta({ type: 'reasoning', text: seg }); }
            pending = after; inThink = false; softClosed = true; softMark = content.length; continue;
          }
          // a gap inside the monologue: flush through it and keep looking
          const seg = pending.slice(0, gap + 3); reasoning += seg; onDelta({ type: 'reasoning', text: seg }); pending = after; continue;
        }
      }
      if (i !== -1) {
        const seg = pending.slice(0, i);
        if (seg) { if (inThink) { reasoning += seg; onDelta({ type: 'reasoning', text: seg }); } else { content += seg; onDelta({ type: 'content', text: seg }); } }
        pending = pending.slice(i + tag.length);
        if (!inThink && tag === '</think>') {
          // a real </think> arrived after our guess: what we showed since the guess was still thinking → move it back
          const back = content.slice(softMark); content = content.slice(0, softMark); reasoning += back; softClosed = false;
          onDelta({ type: 'reset' }); if (reasoning) onDelta({ type: 'reasoning', text: reasoning }); if (content) onDelta({ type: 'content', text: content });
          continue;
        }
        if (tag === '<think>') softClosed = false;
        inThink = !inThink; continue;
      }
      let keep = 0;
      if (!final) { const lt = pending.lastIndexOf('<'); if (lt !== -1 && pending.length - lt < 9 && tag.startsWith(pending.slice(lt))) keep = pending.length - lt; }
      if (!final && inThink) { const nls = pending.match(/\n+$/); if (nls) keep = Math.max(keep, nls[0].length); } // a "\n\n\n" gap may arrive split across deltas
      const seg = pending.slice(0, pending.length - keep);
      if (seg) { if (inThink) { reasoning += seg; onDelta({ type: 'reasoning', text: seg }); } else { content += seg; onDelta({ type: 'content', text: seg }); } }
      pending = pending.slice(pending.length - keep);
      break;
    }
  };
  const flushLine = (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (data === '[DONE]') { sawDone = true; return; }
    if (!data) return;
    let j; try { j = JSON.parse(data); } catch (_) { return; }
    if (j.usage) usage = j.usage;
    if (j.choices?.[0]?.finish_reason) finish = j.choices[0].finish_reason;
    const d = j.choices?.[0]?.delta; if (!d) return;
    const rc = d.reasoning_content || d.reasoning;
    if (rc) { reasoning += rc; onDelta({ type: 'reasoning', text: rc }); }
    if (d.content) { pending += d.content; drain(false); }
    const grown = content.length + reasoning.length;
    // Built-in pool nodes differ a lot: roughly one request in four lands on a node doing ~13 tok/s while the
    // others do 80-150 tok/s, and a fresh request almost always gets a fast one. Measure the first seconds
    // and re-issue once instead of crawling through a 4k-token answer for minutes.
    if (cfg.upstream && attempt === 0 && !slow && (cfg.poolSize == null || cfg.poolSize > 1)) {
      const got = grown + pending.length + [...calls.values()].reduce((a, c) => a + c.function.arguments.length, 0);
      if (got && !firstAt) firstAt = Date.now();
      if (firstAt && Date.now() - firstAt > 6000 && got < 480) { slow = true; ctl.abort(); }
    }
    if (grown - loopCheckedAt > 400) { loopCheckedAt = grown; if (looksRepetitive(content) || (reasoning.length > 1500 && looksRepetitive(reasoning))) { looped = true; ctl.abort(); } }
    for (const tc of d.tool_calls || []) {
      const idx = tc.index ?? 0;
      if (!calls.has(idx)) calls.set(idx, { id: tc.id || ('call_' + idx + '_' + Date.now().toString(36)), type: 'function', function: { name: '', arguments: '' } });
      const cur = calls.get(idx);
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.function.name += tc.function.name;
      if (tc.function?.arguments) { cur.function.arguments += tc.function.arguments; if (cur.function.arguments.length > ARG_BYTES_MAX && !oversized) { oversized = true; ctl.abort(); } }
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    kick(90000);
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) { flushLine(buf.slice(0, nl).replace(/\r$/, '')); buf = buf.slice(nl + 1); }
  }
  if (buf.trim()) flushLine(buf.trim());
  drain(true);
  if (inThink && !content.trim()) {
    // Stream ended inside an unterminated <think>: recover the answer part and re-emit it as content.
    const rec = recoverUnterminated(reasoning);
    if (rec.content.trim()) { reasoning = rec.reasoning; content = rec.content.trim(); onDelta({ type: 'reset' }); onDelta({ type: 'reasoning', text: reasoning }); onDelta({ type: 'content', text: content }); }
  }
  const sr = splitReasoning({ content, reasoning_content: reasoning });
  const tcs = [...calls.values()].filter((c) => c.function.name);
  if (useTools && !tcs.length) { const pt = parseTextToolCalls(sr.content); if (pt.calls.length) { tcs.push(...pt.calls); sr.content = pt.text; onDelta({ type: 'reset' }); if (sr.reasoning) onDelta({ type: 'reasoning', text: sr.reasoning }); if (sr.content) onDelta({ type: 'content', text: sr.content }); } }
  if (!finish && !sawDone && !tcs.length && sr.content.trim()) finish = 'cut'; // proxy/provider closed the stream early
  if ((finish === 'stop' || !finish) && !tcs.length && suspiciousStop(sr.content, Date.now() - startedAt)) finish = 'cut'; // proxy time limit reported as a normal stop / [DONE] without finish_reason
  return { content: sr.content, reasoning: sr.reasoning, tool_calls: tcs, usage: usage || estimateUsage(messages, content, reasoning, [...calls.values()].map((c) => c.function.arguments || '').join('')), finish };
  } catch (e) {
    if (slow && !(signal && signal.aborted)) {
      // re-issue once; if the second attempt is rejected (429/5xx), the caller's normal key/model rotation takes over
      onDelta({ type: 'reset' });
      return streamOnce(cfg, messages, onDelta, signal, useTools, temperature, connectMs, attempt + 1);
    }
    if (oversized) {
      // we cut a runaway tool call ourselves: hand the partial arguments to the salvage path (write_file keeps the complete lines)
      drain(true);
      const sr = splitReasoning({ content, reasoning_content: reasoning });
      const tcs = [...calls.values()].filter((c) => c.function.name);
      return { content: sr.content, reasoning: sr.reasoning, tool_calls: tcs, usage: usage || estimateUsage(messages, content, reasoning, [...calls.values()].map((c) => c.function.arguments || '').join('')), finish: 'length' };
    }
    if (looped) {
      // we aborted a runaway repetition: return the answer up to the point where it started looping
      drain(true);
      let c = cutRepetition(content), r = reasoning;
      if (!c.trim()) { const rec = recoverUnterminated(cutRepetition(reasoning)); r = rec.reasoning; c = rec.content.trim(); }
      const sr = splitReasoning({ content: c, reasoning_content: r });
      onDelta({ type: 'reset' }); if (sr.reasoning) onDelta({ type: 'reasoning', text: sr.reasoning }); if (sr.content) onDelta({ type: 'content', text: sr.content });
      return { content: sr.content, reasoning: sr.reasoning, tool_calls: [], usage: usage || estimateUsage(messages, content, reasoning, [...calls.values()].map((c) => c.function.arguments || '').join('')), finish: 'stop', looped: true };
    }
    if (stalled && !(signal && signal.aborted)) {
      // the provider went silent after streaming a good part of the answer: keep it and let the agent continue it
      drain(true);
      const sr = splitReasoning({ content, reasoning_content: reasoning });
      if (sr.content.trim().length > 400 && !calls.size) return { content: sr.content, reasoning: sr.reasoning, tool_calls: [], usage: usage || estimateUsage(messages, content, reasoning, [...calls.values()].map((c) => c.function.arguments || '').join('')), finish: 'cut' };
      throw stallErr();
    }
    throw e;
  } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); }
}

// Free upstreams get busy in bursts (429 model_concurrency / 503). One sweep over all keys takes ~2 s; when
// every one of them is busy we wait a little and sweep again instead of failing the whole turn — users
// would rather wait 20-40 s than get "All models failed" and press retry themselves.
async function callModel(modelKey, messages, opts) {
  const { emit, signal } = opts;
  const waits = [1500, 2500, 4000, 6000, 8000, 10000, 12000, 15000]; // ≈ 1 min in total; the shared concurrency cap usually clears within seconds
  for (let round = 0; ; round++) {
    try { return await callModelOnce(modelKey, messages, opts); }
    catch (e) {
      if (signal?.aborted || !e.transient || round >= waits.length) throw e;
      const ms = waits[round];
      emit('status', { text: L().busyWait ? L().busyWait(Math.round(ms / 1000)) : `All models are busy — retrying in ${Math.round(ms / 1000)} s`, kind: 'retry' });
      await new Promise((res) => { const onAb = () => { clearTimeout(t); res(); }; const t = setTimeout(() => { signal?.removeEventListener('abort', onAb); res(); }, ms); signal?.addEventListener('abort', onAb, { once: true }); });
      if (signal?.aborted) throw new Error('aborted');
    }
  }
}
async function callModelOnce(modelKey, messages, { emit, signal, useTools = true, temperature, allowFallback = true }) {
  const order = allowFallback ? config.fallbackOrder(modelKey) : [modelKey];
  let last = '', transient = false, glitched = null, lastWhy = ''; // transient = at least one upstream was merely busy → worth another sweep
  for (let i = 0; i < order.length; i++) {
    const logical = config.resolve(order[i]);
    if (!logical || !logical.apiKey) continue;
    if (vault.isVaultModel(logical) && !vault.current()) { await vault.refresh().catch(() => {}); if (!vault.current()) { last = `${logical.label}: ${L().vaultDown}`; continue; } }
    const ups = expand(logical);
    if (!ups.length) { last = `${logical.label}: ${L().vaultDown}`; continue; }
    // every key of this built-in model is cooling down (429/5xx a moment ago) and another model is live → don't waste a round-trip
    if (vault.isVaultModel(logical) && vault.liveCount(vault.aliasOf(logical)) === 0 && order.slice(i + 1).some((k) => { const l = config.resolve(k); return l && l.apiKey && (!vault.isVaultModel(l) || vault.liveCount(vault.aliasOf(l)) > 0); })) { last = `${logical.label}: busy`; continue; }
    for (let u = 0; u < ups.length; u++) {
      const cfg = ups[u];
      const tries = i === 0 && u === 0 ? 2 : 1; // a busy key answers 429 instantly; spend the time on the next key/model instead of waiting
      let moveOn = false;
      for (let a = 0; a < tries && !moveOn; a++) {
        if (signal?.aborted) throw new Error('aborted');
        let emitted = false;
        try {
          const res = await streamOnce(cfg, messages, (d) => { emitted = true; emit('delta', d); }, signal, useTools, temperature, i === 0 && u === 0 ? 25000 : 15000);
          // label the answer with the model that actually produced it (a vault alias may fall back to another model)
          const actual = vault.isVaultModel(logical) && u > 0 && cfg.model !== ups[0].model ? (config.allModels().find((m) => vault.isVaultModel(m) && expand(m)[0]?.model === cfg.model)?.label || cfg.label) : cfg.label;
          if (!res.tool_calls?.length && degenerate(res.content) && order.length > 1) {
            // glitched sampler → next model; keep this one only if nobody does better
            if (!glitched) glitched = { ...res, used: order[i], label: actual, content: collapseRepeats(res.content) };
            if (emitted) emit('delta', { type: 'reset' });
            emit('status', { text: L().retry(`${cfg.label}: garbled answer`), kind: 'retry' });
            last = `${cfg.label}: garbled answer`; u = ups.length; break; // skip the other keys of this model: the model is the problem, not the key
          }
          if (i > 0 || actual !== cfg.label) emit('status', { text: L().fallback(config.resolve(modelKey)?.label || modelKey, actual), kind: 'fallback' });
          return { ...res, used: order[i], label: actual };
        } catch (e) {
          if (signal?.aborted || e.name === 'AbortError') throw new Error('aborted');
          last = `${cfg.label}: ${e.message}`;
          if (emitted) emit('delta', { type: 'reset' });
          // human status instead of the raw provider JSON ("HTTP 429: {"error":{"code":"model_concurrency"…")
          const why = e.status === 429 ? 'busy' : e.status === 504 ? 'no response' : e.status >= 500 ? 'provider error ' + e.status : e.status === 401 || e.status === 403 ? 'key rejected' : e.status === 402 ? 'out of credit' : String(e.message || '').replace(/^HTTP \d+:\s*/, '').slice(0, 80);
          if (lastWhy !== cfg.label + why) { lastWhy = cfg.label + why; emit('status', { text: L().retry(`${cfg.label}: ${why}`), kind: 'retry' }); }
          if (e.status === 429 || e.status === 503 || e.status === 502 || e.status === 504 || e.status === 500 || /fetch failed|ECONN|ETIMEDOUT|stalled/i.test(e.message || '')) transient = true;
          if (cfg.upstream && (e.status === 401 || e.status === 402 || e.status === 403 || e.status === 429 || e.status >= 500)) { vault.markBad(cfg.upstream, e.status); moveOn = true; break; } // next key
          if (e.status && !RETRYABLE.has(e.status)) { u = ups.length; break; } // hard error → next model
          if (e.status === 504 && a >= 1) break; // stalled twice → move on
          await sleep(Math.min(600 * Math.pow(2, a), 2500));
        }
      }
    }
  }
  if (glitched) { emit('delta', { type: 'reset' }); if (glitched.reasoning) emit('delta', { type: 'reasoning', text: glitched.reasoning }); emit('delta', { type: 'content', text: glitched.content }); return glitched; }
  const err = new Error(L().allFailed + last.replace(/HTTP (\d+): \{[\s\S]*$/, 'HTTP $1').slice(0, 200)); err.transient = transient; throw err;
}

// File paths mentioned in the conversation (the user's "save it as docs/x.md", the model's "I'll write src/app.js"),
// most recent first — used to name a file whose write_file call was cut before its "path" arrived.
function mentionedPaths(msgs) {
  const out = [];
  const rx = /(?:^|[\s`'"(\[])((?:[\w.-]+\/)*[\w.-]+\.(?:md|txt|js|mjs|cjs|ts|tsx|jsx|py|html|css|json|ya?ml|toml|sh|ps1|bat|sql|csv|xml|svg|vue|svelte|go|rs|java|kt|c|cpp|h|cs|php|rb))(?=$|[\s`'"),\]:.!?])/g;
  for (let i = msgs.length - 1; i >= 1 && out.length < 6; i--) {
    const m = msgs[i]; if (m.role !== 'user' && m.role !== 'assistant') continue;
    const text = String(typeof m.content === 'string' ? m.content : '').replace(/<think>[\s\S]*?<\/think>/g, '');
    for (const mm of text.matchAll(rx)) { const p = mm[1]; if (!/^\d/.test(p) && !out.includes(p) && !/^(package|node_modules|README)\b/i.test(p)) out.push(p); }
  }
  return out;
}

// ---------------- runs ----------------
const runs = new Map(); // runId -> { abort, approvals: Map<callId,{resolve}>, chatId }

// A provider cut the stream in the middle of tool-call arguments (Dahl caps output at ~4096 tokens per
// turn, thinking included). Recover whatever complete lines of `content` we can, plus the path if it
// was emitted before the cut, so the work is not lost.
function salvageArgs(partial, hints = []) {
  const pm = partial.match(/"path"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  let path; try { path = pm ? JSON.parse('"' + pm[1] + '"') : undefined; } catch (_) { path = pm ? pm[1] : undefined; }
  const ci = partial.search(/"content"\s*:\s*"/);
  if (ci === -1) return { path, content: '' };
  let raw = partial.slice(partial.indexOf('"', partial.indexOf(':', ci) + 1) + 1);
  const m = raw.match(/^((?:[^"\\]|\\.)*)/); raw = (m ? m[1] : raw).replace(/\\$/, '').replace(/\\u[0-9a-fA-F]{0,3}$/, '');
  let content = ''; try { content = JSON.parse('"' + raw + '"'); } catch (_) { content = raw.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\'); }
  const cut = content.lastIndexOf('\n');
  const kept = cut > 0 ? content.slice(0, cut + 1) : '';
  // MiniMax often emits "content" before "path" and the stream is cut before the path ever arrives.
  // Infer a sensible file name from the text so 15 KB of good work is saved instead of thrown away.
  let inferred = false, fromHint = false;
  if (!path && kept.length > 200) {
    const head = (kept.match(/^#\s+(.+)$/m) || kept.match(/^\s*(?:\/\/|#|\*|<!--)?\s*([A-Za-z][\w .-]{3,60})/m) || [])[1] || '';
    const slug = head.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    const ext = /^\s*(<!DOCTYPE|<html)/i.test(kept) ? 'html' : /^\s*(import |export |const |let |function |class |require\()/m.test(kept) && !/^#\s/m.test(kept) ? 'js' : /^\s*(def |import |from \w+ import|class \w+:)/m.test(kept) && !/^#\s/m.test(kept) ? 'py' : 'md';
    // a file the conversation already named (user: "save it as docs/x.md") wins when its type matches the content
    const same = (h) => h.toLowerCase().endsWith('.' + ext) || (ext === 'md' && /\.(txt|markdown)$/i.test(h));
    const hinted = hints.find(same);
    path = hinted || (slug || 'untitled-' + Date.now().toString(36)) + '.' + ext; inferred = true; fromHint = !!hinted;
  }
  const append = /"append"\s*:\s*true/.test(partial); // MiniMax sends "append" first, so a cut continuation still appends instead of overwriting
  return { path, content: kept, tail: content.slice(cut + 1), inferred, fromHint, append };
}

// A long paste is saved to the workspace by the server; the model gets the file path plus as much of
// the text inline as is sensible, so it can both read it directly and process it with tools.
const PASTE_INLINE = 40000;
function wrapPasted(m) {
  const txt = String(m.content || ''); const lines = txt.split('\n').length;
  const body = txt.length <= PASTE_INLINE ? txt : txt.slice(0, PASTE_INLINE) + `\n…[${txt.length - PASTE_INLINE} more characters — not shown here; read the rest from the file with read_file(offset=…) or grep]`;
  return `${m.pastedPrefix ? m.pastedPrefix + '\n\n' : ''}<attached_text path="${m.pastedPath}" chars="${txt.length}" lines="${lines}">\n${body}\n</attached_text>`;
}
function toApiMessages(history) {
  // history from store: user/assistant messages with optional api transcript for tool exchanges
  const out = [];
  for (const m of history) {
    if (m.role === 'user') out.push({ role: 'user', content: m.pastedPath ? wrapPasted(m) : m.content });
    else if (m.role === 'assistant') {
      if (m.api && Array.isArray(m.api) && m.api.length) out.push(...m.api);
      else if (m.content) out.push({ role: 'assistant', content: m.content });
    }
  }
  return out;
}

const MUTATING_ALL = new Set(['write_file', 'edit_file', 'delete_file', 'run_shell', 'run_python', 'run_node', 'write_docx', 'write_xlsx', 'write_pptx', 'media_edit', 'media_concat', 'media_from_images', 'media_subtitles', 'social_download', 'generate_image', 'generate_video', 'project_init', 'task']);

async function requestApproval(run, emit, call, risk) {
  emit('approval', { id: call.id, name: call.name, args: call.args, risk });
  return new Promise((resolve) => { run.approvals.set(call.id, resolve); });
}

/**
 * runAgent({ chatId, history, modelKey, emit, runId, planMode, autonomy, lane })
 * emit(event, data). Events: status, delta, thought_done, tool_call, tool_result, approval, checkpoint,
 * question, final, error, stopped, usage
 */
async function runAgent(o) {
  const { chatId, runId, emit } = o;
  const c = config.load();
  const modelKey = config.modelInfo(o.modelKey) ? o.modelKey : c.defaultModel;
  const autonomy = o.autonomy || c.autonomy;
  const maxSteps = o.maxSteps || c.maxSteps || 24;
  const temperature = o.temperature ?? c.temperature ?? 0.5;
  const ctl = new AbortController();
  try { require('events').setMaxListeners(64, ctl.signal); } catch (_) {} // many sequential fetches share this signal; each removes its listener, but sweeps can briefly overlap
  const run = { abort: ctl, approvals: new Map(), chatId };
  runs.set(runId, run);
  tools.extras.setCurrentChat(chatId);
  const msgs = [{ role: 'system', content: systemPrompt({ planMode: o.planMode, webMode: o.webMode, notes: o.notes, pinned: o.pinned, modelLabel: config.resolve(modelKey)?.label }) }, ...toApiMessages(o.history)];
  { const td = tools.extras.loadTodos(chatId); if (td.length && o.lane !== 'sub') emit('todos', { todos: td }); }
  const api = []; // assistant-side transcript for this run (persisted for context continuity)
  const checkpoints = [];
  let usedLabel = config.resolve(modelKey)?.label || modelKey;
  let totalUsage = { prompt_tokens: 0, completion_tokens: 0 };
  const stopped = () => ctl.signal.aborted;
  if (o.lane !== 'sub') currentEmit = emit;
  const seen = new Map(); // loop detector: signature -> count of failures
  let nudges = 0, continuations = 0, carried = '';

  try {
    for (let step = 0; step < maxSteps; step++) {
      if (stopped()) { emit('stopped', {}); return { api, checkpoints, stopped: true }; }
      emit('status', { text: L().thinking(usedLabel, step + 1), kind: 'thinking', step: step + 1 });
      let res;
      const emitC = carried ? (ev, d) => { emit(ev, d); if (ev === 'delta' && d.type === 'reset') emit('delta', { type: 'content', text: carried }); } : emit;
      let ctxMsgs = fitContext(msgs);
      if (ctxMsgs.length < msgs.length && !o._compacted && o.lane !== 'sub') {
        // conversation no longer fits: compact the dropped part into a brief once per run
        o._compacted = true;
        try { emit('status', { text: L().compacting || 'فشرده‌سازی تاریخچه…', kind: 'compact' }); const dropped = msgs.slice(1, msgs.length - ctxMsgs.length + 2).filter((m) => m.role === 'user' || m.role === 'assistant'); const brief = await compact(dropped, modelKey); if (brief) { msgs.splice(1, dropped.length, { role: 'user', content: '[system] Compact brief of the earlier conversation (auto-compaction):\n' + brief }); ctxMsgs = fitContext(msgs); emit('compacted', { chars: brief.length }); } } catch (_) {}
      }
      try { res = await callModel(modelKey, ctxMsgs, { emit: emitC, signal: ctl.signal, temperature }); }
      catch (e) { if (stopped()) { emit('stopped', {}); return { api, checkpoints, stopped: true }; } emit('error', { text: e.message }); return { api, checkpoints, error: e.message }; }
      usedLabel = res.label;
      if (res.usage) { totalUsage.prompt_tokens += res.usage.prompt_tokens || 0; totalUsage.completion_tokens += res.usage.completion_tokens || 0; if (res.usage.estimated) totalUsage.estimated = true; emit('usage', { ...totalUsage }); }
      if (res.reasoning) emit('thought_done', { text: res.reasoning.slice(0, 6000) });

      // Keep reasoning in the transcript sent back to the model (interleaved-thinking models like
      // MiniMax lose the thread otherwise), but the user only ever sees clean content.
      const apiContent = (res.reasoning ? `<think>${res.reasoning}</think>\n` : '') + (res.content || '');
      const entry = { role: 'assistant', content: apiContent };
      if (res.tool_calls.length) {
        for (const tc of res.tool_calls) { try { JSON.parse(tc.function.arguments || '{}'); } catch (_) { const partial = String(tc.function.arguments || ''); tc._partial = partial; tc.function.arguments = JSON.stringify({ _truncated: true, path: (partial.match(/"path"\s*:\s*"([^"]+)"/) || [])[1] || undefined }); } }
        entry.tool_calls = res.tool_calls.map(({ _partial, ...tc }) => tc);
      }
      msgs.push(entry); api.push(entry);

      if (!res.tool_calls.length && (res.finish === 'length' || res.finish === 'cut') && continuations < MAX_CONTINUATIONS && res.content.trim() && step < maxSteps - 1 && !looksRepetitive(res.content)) {
        // The provider capped the output mid-answer. Ask for the rest and stitch the chunks together —
        // the user just sees one answer that keeps streaming.
        continuations++;
        const joined = joinContinuation(carried, res.content);
        if (joined !== carried + res.content) { emit('delta', { type: 'reset' }); emit('delta', { type: 'content', text: joined }); }
        carried = joined;
        const tail = carried.slice(-400);
        const inFence = (carried.match(/```/g) || []).length % 2 === 1;
        msgs.push({ role: 'user', content: `[system] Your previous message was cut off by the output limit (not by the user). Continue the SAME answer from exactly where it stopped — no greeting, no recap, do not repeat the last words${inFence ? '. You were inside a ``` code block: continue the code directly, do NOT open a new fence and do not repeat lines already written' : ''}. Do not think about it — just continue. For reference, it ended with: ${JSON.stringify(tail)}` }); api.push(msgs[msgs.length - 1]);
        continue;
      }
      if (!res.tool_calls.length && res.finish === 'length' && !res.content.trim() && (o._lenNudges || 0) < 2) {
        // The whole output budget went into thinking. Tell the model to think briefly and act.
        o._lenNudges = (o._lenNudges || 0) + 1;
        msgs.push({ role: 'user', content: '[system] You ran out of output budget (~4000 tokens per turn, thinking included) before producing anything. Think in at most 5 short lines, then act immediately: call the next tool with a small payload (≤100 lines) or write the answer.' }); api.push(msgs[msgs.length - 1]);
        emit('status', { text: L().retry('output limit while thinking — retrying briefly'), kind: 'retry' });
        continue;
      }
      if (!res.tool_calls.length) {
        if (carried) res.content = joinContinuation(carried, res.content);
        if (!res.content.trim() && step < maxSteps - 1 && !o._nudged) {
          o._nudged = true;
          msgs.push({ role: 'user', content: '[system] Your previous message contained no visible answer for the user. Write the final answer now.' });
          api.push(msgs[msgs.length - 1]);
          emit('status', { text: L().empty, kind: 'retry' });
          continue;
        }
        const text = tidyAnswer(res.content, res.reasoning) || (res.reasoning ? res.reasoning.slice(-1200) : L().noAnswer);
        emit('final', { text, model: usedLabel, modelKey: res.used, usage: totalUsage });
        return { api, checkpoints, text, model: usedLabel };
      }

      // ---- execute tool calls (approvals sequential, execution parallel, results in call order) ----
      const prepared = [];
      for (const tc of res.tool_calls) {
        const name = tc.function.name;
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) { args = {}; }
        const broken = !!tc._partial; // provider cut the stream mid-arguments (usually a huge write_file)
        if (broken) args = { _truncated: true, _partialLength: tc._partial.length, path: args.path };
        prepared.push({ id: tc.id, name, args, broken, partial: tc._partial });
      }
      const ask = prepared.find((c) => c.name === 'ask_user');
      if (ask) {
        emit('question', { id: ask.id, question: ask.args.question, options: ask.args.options || [] });
        for (const c of prepared) { const tm = { role: 'tool', tool_call_id: c.id, name: c.name, content: JSON.stringify(c.id === ask.id ? { note: 'Question shown to user. Their reply will arrive as the next user message.' } : { error: 'skipped: waiting for the user to answer your question first' }) }; msgs.push(tm); api.push(tm); }
        emit('final', { text: res.content || ask.args.question, model: usedLabel, modelKey: res.used, usage: totalUsage, question: true });
        return { api, checkpoints, text: res.content || ask.args.question, model: usedLabel };
      }
      const decisions = new Map();
      for (const call of prepared) {
        if (stopped()) { emit('stopped', {}); return { api, checkpoints, stopped: true }; }
        const risk = tools.riskOf(call.name, call.args);
        emit('tool_call', { id: call.id, name: call.name, args: call.args, risk });
        let decision = 'allow';
        if (o.planMode && MUTATING_ALL.has(call.name)) decision = 'deny_plan';
        else if (autonomy === 'ask' && risk !== 'none') decision = await requestApproval(run, emit, call, risk);
        else if (autonomy === 'auto' && risk === 'high') decision = await requestApproval(run, emit, call, risk);
        decisions.set(call.id, decision);
      }
      if (stopped()) { emit('stopped', {}); return { api, checkpoints, stopped: true }; }
      if (prepared.length > 1) emit('status', { text: L().running(prepared.length), kind: 'tools' });
      const MUTATING = new Set(['write_file', 'edit_file', 'delete_file', 'run_shell', 'run_python', 'run_node', 'write_docx', 'write_xlsx', 'write_pptx', 'media_edit', 'media_concat', 'media_from_images', 'media_subtitles', 'project_init']);
      const execOne = async (call) => {
        const decision = decisions.get(call.id);
        const t0 = Date.now();
        let result;
        if (decision === 'deny_plan') result = { error: 'PLAN MODE is on: write/run tools are disabled for this turn. Stop calling tools now and reply with the numbered plan, ending with "Shall I execute?" in the user\'s language (fa: اجرا کنم؟ / ru: Выполнить? / zh: 要执行吗？). (The user can turn Plan off with the Plan button in the composer.)' };
        else if (decision !== 'allow') result = { error: 'User denied this action.' + (typeof decision === 'string' && decision.startsWith('deny:') ? ' Reason: ' + decision.slice(5) : '') };
        else if (call.broken) {
          const sv = call.name === 'write_file' ? salvageArgs(call.partial, mentionedPaths(msgs)) : {};
          const limitNote = `HARD LIMIT: one tool call may carry at most ~5000 characters of arguments (~4000 output tokens per turn, thinking included).`;
          if (sv.path && sv.content && sv.content.length > 200) {
            if (sv.inferred && !sv.append) {
              // The name is a guess, so never destroy existing work: a re-send of the same document (same first line)
              // may overwrite it; a continuation that forgot append=true is appended; an unrelated file gets -2, -3 …
              const firstLine = (t) => (String(t || '').split('\n').find((l) => l.trim()) || '').trim();
              for (let n = 2; n < 20; n++) {
                const ex = await tools.callTool('read_file', { path: sv.path, offset: 0, limit: 3 });
                if (ex.error || firstLine(ex.content) === firstLine(sv.content)) break;
                if (sv.fromHint) { sv.append = true; break; }
                sv.path = sv.path.replace(/(-\d+)?(\.\w+)$/, `-${n}$2`);
              }
            }
            result = await tools.callTool('write_file', { path: sv.path, content: sv.content, append: sv.append });
            const lines = sv.content.split('\n'); const lastLine = lines[lines.length - 2] || '';
            result = { ...result, partial: true, lines_written: lines.length - 1, chars_written: sv.content.length, last_line: lastLine, next_step: `Your call was cut off after ${call.args._partialLength} characters of arguments (this model sends "content" before "path", so the path never arrived — that is expected, not your mistake). The first ${lines.length - 1} complete lines were ${sv.append ? 'APPENDED to' : 'SAVED to'} ${JSON.stringify(sv.path)}${sv.inferred ? ' (name taken from the conversation/heading; rename later with run_shell if needed)' : ''}. Do NOT resend them and do NOT start over. Continue from the line AFTER ${JSON.stringify(lastLine.slice(0, 120))} with write_file(path=${JSON.stringify(sv.path)}, append=true, content=<next part>) — each part at most 5000 characters (~60 lines of prose or ~100 lines of code); several small append calls are fine.` };
            emit('files', { tool: 'write_file', files: [sv.path] });
          } else {
            result = { error: `Your ${call.name} arguments were cut off after ${call.args._partialLength} characters — nothing was executed. ${limitNote} ${call.name === 'write_file' ? 'Re-send in parts of at most 5000 characters: write_file(path, part1) then write_file(path, part2, append=true) …' : 'Never embed a large document or script inside a ' + call.name + ' command: save it with write_file in parts of at most 5000 characters (append=true for the following parts), then run the short command that uses the file.'}${sv.content ? ' The cut content began with: ' + JSON.stringify(sv.content.slice(0, 100)) : ''}` };
          }
        }
        else result = await tools.callTool(call.name, call.args);
        let ck = null;
        if (result && result._diff) { ck = store.saveCheckpoint(chatId, runId, result._diff); if (ck) { checkpoints.push(ck); emit('checkpoint', { ...ck, before: result._diff.before, after: result._diff.after }); } delete result._diff; }
        if (result && result._todos) { emit('todos', { todos: result._todos }); delete result._todos; }
        if (result && Array.isArray(result.files) && result.files.length) emit('files', { tool: call.name, files: result.files.map((f) => (typeof f === 'string' ? f : f.path)).filter(Boolean) });
        const out = JSON.stringify(result);
        emit('tool_result', { id: call.id, name: call.name, ok: !(result && result.error), ms: Date.now() - t0, result: out.slice(0, 4000), truncated: out.length > 4000 });
        return { role: 'tool', tool_call_id: call.id, name: call.name, content: out.slice(0, 14000) };
      };
      // read-only calls run concurrently; mutating calls run in order (relative to each other) to keep file edits deterministic
      const results = new Array(prepared.length);
      const readOnly = prepared.map((c, i) => [c, i]).filter(([c]) => !MUTATING.has(c.name));
      const mutating = prepared.map((c, i) => [c, i]).filter(([c]) => MUTATING.has(c.name));
      const ro = Promise.all(readOnly.map(async ([c, i]) => { results[i] = await execOne(c); }));
      for (const [c, i] of mutating) { if (stopped()) break; results[i] = await execOne(c); }
      await ro;
      if (stopped()) { emit('stopped', {}); return { api, checkpoints, stopped: true }; }
      for (const tm of results) { if (tm) { msgs.push(tm); api.push(tm); } }
      // loop detection: same tool+args failing repeatedly, or the same error text coming back again and again
      let looping = false;
      for (const c of prepared) { const k = 'ok:' + c.name + ':' + JSON.stringify(c.args).slice(0, 300); const n = (seen.get(k) || 0) + 1; seen.set(k, n); if (n >= 3 && !['todo_read', 'list_files', 'read_file', 'recall'].includes(c.name)) looping = true; } // identical successful call 3× is a loop too
      for (const tm of results) {
        if (!tm) continue;
        let failed = false, errKey = '';
        try { const j = JSON.parse(tm.content); failed = !!(j.error || (j.exit_code && j.exit_code !== 0)); errKey = failed ? String(j.error || j.output || '').replace(/\d+/g, '#').slice(0, 160) : ''; } catch (_) {}
        if (!failed) continue;
        const call = prepared.find((c) => c.id === tm.tool_call_id);
        const sig = call ? call.name + ':' + JSON.stringify(call.args).slice(0, 300) : tm.tool_call_id;
        const n1 = (seen.get(sig + '|' + errKey) || 0) + 1; seen.set(sig + '|' + errKey, n1);
        const n2 = (seen.get('err:' + errKey) || 0) + 1; seen.set('err:' + errKey, n2);
        if (n1 >= 2 || n2 >= 4) looping = true;
      }
      // Identical successful tool calls over and over (echo "OK" ×N, the same read) are a stall, not progress:
      // the model has its answer and keeps "verifying" it. Finish with the text it already wrote, otherwise
      // demand a plain-text answer, and after that give up with what we have instead of burning all steps.
      const countOf = (c) => seen.get('ok:' + c.name + ':' + JSON.stringify(c.args).slice(0, 300)) || 0;
      const allOk = results.every((tm) => { try { const j = JSON.parse(tm.content); return !j.error && !(j.exit_code && j.exit_code !== 0); } catch (_) { return true; } });
      const echoLike = (c) => (c.name === 'run_shell' && /^\s*(echo|printf)\b/.test(String(c.args.command || ''))) || (c.name === 'run_node' && /^\s*console\.log\(/.test(String(c.args.code || ''))) || (c.name === 'run_python' && /^\s*print\(/.test(String(c.args.code || '')));
      const stall = allOk && prepared.length && (prepared.every((c) => echoLike(c) && countOf(c) >= 2) || prepared.every((c) => countOf(c) >= 3));
      if (res.content.trim()) o._lastSaid = res.content;
      if (stall) {
        o._stalls = (o._stalls || 0) + 1;
        const said = tidyAnswer(o._lastSaid || '', res.reasoning);
        if (said && (o._stalls >= 2 || prepared.every(echoLike))) { emit('final', { text: said, model: usedLabel, modelKey: res.used, usage: totalUsage }); return { api, checkpoints, text: said, model: usedLabel }; }
        if (o._stalls >= 3) { const text = said || L().noAnswer; emit('final', { text, model: usedLabel, modelKey: res.used, usage: totalUsage }); return { api, checkpoints, text, model: usedLabel }; }
        msgs.push({ role: 'user', content: '[system] You have already run that successfully — repeating it changes nothing. Do not call any tool now: reply to the user with the final answer as plain text.' }); api.push(msgs[msgs.length - 1]);
        emit('status', { text: ({ fa: 'تکرار بی‌نتیجه — درخواست پاسخ نهایی', ru: 'Повтор без результата — запрашиваю ответ', zh: '重复无进展 — 要求给出最终回答' })[config.load().lang] || 'Repeating without progress — asking for the answer', kind: 'retry' });
        continue;
      }
      if (looping && nudges < 2) {
        nudges++;
        const nudge = { role: 'user', content: '[system] You are repeating an action that keeps failing with the same error. Do not retry it again. Take a fundamentally different approach (simplest possible, zero new dependencies), or if it is impossible, stop and explain the blocker to the user with what you have achieved so far.' };
        msgs.push(nudge); api.push(nudge);
        emit('status', { text: ({ fa: 'تکرار خطا شناسایی شد — تغییر رویکرد', ru: 'Обнаружен цикл — меняю подход', zh: '检测到循环 — 更换方法' })[config.load().lang] || 'Loop detected — changing approach', kind: 'retry' });
      }
    }
    const text = L().cap;
    emit('final', { text, model: usedLabel, modelKey, usage: totalUsage });
    return { api, checkpoints, text, model: usedLabel };
  } finally { runs.delete(runId); }
}

// ---- sub-agents: a fresh agent loop with its own context; returns the final text ----
tools.extras.setSubagentRunner(async ({ description, prompt, model, maxSteps }) => {
  const c = config.load();
  const modelKey = config.modelInfo(model) ? model : (config.allModels().find((m) => m.tier === 'strong' && config.resolve(m.key)?.apiKey)?.key || c.defaultModel);
  const runId = 'sub-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const parent = currentEmit;
  const events = [];
  const emit = (ev, d) => { if (ev === 'tool_call' || ev === 'tool_result' || ev === 'status') { events.push({ ev, d }); if (parent) parent('sub_event', { runId, description, event: ev, data: ev === 'tool_result' ? { ...d, result: String(d.result || '').slice(0, 300) } : d }); } };
  const history = [{ role: 'user', content: `You are a sub-agent of ORCA working on one delegated task. Do it fully with tools, then reply with a complete, self-contained report (facts, file paths, code snippets, blockers). Do not ask questions — decide and proceed.\n\nTASK: ${description}\n\n${prompt}` }];
  const t0 = Date.now();
  const r = await runAgent({ chatId: 'sub', runId, history, modelKey, emit, autonomy: 'yolo', maxSteps: maxSteps || 14, lane: 'sub' });
  const toolsUsed = events.filter((e) => e.ev === 'tool_call').map((e) => e.d.name);
  return { description, report: r.text || r.error || '(no report)', tools_used: toolsUsed.length, steps: toolsUsed.slice(0, 40), seconds: Math.round((Date.now() - t0) / 1000), model: r.model };
});
let currentEmit = null;

// ---- compaction: summarize a long conversation into a compact brief (used by /compact and auto-compaction) ----
async function compact(history, modelKey) {
  const text = history.map((m) => `${m.role.toUpperCase()}: ${String(m.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').slice(0, 3000)}`).join('\n\n').slice(-60000);
  const prompt = `Summarize this conversation into a compact working brief for continuing the work: goals, decisions, constraints, files created/changed (paths), current state, open issues, next steps. Keep exact names, paths, commands, numbers. Max 500 words. Same language as the conversation.\n\n${text}`;
  const fast = config.allModels().find((m) => m.tier === 'fast' && config.resolve(m.key)?.apiKey)?.key;
  return quick(modelKey || fast || config.load().defaultModel, prompt, 1200);
}

function stopRun(runId) { const r = runs.get(runId); if (r) { r.abort.abort(); for (const [, res] of r.approvals) res('deny:stopped'); return true; } return false; }
function approve(runId, callId, decision) { const r = runs.get(runId); const res = r?.approvals.get(callId); if (!res) return false; r.approvals.delete(callId); res(decision); return true; }

// plain chat completion without tools (used for title generation etc.)
async function quick(modelKey, prompt, maxTokens = 60) {
  const logical = config.resolve(modelKey) || config.resolve(config.load().defaultModel);
  if (!logical) throw new Error('no model');
  if (vault.isVaultModel(logical) && !vault.current()) await vault.refresh().catch(() => {});
  let last = '';
  for (const cfg of expand(logical)) {
    try {
      if ((cfg.api || apiKind(cfg.baseUrl)) === 'anthropic') {
        const r = await fetch(cfg.baseUrl + '/messages', { method: 'POST', headers: { ...authHeadersFor(cfg), 'content-type': 'application/json' }, body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }) });
        if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
        const j = await r.json(); return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      }
      const r = await fetch(cfg.baseUrl + '/chat/completions', { method: 'POST', headers: { ...authHeadersFor(cfg), 'content-type': 'application/json', ...(cfg.extraHeaders || {}) }, body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0.3 }) });
      if (!r.ok) { if (cfg.upstream) vault.markBad(cfg.upstream, r.status); throw Object.assign(new Error('HTTP ' + r.status), { status: r.status }); }
      const j = await r.json();
      return splitReasoning(j.choices?.[0]?.message || {}).content;
    } catch (e) { last = e.message; }
  }
  throw new Error(last || 'no upstream');
}

// ---- Anthropic Messages API (bring-your-own Claude key) → same delta/tool_calls shape as the OpenAI path ----
async function anthropicOnce(cfg, messages, onDelta, ctl, kick, useTools, temperature) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n\n');
  const conv = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') { const last = conv[conv.length - 1]; const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content || '').slice(0, 60000) }; if (last && last.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') last.content.push(block); else conv.push({ role: 'user', content: [block] }); continue; }
    if (m.role === 'assistant') { const blocks = []; if (m.content) blocks.push({ type: 'text', text: String(m.content) }); for (const tc of (m.tool_calls || [])) { let input = {}; try { input = JSON.parse(tc.function.arguments || '{}'); } catch (_) {} blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input }); } if (blocks.length) conv.push({ role: 'assistant', content: blocks }); continue; }
    // user (string or multimodal parts)
    if (Array.isArray(m.content)) conv.push({ role: 'user', content: m.content.map((p) => p.type === 'image_url' ? (() => { const mm = /^data:(.*?);base64,(.*)$/.exec(p.image_url?.url || ''); return mm ? { type: 'image', source: { type: 'base64', media_type: mm[1], data: mm[2] } } : { type: 'text', text: '[image]' }; })() : { type: 'text', text: p.text || '' }) });
    else conv.push({ role: 'user', content: String(m.content || '') });
  }
  const body = { model: cfg.model, max_tokens: cfg.maxTokens || 4096, stream: true, messages: conv, ...(sys ? { system: sys } : {}), ...(temperature != null ? { temperature } : {}) };
  if (useTools) body.tools = tools.SCHEMAS.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters || { type: 'object', properties: {} } }));
  const r = await fetch(cfg.baseUrl + '/messages', { method: 'POST', signal: ctl.signal, headers: { ...authHeadersFor(cfg), 'content-type': 'application/json', ...(cfg.extraHeaders || {}) }, body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text().catch(() => ''); const e = new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`); e.status = r.status; throw e; }
  kick(120000);
  const reader = r.body.getReader(); const dec = new TextDecoder();
  let buf = '', content = '', reasoning = '', usage = null, finish = '';
  const blocks = new Map(); // index → { type, id, name, json }
  const calls = [];
  while (true) {
    const { value, done } = await reader.read(); if (done) break; kick(45000);
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch (_) { continue; }
      if (ev.type === 'content_block_start') { blocks.set(ev.index, { type: ev.content_block.type, id: ev.content_block.id, name: ev.content_block.name, json: '' }); }
      else if (ev.type === 'content_block_delta') {
        const b = blocks.get(ev.index) || {};
        if (ev.delta.type === 'text_delta') { content += ev.delta.text; onDelta({ type: 'content', text: ev.delta.text }); }
        else if (ev.delta.type === 'thinking_delta') { reasoning += ev.delta.thinking; onDelta({ type: 'reasoning', text: ev.delta.thinking }); }
        else if (ev.delta.type === 'input_json_delta') { b.json += ev.delta.partial_json; }
      } else if (ev.type === 'content_block_stop') { const b = blocks.get(ev.index); if (b && b.type === 'tool_use') calls.push({ id: b.id, type: 'function', function: { name: b.name, arguments: b.json || '{}' } }); }
      else if (ev.type === 'message_delta') { finish = ev.delta?.stop_reason || finish; if (ev.usage) usage = { completion_tokens: ev.usage.output_tokens }; }
      else if (ev.type === 'message_start' && ev.message?.usage) usage = { prompt_tokens: ev.message.usage.input_tokens };
      else if (ev.type === 'error') { const e = new Error(ev.error?.message || 'stream error'); e.status = 502; throw e; }
    }
  }
  return { content, reasoning, tool_calls: calls, usage, finish: finish === 'max_tokens' ? 'length' : finish };
}

module.exports = { runAgent, stopRun, approve, quick, compact, systemPrompt, splitReasoning, routeAuto, fitContext, salvageArgs };
