'use strict';
// Builds the static documentation site (site/) from README.md, docs/*.md, SECURITY.md and CHANGELOG.md.
// Dependency-free: a small Markdown renderer + an HTML shell styled after modern docs sites
// (sticky topbar, left sidebar, on-this-page TOC, dark mode, client-side search).
// Usage: node scripts/build-site.js   (output: site/)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'site');

// ---------------------------------------------------------------- pages
const PAGES = [
  { slug: 'overview',        file: 'docs/README.md',        title: 'Overview',            group: 'Getting started' },
  { slug: 'setup',           file: 'docs/setup.md',         title: 'Setup',               group: 'Getting started' },
  { slug: 'configuration',   file: 'docs/configuration.md', title: 'Configuration',       group: 'Getting started' },
  { slug: 'providers',       file: 'docs/providers.md',     title: 'Providers & models',  group: 'Using ORCA' },
  { slug: 'tools',           file: 'docs/tools.md',         title: 'Tools reference',     group: 'Using ORCA' },
  { slug: 'mcp',             file: 'docs/mcp.md',           title: 'MCP',                 group: 'Using ORCA' },
  { slug: 'updates',         file: 'docs/updates.md',       title: 'Updates & releases',  group: 'Using ORCA' },
  { slug: 'decision-engine', file: 'docs/decision-engine.md', title: 'Decision engine',   group: 'Using ORCA' },
  { slug: 'api',             file: 'docs/api.md',           title: 'HTTP API',            group: 'Reference' },
  { slug: 'vault',           file: 'docs/vault.md',         title: 'Built-in models & vault', group: 'Reference' },
  { slug: 'troubleshooting', file: 'docs/troubleshooting.md', title: 'Troubleshooting',   group: 'Reference' },
  { slug: 'security',        file: 'SECURITY.md',           title: 'Security',            group: 'Reference' },
  { slug: 'changelog',       file: 'CHANGELOG.md',          title: 'Changelog',           group: 'Reference' },
  { slug: 'readme',          file: 'README.md',             title: 'README',              group: 'More' },
  { slug: 'readme-ru',       file: 'README.ru.md',          title: 'README (Русский)',    group: 'More' },
  { slug: 'readme-zh',       file: 'README.zh.md',          title: 'README (中文)',        group: 'More' },
  { slug: 'readme-fa',       file: 'docs/README.fa.md',     title: 'README (فارسی)',       group: 'More', rtl: true },
];

// link rewrite: any markdown link to a known source file -> its site page
const LINK_MAP = { 'index.html': 'index.html' };
for (const p of PAGES) LINK_MAP[p.file] = p.slug + '.html';
const EXTRA_LINKS = {
  'docs/README.md': 'overview.html', 'README.md': 'readme.html', 'SECURITY.md': 'security.html',
  'CHANGELOG.md': 'changelog.html', 'LICENSE': 'https://github.com/Nethyric/orca/blob/main/LICENSE',
};
Object.assign(LINK_MAP, EXTRA_LINKS);

