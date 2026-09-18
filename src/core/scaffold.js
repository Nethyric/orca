'use strict';
// scaffold_site: deterministic multi-page website scaffold (design tokens, responsive layout, nav, footer,
// per-page files, JSON data, JS with routing helpers) so the model spends its output budget on content
// and features instead of boilerplate. Offline, zero dependencies, RTL-aware, dark/light aware.
const fs = require('fs');
const path = require('path');

const RTL = new Set(['fa', 'ar', 'he', 'ur']);
const PALETTES = {
  indigo: { accent: '#5e6ad2', accent2: '#8b93ff' }, violet: { accent: '#7c3aed', accent2: '#a78bfa' }, cyan: { accent: '#0891b2', accent2: '#22d3ee' },
  emerald: { accent: '#059669', accent2: '#34d399' }, amber: { accent: '#d97706', accent2: '#fbbf24' }, rose: { accent: '#e11d48', accent2: '#fb7185' }, slate: { accent: '#334155', accent2: '#64748b' },
};
const FONT = (lang) => (lang === 'fa' || lang === 'ar' ? "'Vazirmatn', 'Segoe UI', Tahoma, sans-serif" : lang === 'zh' ? "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif" : "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif");
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9\u0600-\u06FF\u0400-\u04FF\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function css({ accent, accent2, theme }) {
  const dark = theme !== 'light';
  return `/* Design tokens — change these first; every page reads them */
:root {
  --bg: ${dark ? '#0f1011' : '#ffffff'};
  --bg-2: ${dark ? '#151618' : '#f6f7f9'};
  --bg-3: ${dark ? '#1c1d20' : '#eceef2'};
  --text: ${dark ? '#f7f8f8' : '#111318'};
  --text-2: ${dark ? '#a3a7ad' : '#5b616b'};
  --line: ${dark ? '#26282c' : '#e2e5ea'};
  --accent: ${accent};
  --accent-2: ${accent2};
  --ok: #22c55e; --warn: #f59e0b; --bad: #ef4444;
  --radius: 12px; --radius-sm: 6px;
  --shadow: 0 8px 30px rgba(0,0,0,${dark ? '.45' : '.10'});
  --maxw: 1160px;
  --font: __FONT__;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; font-family: var(--font); background: var(--bg); color: var(--text); line-height: 1.6; -webkit-font-smoothing: antialiased; }
a { color: var(--accent-2); text-decoration: none; } a:hover { text-decoration: underline; }
img, video { max-width: 100%; display: block; }
.container { max-width: var(--maxw); margin: 0 auto; padding: 0 20px; }
.btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: var(--radius-sm); border: 1px solid var(--line); background: var(--bg-2); color: var(--text); font: inherit; cursor: pointer; transition: transform .12s, background .12s; }
.btn:hover { background: var(--bg-3); text-decoration: none; transform: translateY(-1px); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; } .btn.primary:hover { background: var(--accent-2); }
.btn.lg { padding: 14px 26px; font-size: 1.05rem; }
/* header */
.site-header { position: sticky; top: 0; z-index: 50; backdrop-filter: blur(12px); background: color-mix(in srgb, var(--bg) 85%, transparent); border-bottom: 1px solid var(--line); }
.site-header .container { display: flex; align-items: center; justify-content: space-between; height: 64px; gap: 16px; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 1.15rem; color: var(--text); }
.brand .logo { width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, var(--accent), var(--accent-2)); }
.nav { display: flex; gap: 4px; align-items: center; }
.nav a { padding: 8px 12px; border-radius: var(--radius-sm); color: var(--text-2); font-weight: 500; }
.nav a:hover, .nav a.active { color: var(--text); background: var(--bg-3); text-decoration: none; }
.nav-toggle { display: none; background: none; border: 1px solid var(--line); border-radius: var(--radius-sm); color: var(--text); width: 40px; height: 40px; font-size: 1.2rem; cursor: pointer; }
/* hero */
.hero { padding: 96px 0 72px; text-align: center; background: radial-gradient(ellipse at top, color-mix(in srgb, var(--accent) 22%, transparent), transparent 60%); }
.hero h1 { font-size: clamp(2.2rem, 5vw, 3.6rem); line-height: 1.15; margin: 0 0 16px; letter-spacing: -.02em; }
.hero p { font-size: 1.2rem; color: var(--text-2); max-width: 680px; margin: 0 auto 28px; }
.hero .actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
/* sections */
.section { padding: 64px 0; } .section.alt { background: var(--bg-2); }
.section h2 { font-size: 2rem; margin: 0 0 8px; letter-spacing: -.01em; } .section .lead { color: var(--text-2); margin: 0 0 32px; max-width: 720px; }
.grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.card { background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius); padding: 22px; transition: transform .15s, box-shadow .15s; }
.card:hover { transform: translateY(-3px); box-shadow: var(--shadow); }
.card h3 { margin: 0 0 8px; font-size: 1.15rem; } .card p { margin: 0; color: var(--text-2); }
.card .price { font-size: 1.4rem; font-weight: 700; color: var(--accent-2); margin: 12px 0 0; }
.card .media { aspect-ratio: 16/10; border-radius: var(--radius-sm); background: linear-gradient(135deg, var(--bg-3), color-mix(in srgb, var(--accent) 30%, var(--bg-3))); margin: -22px -22px 16px; border-radius: var(--radius) var(--radius) 0 0; }
.badge { display: inline-block; padding: 2px 10px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent-2); font-size: .8rem; font-weight: 600; }
/* forms */
.form { display: grid; gap: 14px; max-width: 560px; }
.form label { display: grid; gap: 6px; font-weight: 500; }
.form input, .form select, .form textarea { font: inherit; padding: 11px 14px; border-radius: var(--radius-sm); border: 1px solid var(--line); background: var(--bg-2); color: var(--text); width: 100%; }
.form input:focus, .form textarea:focus, .form select:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: transparent; }
.form .row { display: grid; gap: 14px; grid-template-columns: 1fr 1fr; }
.form .error { color: var(--bad); font-size: .85rem; } .form .success { color: var(--ok); font-weight: 600; }
/* tables */
.table { width: 100%; border-collapse: collapse; } .table th, .table td { text-align: start; padding: 12px 14px; border-bottom: 1px solid var(--line); } .table th { color: var(--text-2); font-weight: 600; font-size: .85rem; text-transform: uppercase; letter-spacing: .04em; }
/* footer */
.site-footer { border-top: 1px solid var(--line); padding: 40px 0; color: var(--text-2); font-size: .9rem; }
.site-footer .container { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 16px; align-items: center; }
.site-footer .links { display: flex; gap: 18px; flex-wrap: wrap; }
/* utilities */
.muted { color: var(--text-2); } .center { text-align: center; } .mt { margin-top: 24px; } .hidden { display: none !important; }
.toast { position: fixed; bottom: 24px; inset-inline-end: 24px; background: var(--bg-3); border: 1px solid var(--line); color: var(--text); padding: 12px 16px; border-radius: var(--radius-sm); box-shadow: var(--shadow); z-index: 100; animation: fade .2s; }
@keyframes fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (max-width: 760px) {
  .nav { display: none; position: absolute; top: 64px; inset-inline: 0; flex-direction: column; background: var(--bg); border-bottom: 1px solid var(--line); padding: 10px 20px 16px; }
  .nav.open { display: flex; } .nav-toggle { display: inline-flex; align-items: center; justify-content: center; }
  .hero { padding: 64px 0 48px; } .form .row { grid-template-columns: 1fr; } .section { padding: 44px 0; }
}
`;
}