function fixLink(href, pageFile) {
  if (/^(https?:|mailto:|#|\/)/.test(href)) {
    if (/^https:\/\/github\.com\/Nethyric\/orca\/blob\/main\/(docs\/)?[\w.-]+\.md/.test(href)) {
      const rel = href.replace('https://github.com/Nethyric/orca/blob/main/', '');
      if (LINK_MAP[rel]) return LINK_MAP[rel];
    }
    return href;
  }
  const clean = href.split('#')[0];
  const hash = href.includes('#') ? href.slice(href.indexOf('#')) : '';
  if (!clean) return href;
  // resolve relative to the page's own directory
  const abs = path.posix.normalize(path.posix.join(path.posix.dirname(pageFile), clean));
  const cands = [clean, abs, path.posix.join('docs', clean), abs.replace(/^docs\//, '')];
  for (const c of cands) if (LINK_MAP[c]) return LINK_MAP[c] + hash;
  if (/\.(png|jpg|svg|ico)$/.test(clean)) return 'assets/' + path.basename(clean);
  return href; // leave as-is (e.g. .github templates) — GitHub renders it
}

// ---------------------------------------------------------------- markdown
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s) => s.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');

function inline(text, pageFile) {
  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, alt, src) =>
    `<img src="${fixLink(src, pageFile)}" alt="${alt}" loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, t, href) => {
    const h = fixLink(href.replace(/&amp;/g, '&'), pageFile);
    const ext = /^https?:/.test(h) ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${h}"${ext}>${t}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return s;
}

function renderMarkdown(md, pageFile) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  const toc = [];
  let i = 0;
  const listStack = []; // {type:'ul'|'ol', indent}
  const closeLists = (toIndent = -1) => {
    while (listStack.length && listStack[listStack.length - 1].indent > toIndent) {
      html.push(`</li></${listStack.pop().type}>`);
    }
    if (listStack.length) html.push('</li>');
  };
  while (i < lines.length) {
    const line = lines[i];
    // fenced code
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      closeLists();
      const lang = fence[1] || '';
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      html.push(`<div class="codeblock"><div class="codebar"><span>${esc(lang || 'text')}</span>` +
        `<button class="copy" type="button" aria-label="Copy code">Copy</button></div>` +
        `<pre><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(buf.join('\n'))}</code></pre></div>`);
      continue;
    }
    // heading
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeLists();
      const lvl = h[1].length;
      const text = h[2].replace(/\s*\{#[^}]*\}\s*$/, '');
      const id = slug(text) || `h-${i}`;
      html.push(`<h${lvl} id="${id}"><a class="hlink" href="#${id}" aria-hidden="true">#</a>${inline(text, pageFile)}</h${lvl}>`);
      if (lvl >= 2 && lvl <= 3) toc.push({ lvl, id, text: text.replace(/[*`]/g, '') });
      i++; continue;
    }
    // hr
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { closeLists(); html.push('<hr>'); i++; continue; }
    // blockquote / GFM alert
    if (/^\s*>/.test(line)) {
      closeLists();
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      const alert = buf[0] && buf[0].match(/^\[!(TIP|NOTE|IMPORTANT|WARNING|CAUTION)\]\s*$/i);
      const body = (alert ? buf.slice(1) : buf).join('\n');
      const inner = renderMarkdown(body, pageFile).html;
      if (alert) html.push(`<div class="alert alert-${alert[1].toLowerCase()}"><div class="alert-title">${alert[1][0] + alert[1].slice(1).toLowerCase()}</div>${inner}</div>`);
      else html.push(`<blockquote>${inner}</blockquote>`);
      continue;
    }
    // table
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      closeLists();
      const cells = (r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      html.push('<div class="tablewrap"><table><thead><tr>' + head.map((c) => `<th>${inline(c, pageFile)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c, pageFile)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    // list item
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      const indent = li[1].length;
      const type = /\d/.test(li[2]) ? 'ol' : 'ul';
      if (!listStack.length || indent > listStack[listStack.length - 1].indent) {
        if (listStack.length) html.push('<li>' === html[html.length - 1] ? '' : '');
        listStack.push({ type, indent });
        html.push(`<${type}><li>`);
      } else {
        while (listStack.length > 1 && indent < listStack[listStack.length - 1].indent) html.push(`</li></${listStack.pop().type}>`);
        if (indent < listStack[listStack.length - 1].indent) { html.push(`</li></${listStack.pop().type}>`); listStack.push({ type, indent }); html.push(`<${type}>`); }
        html.push('</li><li>');
      }
      html.push(inline(li[3], pageFile));
      // lazy continuation lines belong to this item
      i++;
      while (i < lines.length && lines[i].trim() && !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i]) && !/^\s*(#|>|```|\|)/.test(lines[i]) && /^\s{2,}/.test(lines[i])) {
        html.push(' ' + inline(lines[i].trim(), pageFile)); i++;
      }
      continue;
    }
    // blank
    if (!line.trim()) { closeLists(); i++; continue; }
    // html passthrough (README header <p align=center> etc.)
    if (/^\s*<(p|h1|div|img|a|b|br|table|tr|td|th|details|summary|sup|sub|span)\b/i.test(line) || /^\s*<\/\w+>/.test(line)) {
      closeLists();
      let buf = line;
      // pass through until the block closes (simple heuristic: collect until blank line)
      const openMatch = line.match(/^\s*<(\w+)/);
      if (!openMatch) { html.push(buf); i++; continue; } // stray closing tag
      const startTag = openMatch[1].toLowerCase();
      i++;
      while (i < lines.length && lines[i].trim() && !new RegExp(`</${startTag}>`, 'i').test(buf)) { buf += '\n' + lines[i]; i++; }
      buf = buf.replace(/src="(assets\/[^"]+)"/g, 'src="assets/$1"');
      buf = buf.replace(/href="(?!https?:|#|mailto:)([^"]+)"/g, (_, h2) => `href="${fixLink(h2, pageFile)}"`);
      html.push(buf);
      continue;
    }
    // paragraph
    closeLists();
    const pbuf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^\s*(#|>|\||```|[-*+] |\d+[.)] |<)/.test(lines[i])) { pbuf.push(lines[i]); i++; }
    html.push(`<p>${inline(pbuf.join(' '), pageFile)}</p>`);
  }
  closeLists();
  return { html: html.join('\n'), toc };
}

// ---------------------------------------------------------------- shell
const CSS = fs.readFileSync(path.join(__dirname, 'site.css'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, 'site.js'), 'utf8');

function sidebarHtml(activeSlug) {
  const groups = [];
  for (const p of PAGES) {
    let g = groups.find((x) => x.name === p.group);
    if (!g) groups.push((g = { name: p.group, items: [] }));
    g.items.push(p);
  }
  let s = `<a class="side-link${activeSlug === 'index' ? ' active' : ''}" href="index.html">Home</a>`;
  for (const g of groups) {
    s += `<div class="side-group">${g.name}</div>`;
    for (const p of g.items) s += `<a class="side-link${p.slug === activeSlug ? ' active' : ''}" href="${p.slug}.html">${esc(p.title)}</a>`;
  }
  s += `<div class="side-group">Repository</div>` +
    `<a class="side-link" href="https://github.com/Nethyric/orca" target="_blank" rel="noopener">GitHub ↗</a>` +
    `<a class="side-link" href="https://github.com/Nethyric/orca/releases/latest" target="_blank" rel="noopener">Download ↗</a>`;
  return s;
}

function tocHtml(toc) {
  if (toc.length < 2) return '';
  return `<nav class="toc" aria-label="On this page"><div class="toc-title">On this page</div>` +
    toc.map((t) => `<a class="toc-link toc-l${t.lvl}" href="#${t.id}">${esc(t.text)}</a>`).join('') + `</nav>`;
}

function pageShell({ title, activeSlug, content, toc, rtl, prev, next }) {
  const nav = (prev || next) ? `<div class="pagenav">` +
    (prev ? `<a class="pn prev" href="${prev.slug}.html"><span>← Previous</span><strong>${esc(prev.title)}</strong></a>` : '<span></span>') +
    (next ? `<a class="pn next" href="${next.slug}.html"><span>Next →</span><strong>${esc(next.title)}</strong></a>` : '') + `</div>` : '';
  return `<!doctype html>
<html lang="en"${rtl ? ' dir="rtl"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ORCA Documentation</title>
<meta name="description" content="ORCA — the open-source autonomous AI agent for your desktop. ${esc(title)}.">
<link rel="icon" type="image/png" href="assets/icon.png">
<style>${CSS}</style>
</head>
<body>
<header class="topbar">
  <button class="burger" id="burger" aria-label="Menu">☰</button>
  <a class="brand" href="index.html"><img src="assets/logo.png" alt=""><span>ORCA</span><em>docs</em></a>
  <div class="topsearch"><input id="q" type="search" placeholder="Search docs…" autocomplete="off"><div id="qres" class="qres" hidden></div></div>
  <nav class="toplinks">
    <a href="overview.html">Docs</a>
    <a href="https://github.com/Nethyric/orca/releases/latest" target="_blank" rel="noopener">Download</a>
    <a href="https://github.com/Nethyric/orca" target="_blank" rel="noopener" aria-label="GitHub">
      <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
    </a>
    <button class="theme" id="theme" aria-label="Toggle theme">◐</button>
  </nav>
</header>
<div class="layout">
  <aside class="sidebar" id="sidebar">${sidebarHtml(activeSlug)}</aside>
  <main class="content">
    <article class="doc">${content}${nav}</article>
  </main>
  ${tocHtml(toc || [])}
</div>
<script>${JS}</script>
</body>
</html>`;
}

// ---------------------------------------------------------------- landing
const landing = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ORCA — the open-source autonomous AI agent for your desktop</title>
<meta name="description" content="ORCA plans, writes code, runs it, reads the errors and fixes them — on your machine, in your files. Bring any model, or none.">
<link rel="icon" type="image/png" href="assets/icon.png">
<style>${CSS}</style>
</head>
<body class="landing">
<header class="topbar">
  <button class="burger" id="burger" aria-label="Menu">☰</button>
  <a class="brand" href="index.html"><img src="assets/logo.png" alt=""><span>ORCA</span><em>docs</em></a>
  <div class="topsearch"><input id="q" type="search" placeholder="Search docs…" autocomplete="off"><div id="qres" class="qres" hidden></div></div>
  <nav class="toplinks">
    <a href="overview.html">Docs</a>
    <a href="https://github.com/Nethyric/orca/releases/latest" target="_blank" rel="noopener">Download</a>
    <a href="https://github.com/Nethyric/orca" target="_blank" rel="noopener" aria-label="GitHub">
      <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
    </a>
    <button class="theme" id="theme" aria-label="Toggle theme">◐</button>
  </nav>