function js() {
  return `// Shared behaviour for every page: nav toggle, active link, toast helper, data loader, cart (localStorage), form validation.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  // mobile nav
  const toggle = $('.nav-toggle'), nav = $('.nav');
  if (toggle && nav) toggle.addEventListener('click', () => nav.classList.toggle('open'));
  // active link
  const here = location.pathname.split('/').pop() || 'index.html';
  $$('.nav a').forEach((a) => { if ((a.getAttribute('href') || '').split('/').pop() === here) a.classList.add('active'); });
  // toast
  window.toast = (msg, ms = 2400) => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); };
  // data loader: loadData('products') → data/products.json (works from file:// too, falls back to inline <script type="application/json" id="data-products">)
  window.loadData = async (name) => {
    if (window.SITE_DATA && window.SITE_DATA[name]) return window.SITE_DATA[name];
    const inline = document.getElementById('data-' + name);
    if (inline) { try { return JSON.parse(inline.textContent); } catch (_) {} }
    if (location.protocol !== 'file:') { try { const r = await fetch('data/' + name + '.json'); if (r.ok) return await r.json(); } catch (_) {} }
    return [];
  };
  // simple cart
  const KEY = 'site.cart';
  const cart = {
    read() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } },
    write(items) { localStorage.setItem(KEY, JSON.stringify(items)); cart.render(); },
    add(item) { const items = cart.read(); const f = items.find((x) => x.id === item.id); if (f) f.qty += 1; else items.push({ ...item, qty: 1 }); cart.write(items); toast(item.name + ' ✓'); },
    remove(id) { cart.write(cart.read().filter((x) => x.id !== id)); },
    setQty(id, qty) { const items = cart.read(); const f = items.find((x) => x.id === id); if (f) { f.qty = Math.max(0, qty | 0); } cart.write(items.filter((x) => x.qty > 0)); },
    total() { return cart.read().reduce((a, x) => a + (+x.price || 0) * x.qty, 0); },
    count() { return cart.read().reduce((a, x) => a + x.qty, 0); },
    render() { $$('[data-cart-count]').forEach((el) => { el.textContent = cart.count(); }); document.dispatchEvent(new CustomEvent('cart:change')); },
  };
  window.cart = cart; cart.render();
  // form validation: <form data-validate> with required / type=email / minlength; shows .error under fields, .success on submit
  $$('form[data-validate]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault(); let ok = true;
      $$('input, textarea, select', form).forEach((f) => {
        const label = f.closest('label') || f.parentElement; let err = label.querySelector('.error'); if (!err) { err = document.createElement('span'); err.className = 'error'; label.appendChild(err); }
        let msg = '';
        if (f.required && !f.value.trim()) msg = f.dataset.msgRequired || 'Required';
        else if (f.type === 'email' && f.value && !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(f.value)) msg = f.dataset.msgEmail || 'Invalid email';
        else if (f.minLength > 0 && f.value && f.value.length < f.minLength) msg = (f.dataset.msgMin || 'At least {n} characters').replace('{n}', f.minLength);
        err.textContent = msg; if (msg) ok = false;
      });
      if (!ok) return;
      const done = form.querySelector('.success') || Object.assign(document.createElement('p'), { className: 'success' });
      done.textContent = form.dataset.success || 'Sent ✓'; form.appendChild(done); form.reset();
      try { const key = 'site.forms.' + (form.id || 'form'); const all = JSON.parse(localStorage.getItem(key) || '[]'); all.push(Object.fromEntries(new FormData(form))); localStorage.setItem(key, JSON.stringify(all)); } catch (_) {}
    });
  });
})();
`;
}

function pageHtml({ title, siteName, lang, dir, pages, file, body, tagline, year, data = [] }) {
  const nav = pages.map((p) => `<a href="${p.file}">${esc(p.title)}</a>`).join('');
  const dataScripts = data.map((d) => `<script src="data/${d}.js"></script>\n`).join('');
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(siteName)}</title>
<meta name="description" content="${esc(tagline)}">
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="site-header">
  <div class="container">
    <a class="brand" href="index.html"><span class="logo"></span>${esc(siteName)}</a>
    <nav class="nav" aria-label="Main">${nav}</nav>
    <button class="nav-toggle" aria-label="Menu">☰</button>
  </div>
</header>
<main>
${body}
</main>
<footer class="site-footer">
  <div class="container">
    <span>© ${year} ${esc(siteName)}</span>
    <div class="links">${nav}</div>
  </div>
</footer>
${dataScripts}<script src="main.js"></script>
<script src="${file.replace(/\.html$/, '')}.js"></script>
</body>
</html>
`;
}

// Body templates per page kind — real structure, TODO markers the model replaces with content.
function bodyFor(kind, { title, tagline, siteName }) {
  const t = esc(title), s = esc(siteName), tg = esc(tagline);
  const K = {
    home: `<section class="hero"><div class="container">
  <span class="badge">${s}</span>
  <h1>${t}</h1>
  <p>${tg}</p>
  <div class="actions"><a class="btn primary lg" href="#features">TODO: primary call to action</a><a class="btn lg" href="contact.html">TODO: secondary</a></div>