</header>
<section class="hero">
  <img class="hero-logo" src="assets/logo.png" alt="ORCA">
  <h1>The autonomous AI agent<br>for your desktop</h1>
  <p class="tagline">ORCA plans, writes code, runs it, reads the errors and fixes them — on your machine, in your files.
  Built-in models work out of the box; bring your own keys for 200+ providers or any OpenAI-compatible endpoint.</p>
  <div class="cta">
    <a class="btn primary" href="https://github.com/Nethyric/orca/releases/latest" target="_blank" rel="noopener">Download ORCA</a>
    <a class="btn" href="overview.html">Read the docs</a>
    <a class="btn ghost" href="https://github.com/Nethyric/orca" target="_blank" rel="noopener">GitHub</a>
  </div>
  <div class="plats">Windows 10/11 · macOS 12+ (Apple Silicon &amp; Intel) · Linux x64 — self-updating, SHA-256 verified, MIT licensed.</div>
</section>
<section class="features">
  <div class="feat"><h3>46 real tools</h3><p>Shell, Node/Python, precise file editing, web search, HTTP, headless-browser checks, Office documents, media, OCR, image &amp; video generation, background processes, sub-agents.</p></div>
  <div class="feat"><h3>Any model</h3><p>Built-in models with automatic failover, plus your own cloud or local providers (Ollama, LM Studio, vLLM). Keys never leave your device.</p></div>
  <div class="feat"><h3>MCP client</h3><p>Connect any Model Context Protocol server over stdio or Streamable HTTP — presets included, per-tool toggles, untrusted-content isolation.</p></div>
  <div class="feat"><h3>Builds whole sites</h3><p>The model writes the content; <code>scaffold_site</code> renders a finished multi-page site and every page is verified in a headless browser.</p></div>
  <div class="feat"><h3>Checkpoints &amp; diffs</h3><p>Every file change is snapshotted; restore any step with one click. Live edits render as reviewable diff cards.</p></div>
  <div class="feat"><h3>Private by design</h3><p>No accounts, no telemetry. Everything lives in a local data folder you control, behind an authenticated local API.</p></div>
</section>
<section class="quickstart">
  <h2>Quick start</h2>
  <div class="codeblock"><div class="codebar"><span>bash</span><button class="copy" type="button" aria-label="Copy code">Copy</button></div>
<pre><code class="language-bash">git clone https://github.com/Nethyric/orca.git
cd orca
npm install
npm start          # desktop app
npm run web        # or: browser UI at http://localhost:7860</code></pre></div>
  <p>Prefer a package? Grab the build for your system from <a href="https://github.com/Nethyric/orca/releases/latest" target="_blank" rel="noopener">Releases</a> — the app updates itself from there, verified against <code>SHA256SUMS</code>.</p>
</section>
<footer class="foot">
  <div>ORCA © Nethyric · <a href="https://github.com/Nethyric/orca/blob/main/LICENSE" target="_blank" rel="noopener">MIT License</a></div>
  <div class="footlinks">
    <a href="readme.html">English</a> · <a href="readme-ru.html">Русский</a> · <a href="readme-zh.html">中文</a> · <a href="readme-fa.html">فارسی</a> ·
    <a href="security.html">Security</a> · <a href="changelog.html">Changelog</a>
  </div>
</footer>
<script>${JS}</script>
</body>
</html>`;

// ---------------------------------------------------------------- build
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
for (const a of ['logo.png', 'icon.png', 'icon512.png']) {
  const src = path.join(root, 'assets', a);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, 'assets', a));
}

const index = [];
fs.writeFileSync(path.join(out, 'index.html'), landing);
index.push({ slug: 'index', title: 'Home', text: 'ORCA autonomous AI agent desktop download quick start' });

PAGES.forEach((p, n) => {
  const file = path.join(root, p.file);
  if (!fs.existsSync(file)) { console.warn('missing source:', p.file); return; }
  const md = fs.readFileSync(file, 'utf8');
  const { html, toc } = renderMarkdown(md, p.file);
  const prev = n > 0 ? PAGES[n - 1] : null;
  const next = n < PAGES.length - 1 ? PAGES[n + 1] : null;
  fs.writeFileSync(path.join(out, p.slug + '.html'),
    pageShell({ title: p.title, activeSlug: p.slug, content: html, toc, rtl: p.rtl, prev, next }));
  const text = md.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*`|\[\]()!-]/g, ' ').replace(/\s+/g, ' ');
  index.push({ slug: p.slug, title: p.title, text: text.slice(0, 4000), heads: toc.map((t) => t.text) });
});

fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index));
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(out, 'LICENSE.txt'));
console.log(`✔ site built → site/ (${PAGES.length + 1} pages)`);