</div></section>
<section class="section" id="features"><div class="container">
  <h2>TODO: section title</h2><p class="lead">TODO: one-paragraph lead.</p>
  <div class="grid">
    <article class="card"><h3>TODO: feature 1</h3><p>TODO: description</p></article>
    <article class="card"><h3>TODO: feature 2</h3><p>TODO: description</p></article>
    <article class="card"><h3>TODO: feature 3</h3><p>TODO: description</p></article>
  </div>
</div></section>
<section class="section alt"><div class="container center">
  <h2>TODO: closing statement</h2><p class="lead" style="margin-inline:auto">TODO: supporting sentence.</p>
  <a class="btn primary" href="contact.html">TODO: call to action</a>
</div></section>`,
    catalog: `<section class="section"><div class="container">
  <h2>${t}</h2><p class="lead">${tg}</p>
  <div class="grid" id="catalog"><!-- rendered by ${'{file}'}.js from data/items.json --></div>
</div></section>`,
    cart: `<section class="section"><div class="container">
  <h2>${t}</h2>
  <table class="table" id="cart-table"><thead><tr><th>TODO: item</th><th>TODO: qty</th><th>TODO: price</th><th></th></tr></thead><tbody></tbody></table>
  <p class="mt"><b id="cart-total"></b></p>
  <div class="actions mt"><a class="btn" href="index.html">TODO: continue</a><button class="btn primary" id="checkout">TODO: checkout</button></div>
</div></section>`,
    contact: `<section class="section"><div class="container">
  <h2>${t}</h2><p class="lead">${tg}</p>
  <form class="form" id="contact" data-validate data-success="TODO: success message">
    <div class="row">
      <label>TODO: name<input name="name" required data-msg-required="TODO: required"></label>
      <label>TODO: email<input name="email" type="email" required data-msg-required="TODO: required" data-msg-email="TODO: invalid email"></label>
    </div>
    <label>TODO: message<textarea name="message" rows="5" required minlength="10" data-msg-required="TODO: required" data-msg-min="TODO: at least {n} characters"></textarea></label>
    <button class="btn primary" type="submit">TODO: send</button>
  </form>
</div></section>`,
    about: `<section class="section"><div class="container">
  <h2>${t}</h2><p class="lead">${tg}</p>
  <div class="grid">
    <article class="card"><h3>TODO: our story</h3><p>TODO: 2-3 sentences.</p></article>
    <article class="card"><h3>TODO: what we value</h3><p>TODO: 2-3 sentences.</p></article>
    <article class="card"><h3>TODO: the team</h3><p>TODO: 2-3 sentences.</p></article>
  </div>
</div></section>`,
    dashboard: `<section class="section"><div class="container">
  <h2>${t}</h2><p class="lead">${tg}</p>
  <div class="grid" id="kpis"></div>
  <div class="card mt"><h3>TODO: table title</h3><table class="table" id="records"><thead></thead><tbody></tbody></table></div>
</div></section>`,
    generic: `<section class="section"><div class="container">
  <h2>${t}</h2><p class="lead">${tg}</p>
  <div class="grid">
    <article class="card"><h3>TODO: heading</h3><p>TODO: content</p></article>
    <article class="card"><h3>TODO: heading</h3><p>TODO: content</p></article>
  </div>
</div></section>`,
  };
  return K[kind] || K.generic;
}

function pageJs(kind, base) {
  const K = {
    catalog: `// ${base}.js — renders data/items.json into #catalog and wires "add to cart"
loadData('items').then((items) => {
  const root = document.getElementById('catalog'); if (!root) return;
  root.innerHTML = items.map((it) => \`<article class="card"><div class="media"></div><span class="badge">\${it.category || ''}</span><h3>\${it.name}</h3><p>\${it.description || ''}</p><p class="price">\${it.price}</p><button class="btn primary mt" data-add="\${it.id}">TODO: add</button></article>\`).join('');
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-add]'); if (!b) return; const it = items.find((x) => String(x.id) === b.dataset.add); if (it) cart.add(it); });
});`,
    cart: `// ${base}.js — cart table from localStorage (see main.js → window.cart)
function renderCart() {
  const tb = document.querySelector('#cart-table tbody'); if (!tb) return;
  const items = cart.read();
  tb.innerHTML = items.map((x) => \`<tr><td>\${x.name}</td><td><input type="number" min="0" value="\${x.qty}" data-qty="\${x.id}" style="width:64px"></td><td>\${(+x.price || 0) * x.qty}</td><td><button class="btn" data-rm="\${x.id}">✕</button></td></tr>\`).join('') || '<tr><td colspan="4" class="muted">TODO: empty cart message</td></tr>';
  document.getElementById('cart-total').textContent = 'TODO: total label ' + cart.total();
}
document.addEventListener('cart:change', renderCart); renderCart();
document.addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) cart.remove(isNaN(+b.dataset.rm) ? b.dataset.rm : +b.dataset.rm); });
document.addEventListener('change', (e) => { const i = e.target.closest('[data-qty]'); if (i) cart.setQty(isNaN(+i.dataset.qty) ? i.dataset.qty : +i.dataset.qty, +i.value); });
document.getElementById('checkout')?.addEventListener('click', () => { if (!cart.count()) return toast('TODO: cart is empty'); cart.write([]); toast('TODO: order placed'); });`,
    dashboard: `// ${base}.js — KPIs + table from data/records.json
loadData('records').then((rows) => {
  const kp = document.getElementById('kpis'); const tb = document.querySelector('#records tbody'); const th = document.querySelector('#records thead');
  if (!rows.length) { if (kp) kp.innerHTML = '<div class="card muted">TODO: no data yet</div>'; return; }
  const cols = Object.keys(rows[0]);
  if (kp) kp.innerHTML = \`<div class="card"><h3>\${rows.length}</h3><p>TODO: records</p></div>\` + cols.filter((c) => typeof rows[0][c] === 'number').slice(0, 3).map((c) => \`<div class="card"><h3>\${rows.reduce((a, r) => a + (+r[c] || 0), 0)}</h3><p>Σ \${c}</p></div>\`).join('');
  if (th) th.innerHTML = '<tr>' + cols.map((c) => '<th>' + c + '</th>').join('') + '</tr>';
  if (tb) tb.innerHTML = rows.map((r) => '<tr>' + cols.map((c) => '<td>' + r[c] + '</td>').join('') + '</tr>').join('');
});`,
  };
  return K[kind] || `// ${base}.js — page-specific behaviour (optional)\n`;
}

const KIND_RE = [
  [/(^|\s)(home|index|landing|main|خانه|صفحه اصلی|главная|首页)(\s|$)/i, 'home'],
  [/(shop|store|catalog|products?|menu|courses?|portfolio|gallery|services?|pricing|فروشگاه|محصول|منو|خدمات|دوره|نمونه.?کار|قیمت|магазин|каталог|товар|меню|услуг|商店|产品|菜单|服务)/i, 'catalog'],
  [/(cart|basket|checkout|سبد|پرداخت|корзин|购物车|结账)/i, 'cart'],
  [/(contact|book|reserv|order|signup|register|apply|تماس|رزرو|سفارش|ثبت.?نام|درخواست|контакт|брон|заказ|регистр|联系|预订|订单|注册)/i, 'contact'],
  [/(about|team|story|faq|درباره|تیم|داستان|سوالات|о нас|команд|история|关于|团队)/i, 'about'],
  [/(dashboard|admin|stats|analytics|report|داشبورد|مدیریت|آمار|گزارش|панель|статист|отчет|仪表盘|管理|统计|报告)/i, 'dashboard'],
];
const kindOf = (name, explicit) => explicit || (KIND_RE.find(([re]) => re.test(name)) || [, 'generic'])[1];

/**
 * scaffold({ dir, name, tagline, lang, theme, accent, pages: [{ title, file?, kind? } | "Title"] })
 * Writes: style.css, main.js, <page>.html + <page>.js per page, data/items.json (catalog), data/records.json (dashboard), README.md
 */
function scaffold({ root, dir = '.', name = 'My Site', tagline = '', lang = 'en', theme = 'dark', accent = 'indigo', pages = [], overwrite = false }) {
  if (!Array.isArray(pages) || !pages.length) pages = ['Home', 'About', 'Contact'];
  const dirAbs = path.resolve(root, dir);
  if (!dirAbs.startsWith(path.resolve(root))) throw new Error('dir must be inside the workspace');
  fs.mkdirSync(dirAbs, { recursive: true });
  const dirTag = RTL.has(lang) ? 'rtl' : 'ltr';
  const pal = PALETTES[accent] || PALETTES.indigo;
  // models often pass English keywords as page titles for a non-English site ("home", "menu"): label the nav in the site's language
  const LABELS = {
    fa: { home: 'خانه', index: 'خانه', menu: 'منو', shop: 'فروشگاه', store: 'فروشگاه', products: 'محصولات', catalog: 'کاتالوگ', services: 'خدمات', pricing: 'قیمت‌ها', portfolio: 'نمونه‌کارها', gallery: 'گالری', courses: 'دوره‌ها', blog: 'وبلاگ', cart: 'سبد خرید', checkout: 'پرداخت', contact: 'تماس با ما', reservation: 'رزرو میز', booking: 'رزرو', order: 'سفارش', signup: 'ثبت‌نام', register: 'ثبت‌نام', login: 'ورود', about: 'درباره ما', team: 'تیم ما', faq: 'سوالات متداول', dashboard: 'داشبورد', admin: 'مدیریت' },
    ru: { home: 'Главная', index: 'Главная', menu: 'Меню', shop: 'Магазин', store: 'Магазин', products: 'Товары', catalog: 'Каталог', services: 'Услуги', pricing: 'Цены', portfolio: 'Портфолио', gallery: 'Галерея', courses: 'Курсы', blog: 'Блог', cart: 'Корзина', checkout: 'Оформление', contact: 'Контакты', reservation: 'Бронирование', booking: 'Бронирование', order: 'Заказ', signup: 'Регистрация', register: 'Регистрация', login: 'Вход', about: 'О нас', team: 'Команда', faq: 'Вопросы', dashboard: 'Панель', admin: 'Админ' },
    zh: { home: '首页', index: '首页', menu: '菜单', shop: '商店', store: '商店', products: '产品', catalog: '目录', services: '服务', pricing: '价格', portfolio: '作品', gallery: '画廊', courses: '课程', blog: '博客', cart: '购物车', checkout: '结账', contact: '联系我们', reservation: '预订', booking: '预订', order: '订单', signup: '注册', register: '注册', login: '登录', about: '关于我们', team: '团队', faq: '常见问题', dashboard: '仪表盘', admin: '管理' },
  };
  const labels = LABELS[String(lang || 'en').slice(0, 2).toLowerCase()] || null;
  const norm = pages.map((p, i) => {
    const o = typeof p === 'string' ? { title: p } : { ...p };
    o.title = String(o.title || '').trim() || 'Page';
    if (labels && /^[a-z][a-z -]{1,20}$/i.test(o.title)) { const key = o.title.toLowerCase().replace(/\s+/g, ''); const l = labels[key] || labels[key.replace(/s$/, '')]; if (l) { o.file = o.file || (i === 0 ? 'index.html' : slug(o.title) + '.html'); o.title = l; } }
    const k = i === 0 && !o.kind && (!o.file || o.file === 'index.html') ? 'home' : kindOf(o.kind ? '' : (o.file || '').replace(/\.html$/, '') + ' ' + o.title, o.kind);
    const latin = String(o.title).replace(/[^\x00-\x7F]+/g, '').trim();
    o.file = o.file || (k === 'home' ? 'index.html' : (latin ? slug(latin) : k) + '.html'); // non-Latin titles → file named after the page kind (menu → catalog.html)
    if (!/\.html$/.test(o.file)) o.file += '.html'; o.kind = k; return o;
  });
  // unique file names
  const seen = new Set(); for (const p of norm) { let f = p.file, n = 2; while (seen.has(f)) f = p.file.replace(/\.html$/, `-${n++}.html`); p.file = f; seen.add(f); }
  const written = [], skipped = [];
  const put = (rel, content) => { const f = path.join(dirAbs, rel); if (fs.existsSync(f) && !overwrite) { skipped.push(rel); return; } fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); written.push(rel); };
  put('style.css', css({ ...pal, theme }).replace('__FONT__', FONT(lang)));
  put('main.js', js());
  const year = new Date().getFullYear();
  for (const p of norm) {
    const base = p.file.replace(/\.html$/, '');
    const data = p.kind === 'catalog' ? ['items'] : p.kind === 'dashboard' ? ['records'] : [];
    put(p.file, pageHtml({ title: p.title, siteName: name, lang, dir: dirTag, pages: norm, file: p.file, body: bodyFor(p.kind, { title: p.title, tagline: tagline || name, siteName: name }).replace('{file}', base), tagline: tagline || name, year, data }));
    put(base + '.js', pageJs(p.kind, base));
  }
  // data lives in data/<name>.js (window.SITE_DATA.<name>) so pages work from file:// too; a .json twin is kept for servers/APIs
  const putData = (name, rows) => { put(`data/${name}.js`, `// Edit this file to change the ${name} content (also mirrored in ${name}.json)\nwindow.SITE_DATA = window.SITE_DATA || {};\nwindow.SITE_DATA[${JSON.stringify(name)}] = ${JSON.stringify(rows, null, 2)};\n`); put(`data/${name}.json`, JSON.stringify(rows, null, 2)); };
  if (norm.some((p) => p.kind === 'catalog')) putData('items', [{ id: 1, name: 'TODO item 1', category: 'TODO', description: 'TODO', price: 10 }, { id: 2, name: 'TODO item 2', category: 'TODO', description: 'TODO', price: 20 }]);
  if (norm.some((p) => p.kind === 'dashboard')) putData('records', [{ name: 'TODO', value: 1, status: 'ok' }]);
  put('README.md', `# ${name}\n\n${tagline}\n\nStatic multi-page site (no build step). Open \`index.html\` in a browser or serve the folder.\n\n| Page | File | Script |\n|---|---|---|\n${norm.map((p) => `| ${p.title} | ${p.file} | ${p.file.replace(/\.html$/, '')}.js |`).join('\n')}\n\n- \`style.css\` — design tokens (\`:root\`) + layout, components, responsive rules\n- \`main.js\` — nav, active link, \`toast()\`, \`loadData(name)\` (data/*.json), \`cart\` (localStorage), form validation (\`<form data-validate>\`)\n- \`data/\` — content as \`<name>.js\` (window.SITE_DATA, works from file://) mirrored in \`<name>.json\`\n`);
  const todos = [];
  for (const rel of written) { if (/\.(html|js|json)$/.test(rel)) { const n = (fs.readFileSync(path.join(dirAbs, rel), 'utf8').match(/TODO/g) || []).length; if (n) todos.push(`${rel}: ${n}`); } }
  return { dir: path.relative(root, dirAbs).replace(/\\/g, '/') || '.', pages: norm.map((p) => ({ title: p.title, file: p.file, kind: p.kind })), written, skipped, todo_markers: todos, next: 'Replace every TODO with real content (edit_file), fill data/*.json, extend the page scripts, then browser_check each page.' };
}

module.exports = { scaffold, kindOf, PALETTES };
