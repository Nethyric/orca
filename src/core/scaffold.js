'use strict';
// scaffold_site v2: a complete, modern multi-page website in one or a few calls.
//
// The model passes REAL CONTENT per section (hero, features, catalog items, pricing, FAQ, testimonials, contact …)
// and gets back finished pages — no TODO markers to hunt down afterwards. Header/nav/footer are rendered at runtime
// from data/site.js, so pages can be added or rewritten in later calls and navigation stays consistent everywhere.
// Offline, zero dependencies, RTL-aware, dark/light with a toggle, responsive, reveal-on-scroll, cart + form validation.
const fs = require('fs');
const path = require('path');

const RTL = new Set(['fa', 'ar', 'he', 'ur']);
const PALETTES = {
  indigo: { accent: '#5e6ad2', accent2: '#8b93ff', glow: '#6366f1' }, violet: { accent: '#7c3aed', accent2: '#a78bfa', glow: '#8b5cf6' }, cyan: { accent: '#0891b2', accent2: '#22d3ee', glow: '#06b6d4' },
  emerald: { accent: '#059669', accent2: '#34d399', glow: '#10b981' }, amber: { accent: '#d97706', accent2: '#fbbf24', glow: '#f59e0b' }, rose: { accent: '#e11d48', accent2: '#fb7185', glow: '#f43f5e' },
  slate: { accent: '#334155', accent2: '#64748b', glow: '#475569' }, gold: { accent: '#b45309', accent2: '#f5c242', glow: '#d4a017' }, teal: { accent: '#0f766e', accent2: '#2dd4bf', glow: '#14b8a6' },
};
const FONT = (lang) => (lang === 'fa' || lang === 'ar' ? "'Vazirmatn', 'Segoe UI', Tahoma, sans-serif" : lang === 'zh' ? "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif" : lang === 'ru' ? "'Inter', 'Segoe UI', Roboto, sans-serif" : "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif");
const GFONT = (lang) => (lang === 'fa' || lang === 'ar' ? 'Vazirmatn:wght@400;500;700;800' : lang === 'zh' ? 'Noto+Sans+SC:wght@400;500;700' : 'Inter:wght@400;500;600;700;800');
// '۱,۲۰۰,۰۰۰' / '1.200.000 تومان' / '$49' → 1200000 / 49 (a plain number renders with the site currency and works in the cart);
// anything without digits, or a range like '۵۰۰–۹۰۰', is kept verbatim.
const normPrice = (v) => {
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  if (/\d\s*[-–]\s*\d/.test(s)) return v;
  const m = s.replace(/[,\s\u066C\u200c]/g, '').replace(/(\d)\.(\d{3})(?=\.|$|[^\d.])/g, '$1$2').replace(/(\d)\.(\d{3})(?=\.|$|[^\d.])/g, '$1$2').match(/-?\d+(?:\.\d+)?/);
  if (!m) return v;
  const rest = s.replace(/[\d.,\s\u066C\u200c]/g, '');
  const knownUnit = /^(تومان|ریال|\$|€|£|₽|¥|元|usd|eur|rub|cny|irr|irt)$/i.test(rest);
  return rest && !knownUnit ? v : Number(m[0]);
};
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9\u0600-\u06FF\u0400-\u04FF\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const L2 = (lang) => String(lang || 'en').slice(0, 2).toLowerCase();

// UI strings that the scaffold itself needs (buttons the model did not name, form messages, footer)
const T = {
  en: { home: 'Home', menu: 'Menu', more: 'Learn more', contact: 'Contact us', send: 'Send message', sent: 'Thanks — we received your message.', name: 'Full name', email: 'Email', phone: 'Phone', message: 'Message', required: 'This field is required', badEmail: 'Enter a valid email', minChars: 'At least {n} characters', add: 'Add to cart', added: 'Added to cart', cart: 'Cart', empty: 'Your cart is empty.', total: 'Total', checkout: 'Checkout', remove: 'Remove', qty: 'Qty', item: 'Item', price: 'Price', continueShopping: 'Continue shopping', ordered: 'Order placed — thank you!', rights: 'All rights reserved.', madeWith: 'Built with care', theme: 'Toggle theme', top: 'Back to top', navToggle: 'Menu', search: 'Search…', all: 'All', perMonth: '/ month', choose: 'Choose', popular: 'Most popular', readMore: 'Read more', hours: 'Opening hours', address: 'Address', follow: 'Follow us', quickLinks: 'Pages', noResults: 'Nothing found.' },
  fa: { home: 'خانه', menu: 'منو', more: 'بیشتر بدانید', contact: 'تماس با ما', send: 'ارسال پیام', sent: 'ممنون — پیام شما دریافت شد.', name: 'نام و نام خانوادگی', email: 'ایمیل', phone: 'شماره تماس', message: 'پیام', required: 'این فیلد الزامی است', badEmail: 'ایمیل معتبر وارد کنید', minChars: 'حداقل {n} کاراکتر', add: 'افزودن به سبد', added: 'به سبد اضافه شد', cart: 'سبد خرید', empty: 'سبد خرید شما خالی است.', total: 'جمع کل', checkout: 'ثبت سفارش', remove: 'حذف', qty: 'تعداد', item: 'کالا', price: 'قیمت', continueShopping: 'ادامهٔ خرید', ordered: 'سفارش ثبت شد — سپاسگزاریم!', rights: 'تمامی حقوق محفوظ است.', madeWith: 'با دقت ساخته شده', theme: 'تغییر تم', top: 'بازگشت به بالا', navToggle: 'منو', search: 'جست‌وجو…', all: 'همه', perMonth: '/ ماهانه', choose: 'انتخاب', popular: 'محبوب‌ترین', readMore: 'ادامه مطلب', hours: 'ساعات کاری', address: 'آدرس', follow: 'ما را دنبال کنید', quickLinks: 'صفحات', noResults: 'چیزی پیدا نشد.' },
  ru: { home: 'Главная', menu: 'Меню', more: 'Подробнее', contact: 'Связаться', send: 'Отправить', sent: 'Спасибо — сообщение получено.', name: 'Имя', email: 'Email', phone: 'Телефон', message: 'Сообщение', required: 'Обязательное поле', badEmail: 'Введите корректный email', minChars: 'Минимум {n} символов', add: 'В корзину', added: 'Добавлено в корзину', cart: 'Корзина', empty: 'Корзина пуста.', total: 'Итого', checkout: 'Оформить', remove: 'Удалить', qty: 'Кол-во', item: 'Товар', price: 'Цена', continueShopping: 'Продолжить покупки', ordered: 'Заказ оформлен — спасибо!', rights: 'Все права защищены.', madeWith: 'Сделано с заботой', theme: 'Сменить тему', top: 'Наверх', navToggle: 'Меню', search: 'Поиск…', all: 'Все', perMonth: '/ месяц', choose: 'Выбрать', popular: 'Популярный', readMore: 'Читать далее', hours: 'Часы работы', address: 'Адрес', follow: 'Мы в соцсетях', quickLinks: 'Страницы', noResults: 'Ничего не найдено.' },
  zh: { home: '首页', menu: '菜单', more: '了解更多', contact: '联系我们', send: '发送', sent: '感谢 — 我们已收到您的留言。', name: '姓名', email: '邮箱', phone: '电话', message: '留言', required: '此项为必填', badEmail: '请输入有效邮箱', minChars: '至少 {n} 个字符', add: '加入购物车', added: '已加入购物车', cart: '购物车', empty: '购物车是空的。', total: '合计', checkout: '结算', remove: '删除', qty: '数量', item: '商品', price: '价格', continueShopping: '继续购物', ordered: '订单已提交 — 谢谢！', rights: '版权所有。', madeWith: '用心打造', theme: '切换主题', top: '回到顶部', navToggle: '菜单', search: '搜索…', all: '全部', perMonth: '/ 月', choose: '选择', popular: '最受欢迎', readMore: '阅读更多', hours: '营业时间', address: '地址', follow: '关注我们', quickLinks: '页面', noResults: '没有找到。' },
};
const tr = (lang) => T[L2(lang)] || T.en;

// ───────────────────────── CSS ─────────────────────────
function css({ accent, accent2, glow, theme, lang }) {
  const dark = theme !== 'light';
  return `/* Design tokens — change these first; every page reads them. Theme toggles by [data-theme] on <html>. */
:root{--accent:${accent};--accent-2:${accent2};--glow:${glow};--radius:16px;--radius-sm:10px;--maxw:1180px;--font:${FONT(lang)};--ease:cubic-bezier(.2,.7,.2,1)}
:root,[data-theme=dark]{--bg:#0b0d12;--bg-2:#11141c;--bg-3:#181c27;--card:rgba(255,255,255,.035);--text:#f4f6fb;--text-2:#a5adbd;--text-3:#6b7385;--line:rgba(255,255,255,.08);--shadow:0 20px 60px rgba(0,0,0,.45);--ok:#22c55e;--warn:#f59e0b;--bad:#ef4444;color-scheme:dark}
[data-theme=light]{--bg:#ffffff;--bg-2:#f6f7fb;--bg-3:#eceef5;--card:rgba(0,0,0,.025);--text:#0f1220;--text-2:#4b5265;--text-3:#8a90a3;--line:rgba(15,18,32,.09);--shadow:0 20px 60px rgba(15,18,32,.10);color-scheme:light}
${dark ? '' : ':root{--bg:#ffffff;--bg-2:#f6f7fb;--bg-3:#eceef5;--card:rgba(0,0,0,.025);--text:#0f1220;--text-2:#4b5265;--text-3:#8a90a3;--line:rgba(15,18,32,.09);--shadow:0 20px 60px rgba(15,18,32,.10);color-scheme:light}'}
*{box-sizing:border-box}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;font-family:var(--font);background:var(--bg);color:var(--text);line-height:1.7;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:var(--accent-2);text-decoration:none}a:hover{text-decoration:underline}
img,video{max-width:100%;display:block}
h1,h2,h3,h4{line-height:1.2;margin:0 0 .5em;letter-spacing:-.015em;font-weight:800}
h2{font-size:clamp(1.6rem,3.2vw,2.4rem)}h3{font-size:1.15rem;font-weight:700}
p{margin:0 0 1em}
.container{max-width:var(--maxw);margin:0 auto;padding:0 22px}
.lead{font-size:1.12rem;color:var(--text-2);max-width:720px}
.center{text-align:center}.center .lead{margin-inline:auto}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:.8rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent-2);margin-bottom:12px}
.eyebrow::before{content:"";width:22px;height:2px;background:var(--accent-2);border-radius:2px}
.badge{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;font-size:.78rem;font-weight:600;background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent-2);border:1px solid color-mix(in srgb,var(--accent) 35%,transparent)}
.mt{margin-top:18px}.grow{flex:1}
/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 22px;border-radius:var(--radius-sm);border:1px solid var(--line);background:var(--bg-3);color:var(--text);font:inherit;font-weight:600;cursor:pointer;transition:transform .2s var(--ease),background .2s,box-shadow .2s,border-color .2s;white-space:nowrap}
.btn:hover{transform:translateY(-2px);text-decoration:none;border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
.btn.primary{background:linear-gradient(135deg,var(--accent),var(--accent-2));border-color:transparent;color:#fff;box-shadow:0 10px 30px color-mix(in srgb,var(--glow) 35%,transparent)}
.btn.primary:hover{box-shadow:0 14px 40px color-mix(in srgb,var(--glow) 50%,transparent)}
.btn.ghost{background:transparent}.btn.lg{padding:15px 30px;font-size:1.05rem;border-radius:14px}.btn.sm{padding:8px 14px;font-size:.9rem}.btn.block{width:100%}
.btn svg{width:18px;height:18px}
/* header */
.site-header{position:sticky;top:0;z-index:50;backdrop-filter:blur(14px) saturate(1.4);-webkit-backdrop-filter:blur(14px) saturate(1.4);background:color-mix(in srgb,var(--bg) 78%,transparent);border-bottom:1px solid var(--line)}
.site-header .container{display:flex;align-items:center;justify-content:space-between;height:68px;gap:16px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:1.15rem;color:var(--text)}.brand:hover{text-decoration:none}
.brand .logo{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,var(--accent),var(--accent-2));display:grid;place-items:center;color:#fff;font-weight:800;font-size:.95rem;box-shadow:0 6px 18px color-mix(in srgb,var(--glow) 40%,transparent)}
.nav{display:flex;gap:2px;align-items:center}
.nav a{padding:8px 13px;border-radius:10px;color:var(--text-2);font-weight:500;font-size:.95rem;transition:background .2s,color .2s}
.nav a:hover,.nav a.active{color:var(--text);background:var(--bg-3);text-decoration:none}
.header-actions{display:flex;align-items:center;gap:8px}
.icon-btn{display:grid;place-items:center;width:40px;height:40px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--text);cursor:pointer;font:inherit;position:relative;transition:background .2s}
.icon-btn:hover{background:var(--bg-3)}.icon-btn svg{width:18px;height:18px}
.cart-count{position:absolute;top:-6px;inset-inline-end:-6px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--accent);color:#fff;font-size:.7rem;font-weight:700;display:grid;place-items:center}
.cart-count:empty,.cart-count[data-n="0"]{display:none}
.nav-toggle{display:none}
/* hero */
.hero{position:relative;padding:110px 0 90px;overflow:hidden;isolation:isolate}
.hero .blob{position:absolute;z-index:-1;filter:blur(70px);opacity:.55;border-radius:50%;pointer-events:none;animation:float 14s ease-in-out infinite}
.hero .blob.a{width:520px;height:520px;background:var(--accent);top:-180px;inset-inline-start:-120px}
.hero .blob.b{width:420px;height:420px;background:var(--accent-2);bottom:-160px;inset-inline-end:-100px;animation-delay:-6s}
.hero .grid-bg{position:absolute;inset:0;z-index:-2;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:44px 44px;mask-image:radial-gradient(ellipse at center,#000 30%,transparent 75%);-webkit-mask-image:radial-gradient(ellipse at center,#000 30%,transparent 75%)}
@keyframes float{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(30px,-24px) scale(1.06)}}
.hero h1{font-size:clamp(2.3rem,5.6vw,4rem);line-height:1.1;margin:14px 0 18px;letter-spacing:-.03em}
.hero h1 .accent{background:linear-gradient(135deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{font-size:1.22rem;color:var(--text-2);max-width:700px;margin:0 auto 32px}
.hero .actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.hero.split .container{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center;text-align:start}
.hero.split p,.hero.split .actions{margin-inline:0;justify-content:flex-start}
.hero .visual{aspect-ratio:4/3;border-radius:24px;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 60%,transparent),color-mix(in srgb,var(--accent-2) 60%,transparent));box-shadow:var(--shadow);display:grid;place-items:center;overflow:hidden;position:relative}
.hero .visual img{width:100%;height:100%;object-fit:cover}
.hero .visual svg{width:38%;height:38%;color:#fff;opacity:.9}
.hero .trust{display:flex;gap:18px;flex-wrap:wrap;justify-content:center;margin-top:28px;color:var(--text-3);font-size:.9rem}
.hero .trust span{display:inline-flex;align-items:center;gap:6px}.hero .trust svg{width:16px;height:16px;color:var(--ok)}
/* sections */
.section{padding:84px 0}.section.alt{background:var(--bg-2)}.section.tight{padding:56px 0}
.section-head{margin-bottom:40px}
.grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fit,minmax(min(100%,270px),1fr))}
.grid.cols-2{grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))}
.grid.cols-4{grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:26px;transition:transform .25s var(--ease),border-color .25s,box-shadow .25s;position:relative;overflow:hidden}
.card:hover{transform:translateY(-4px);border-color:color-mix(in srgb,var(--accent) 40%,var(--line));box-shadow:var(--shadow)}
.card .icon{width:46px;height:46px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent-2);margin-bottom:16px}
.card .icon svg{width:22px;height:22px}
.card p:last-child{margin-bottom:0}.card .muted{color:var(--text-2)}
.card .media{aspect-ratio:4/3;border-radius:12px;margin:-8px -8px 16px;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 45%,var(--bg-3)),color-mix(in srgb,var(--accent-2) 45%,var(--bg-3)));display:grid;place-items:center;color:#fff;font-size:2.4rem;font-weight:800;overflow:hidden}
.card .media img{width:100%;height:100%;object-fit:cover}
.card .price{font-weight:800;font-size:1.2rem;color:var(--accent-2)}
.card .row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px}
.card .tag{font-size:.75rem;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em}
/* stats */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:16px}
.stat{text-align:center;padding:26px 16px;border-radius:var(--radius);background:var(--card);border:1px solid var(--line)}
.stat b{display:block;font-size:2.2rem;font-weight:800;background:linear-gradient(135deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent;line-height:1.1}
.stat span{color:var(--text-2);font-size:.95rem}
/* steps */
.steps{counter-reset:step}
.step{position:relative;padding-inline-start:64px}
.step::before{counter-increment:step;content:counter(step);position:absolute;inset-inline-start:0;top:0;width:44px;height:44px;border-radius:12px;display:grid;place-items:center;font-weight:800;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff}
/* testimonials */
.quote{font-size:1.05rem;color:var(--text);margin:0 0 18px}
.quote::before{content:"“";font-size:2.6rem;line-height:0;color:var(--accent-2);vertical-align:-14px;margin-inline-end:4px;font-family:Georgia,serif}
.person{display:flex;align-items:center;gap:12px}
.avatar{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent-2));display:grid;place-items:center;color:#fff;font-weight:700;flex:none}
.person b{display:block;line-height:1.2}.person span{color:var(--text-3);font-size:.85rem}
.stars{color:#f5b642;letter-spacing:2px;font-size:.9rem;margin-bottom:10px}
/* pricing */
.plan{display:flex;flex-direction:column;gap:16px}
.plan.featured{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent),var(--shadow)}
.plan .ribbon{position:absolute;top:16px;inset-inline-end:16px}
.plan .amount{font-size:2.4rem;font-weight:800;letter-spacing:-.03em}.plan .amount small{font-size:.9rem;color:var(--text-3);font-weight:500;letter-spacing:0}
.plan ul{list-style:none;margin:0;padding:0;display:grid;gap:10px;color:var(--text-2)}
.plan li{display:flex;gap:10px;align-items:flex-start}.plan li svg{width:18px;height:18px;color:var(--ok);flex:none;margin-top:4px}
.plan .btn{margin-top:auto}
/* faq */
.faq{max-width:820px;margin:0 auto;display:grid;gap:10px}
.faq details{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:0 22px;transition:border-color .2s}
.faq details[open]{border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
.faq summary{cursor:pointer;list-style:none;padding:18px 0;font-weight:600;display:flex;justify-content:space-between;align-items:center;gap:12px}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";font-size:1.4rem;color:var(--accent-2);transition:transform .2s;line-height:1}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq details p{color:var(--text-2);margin:0 0 18px}
/* gallery */
.gallery{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr))}
.gallery figure{margin:0;aspect-ratio:1;border-radius:14px;overflow:hidden;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 50%,var(--bg-3)),color-mix(in srgb,var(--accent-2) 50%,var(--bg-3)));position:relative;display:grid;place-items:center;color:#fff;font-weight:700}
.gallery figure img{width:100%;height:100%;object-fit:cover;transition:transform .5s var(--ease)}
.gallery figure:hover img{transform:scale(1.06)}
.gallery figcaption{position:absolute;inset-inline:0;bottom:0;padding:10px 14px;background:linear-gradient(transparent,rgba(0,0,0,.65));font-size:.88rem;font-weight:500}
/* cta band */
.cta-band{border-radius:24px;padding:56px 40px;text-align:center;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 85%,#000),color-mix(in srgb,var(--accent-2) 85%,#000));color:#fff;box-shadow:var(--shadow);position:relative;overflow:hidden}
.cta-band::after{content:"";position:absolute;width:420px;height:420px;border-radius:50%;background:rgba(255,255,255,.12);top:-260px;inset-inline-end:-140px}
.cta-band h2{color:#fff}.cta-band p{color:rgba(255,255,255,.85);max-width:640px;margin:0 auto 26px}
.cta-band .btn.primary{background:#fff;color:var(--accent);box-shadow:none}
/* forms */
.form{display:grid;gap:14px;max-width:720px}
.form .row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.form label{display:grid;gap:6px;font-weight:600;font-size:.92rem}
.form input,.form textarea,.form select{font:inherit;padding:13px 14px;border-radius:var(--radius-sm);border:1px solid var(--line);background:var(--bg-2);color:var(--text);width:100%;transition:border-color .2s,box-shadow .2s}
.form input:focus,.form textarea:focus,.form select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 18%,transparent)}
.form .error{color:var(--bad);font-size:.82rem;font-weight:500}.form input.invalid,.form textarea.invalid{border-color:var(--bad)}
.contact-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:40px;align-items:start}
.info-list{display:grid;gap:14px}.info-list .card{display:flex;gap:14px;align-items:flex-start;padding:18px}
.info-list .card .icon{margin:0;flex:none}.info-list b{display:block}.info-list span{color:var(--text-2)}
/* tables / cart */
.table{width:100%;border-collapse:collapse}.table th,.table td{padding:14px 12px;border-bottom:1px solid var(--line);text-align:start}.table th{color:var(--text-2);font-weight:600;font-size:.88rem}
.qty-btn{width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:var(--bg-3);color:var(--text);cursor:pointer;font:inherit}
.cart-summary{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-top:22px;padding:20px;border-radius:var(--radius);background:var(--card);border:1px solid var(--line)}
/* filters */
.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:26px;align-items:center}
.chip{padding:8px 16px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--text-2);font:inherit;font-weight:500;cursor:pointer;transition:all .2s}
.chip.active,.chip:hover{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--text);border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
.filters input{font:inherit;padding:9px 14px;border-radius:999px;border:1px solid var(--line);background:var(--bg-2);color:var(--text);min-width:200px;margin-inline-start:auto}
/* prose / about */
.prose{max-width:780px;color:var(--text-2);font-size:1.05rem}.prose h3{color:var(--text);margin-top:1.6em}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}
.two-col .visual{aspect-ratio:4/3;border-radius:22px;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 55%,var(--bg-3)),color-mix(in srgb,var(--accent-2) 55%,var(--bg-3)));display:grid;place-items:center;overflow:hidden;box-shadow:var(--shadow)}
.two-col .visual img{width:100%;height:100%;object-fit:cover}.two-col .visual svg{width:34%;height:34%;color:#fff;opacity:.9}
/* footer */
.site-footer{border-top:1px solid var(--line);padding:56px 0 28px;background:var(--bg-2);color:var(--text-2)}
.footer-grid{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:40px;margin-bottom:36px}
.site-footer h4{color:var(--text);font-size:.95rem;margin-bottom:14px}
.site-footer ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}.site-footer a{color:var(--text-2)}.site-footer a:hover{color:var(--text)}
.social{display:flex;gap:8px;margin-top:14px}
.footer-bottom{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding-top:22px;border-top:1px solid var(--line);font-size:.88rem;color:var(--text-3)}
/* misc */
.toast{position:fixed;bottom:24px;inset-inline-start:50%;transform:translate(-50%,20px);background:var(--text);color:var(--bg);padding:12px 20px;border-radius:12px;font-weight:600;opacity:0;transition:all .3s var(--ease);z-index:100;box-shadow:var(--shadow);pointer-events:none}
[dir=rtl] .toast{transform:translate(50%,20px)}
.toast.show{opacity:1;transform:translate(-50%,0)}[dir=rtl] .toast.show{transform:translate(50%,0)}
#to-top{position:fixed;bottom:24px;inset-inline-end:24px;opacity:0;pointer-events:none;transition:opacity .3s;z-index:40;background:var(--bg-3)}
#to-top.show{opacity:1;pointer-events:auto}
.reveal{opacity:0;transform:translateY(22px);transition:opacity .7s var(--ease),transform .7s var(--ease)}
.reveal.in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;transition:none}.hero .blob{animation:none}}
.empty{padding:36px;text-align:center;color:var(--text-3);border:1px dashed var(--line);border-radius:var(--radius)}
kbd{font-family:ui-monospace,Menlo,monospace;font-size:.85em;padding:2px 6px;border-radius:6px;border:1px solid var(--line);background:var(--bg-3)}
/* responsive */
@media (max-width:900px){
  .hero.split .container,.two-col,.contact-grid{grid-template-columns:1fr}
  .footer-grid{grid-template-columns:1fr 1fr}
  .nav-toggle{display:grid}
  .nav{position:fixed;inset:68px 0 auto 0;flex-direction:column;align-items:stretch;padding:12px 16px 18px;background:var(--bg);border-bottom:1px solid var(--line);transform:translateY(-8px);opacity:0;pointer-events:none;transition:all .25s var(--ease);box-shadow:var(--shadow)}
  .nav.open{transform:none;opacity:1;pointer-events:auto}
  .nav a{padding:13px 14px;font-size:1.02rem}
  .hero{padding:72px 0 60px}.section{padding:60px 0}
}
@media (max-width:560px){.form .row{grid-template-columns:1fr}.footer-grid{grid-template-columns:1fr}.cta-band{padding:40px 22px}.hero .actions .btn{width:100%}}
`;
}

// ───────────────────────── JS (runtime: nav, footer, icons, cart, forms, reveal, theme) ─────────────────────────
function mainJs(lang) {
  const t = tr(lang);
  return `/* main.js — runtime shared by every page. Header/nav/footer come from data/site.js (window.SITE). */
(function () {
  'use strict';
  const SITE = window.SITE || { name: 'Site', pages: [] };
  const T = ${JSON.stringify(t)};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const ICONS = {
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>', heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>', check: '<path d="M20 6 9 17l-5-5"/>', bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>', shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>', phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2z"/>', mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 7L2 7"/>', coffee: '<path d="M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M6 2v2M10 2v2M14 2v2"/>', cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>', truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>', leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>', sparkle: '<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/>', users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>', award: '<circle cx="12" cy="8" r="6"/><path d="M15.5 13 17 22l-5-3-5 3 1.5-9"/>', globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>', code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>', camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>', music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>', book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>', gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>', menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', up: '<path d="m18 15-6-6-6 6"/>', arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', instagram: '<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>', telegram: '<path d="m22 2-7 20-4-9-9-4z"/><path d="m22 2-11 11"/>', whatsapp: '<path d="M3 21l1.7-4.1A9 9 0 1 1 8.2 20.2z"/><path d="M9 10a4 4 0 0 0 5 5l1-1-2-1-1 1a3 3 0 0 1-2-2l1-1-1-2z"/>', home: '<path d="m3 11 9-8 9 8v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"/>', tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/>', trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>', lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', rocket: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2 0-2.8a2 2 0 0 0-3-.2z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.9 12.9 0 0 1 22 2c0 2.72-.78 7.5-6 11a22 22 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>', chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 4 4 5-6"/>', cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>', smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>', map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>', calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>', scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>', dumbbell: '<path d="M6.5 6.5 17.5 17.5M21 21l-1-1M3 3l1 1M18 22l4-4M2 6l4-4M3 10l7-7M14 21l7-7"/>', car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>', wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>', utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
  };
  const svg = (name, extra = '') => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' + extra + '>' + (ICONS[name] || ICONS.sparkle) + '</svg>';
  window.icon = svg;
  // ---- header / footer ----
  const cartEnabled = SITE.pages.some((p) => p.kind === 'cart');
  const cartPage = (SITE.pages.find((p) => p.kind === 'cart') || {}).file || 'cart.html';
  const header = document.getElementById('site-header');
  if (header) header.innerHTML = '<div class="container"><a class="brand" href="index.html"><span class="logo">' + (SITE.logoText || (SITE.name || 'S').trim().charAt(0)) + '</span>' + esc(SITE.name) + '</a><nav class="nav" id="nav">' + SITE.pages.filter((p) => p.nav !== false).map((p) => '<a href="' + p.file + '"' + (p.file.toLowerCase() === here ? ' class="active"' : '') + '>' + esc(p.title) + '</a>').join('') + '</nav><div class="header-actions">' + (cartEnabled ? '<a class="icon-btn" href="' + cartPage + '" aria-label="' + T.cart + '">' + svg('cart') + '<span class="cart-count" id="cart-count"></span></a>' : '') + '<button class="icon-btn" id="theme-toggle" aria-label="' + T.theme + '">' + svg('sun') + '</button><button class="icon-btn nav-toggle" id="nav-toggle" aria-label="' + T.navToggle + '">' + svg('menu') + '</button></div></div>';
  const footer = document.getElementById('site-footer');
  if (footer) {
    const f = SITE.footer || {};
    footer.innerHTML = '<div class="container"><div class="footer-grid"><div><a class="brand" href="index.html"><span class="logo">' + (SITE.logoText || (SITE.name || 'S').trim().charAt(0)) + '</span>' + esc(SITE.name) + '</a><p class="mt">' + esc(f.about || SITE.tagline || '') + '</p>' + (Array.isArray(f.social) && f.social.length ? '<div class="social">' + f.social.map((s) => '<a class="icon-btn" href="' + esc(s.url || '#') + '" target="_blank" rel="noopener" aria-label="' + esc(s.name) + '">' + svg((s.icon || s.name || '').toLowerCase()) + '</a>').join('') + '</div>' : '') + '</div><div><h4>' + T.quickLinks + '</h4><ul>' + SITE.pages.filter((p) => p.nav !== false).map((p) => '<li><a href="' + p.file + '">' + esc(p.title) + '</a></li>').join('') + '</ul></div><div><h4>' + T.contact + '</h4><ul>' + [f.address ? svg('pin', 'width="14" height="14" style="vertical-align:-2px;margin-inline-end:6px"') + esc(f.address) : '', f.phone ? svg('phone', 'width="14" height="14" style="vertical-align:-2px;margin-inline-end:6px"') + '<a href="tel:' + esc(String(f.phone).replace(/\\s/g, '')) + '" dir="ltr">' + esc(f.phone) + '</a>' : '', f.email ? svg('mail', 'width="14" height="14" style="vertical-align:-2px;margin-inline-end:6px"') + '<a href="mailto:' + esc(f.email) + '">' + esc(f.email) + '</a>' : '', f.hours ? svg('clock', 'width="14" height="14" style="vertical-align:-2px;margin-inline-end:6px"') + esc(f.hours) : ''].filter(Boolean).map((x) => '<li>' + x + '</li>').join('') + '</ul></div></div><div class="footer-bottom"><span>© ' + new Date().getFullYear() + ' ' + esc(SITE.name) + ' — ' + T.rights + '</span><span>' + esc(f.note || T.madeWith) + '</span></div></div>';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  window.esc = esc;
  // icons declared in HTML: <i data-icon="coffee"></i>
  $$('[data-icon]').forEach((el) => { el.innerHTML = svg(el.dataset.icon); });
  // ---- mobile nav ----
  const nav = $('#nav'), navT = $('#nav-toggle');
  if (navT) navT.onclick = () => { const open = nav.classList.toggle('open'); navT.innerHTML = svg(open ? 'x' : 'menu'); };
  // ---- theme ----
  const root = document.documentElement;
  const saved = localStorage.getItem('theme'); if (saved) root.dataset.theme = saved;
  const paintTheme = () => { const b = $('#theme-toggle'); if (b) b.innerHTML = svg((root.dataset.theme || SITE.theme || 'dark') === 'dark' ? 'sun' : 'moon'); };
  paintTheme();
  const tt = $('#theme-toggle'); if (tt) tt.onclick = () => { root.dataset.theme = (root.dataset.theme || SITE.theme || 'dark') === 'dark' ? 'light' : 'dark'; localStorage.setItem('theme', root.dataset.theme); paintTheme(); };
  // ---- toast ----
  let toastEl;
  window.toast = (msg) => { if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); } toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 2400); };
  // ---- data loader: window.SITE_DATA (data/*.js) first, JSON fallback ----
  window.loadData = async (name) => { if (window.SITE_DATA && window.SITE_DATA[name]) return window.SITE_DATA[name]; try { const r = await fetch('data/' + name + '.json'); if (r.ok) return await r.json(); } catch (_) {} return []; };
  // ---- number/price formatting ----
  const localeOf = { fa: 'fa-IR', ru: 'ru-RU', zh: 'zh-CN' }[document.documentElement.lang] || 'en-US';
  window.fmtPrice = (n, unit) => { const u = unit || SITE.currency || ''; const s = Number(n).toLocaleString(localeOf); return document.documentElement.dir === 'rtl' ? s + ' ' + u : (u.length <= 1 ? u + s : s + ' ' + u); };
  // ---- cart (localStorage) ----
  const CK = 'cart:' + (SITE.name || '');
  const cart = {
    items: JSON.parse(localStorage.getItem(CK) || '[]'),
    save() { localStorage.setItem(CK, JSON.stringify(this.items)); this.paint(); },
    add(it) { const f = this.items.find((x) => x.id === it.id); if (f) f.qty++; else this.items.push({ id: it.id, name: it.name, price: +it.price || 0, qty: 1 }); this.save(); toast(T.added + ' · ' + it.name); },
    set(id, qty) { const f = this.items.find((x) => x.id === id); if (!f) return; f.qty = qty; if (f.qty <= 0) this.items = this.items.filter((x) => x.id !== id); this.save(); },
    remove(id) { this.items = this.items.filter((x) => x.id !== id); this.save(); },
    clear() { this.items = []; this.save(); },
    total() { return this.items.reduce((a, x) => a + x.price * x.qty, 0); },
    count() { return this.items.reduce((a, x) => a + x.qty, 0); },
    paint() { const c = $('#cart-count'); if (c) { c.textContent = this.count() || ''; c.dataset.n = this.count(); } },
  };
  cart.paint(); window.cart = cart; window.T = T;
  // ---- forms with validation ----
  $$('form[data-validate]').forEach((form) => {
    form.noValidate = true;
    form.addEventListener('submit', (e) => {
      e.preventDefault(); let ok = true;
      $$('.error', form).forEach((x) => x.remove());
      $$('input,textarea,select', form).forEach((inp) => {
        inp.classList.remove('invalid'); let msg = '';
        if (inp.required && !inp.value.trim()) msg = T.required;
        else if (inp.type === 'email' && inp.value && !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(inp.value)) msg = T.badEmail;
        else if (inp.minLength > 0 && inp.value.length < inp.minLength) msg = T.minChars.replace('{n}', inp.minLength);
        if (msg) { ok = false; inp.classList.add('invalid'); const er = document.createElement('div'); er.className = 'error'; er.textContent = msg; inp.closest('label') ? inp.closest('label').appendChild(er) : inp.after(er); }
      });
      if (!ok) return;
      const data = Object.fromEntries(new FormData(form).entries());
      const key = 'submissions:' + (form.id || 'form'); const all = JSON.parse(localStorage.getItem(key) || '[]'); all.push({ ...data, at: new Date().toISOString() }); localStorage.setItem(key, JSON.stringify(all));
      toast(form.dataset.success || T.sent); form.reset();
      form.dispatchEvent(new CustomEvent('submitted', { detail: data }));
    });
  });
  // ---- reveal on scroll ----
  const targets = $$('.section .card, .section .stat, .section .step, .hero h1, .hero p, .hero .actions, .gallery figure, .faq details, .section-head, .cta-band, .two-col > *');
  targets.forEach((el) => el.classList.add('reveal'));
  if ('IntersectionObserver' in window) { const io = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: .12 }); targets.forEach((el) => io.observe(el)); }
  else targets.forEach((el) => el.classList.add('in'));
  // ---- counters ----
  $$('.stat b[data-count]').forEach((b) => { const end = +b.dataset.count; const suffix = b.dataset.suffix || ''; const t0 = performance.now(); const tick = (t) => { const k = Math.min(1, (t - t0) / 1400); b.textContent = Math.round(end * (1 - Math.pow(1 - k, 3))).toLocaleString(localeOf) + suffix; if (k < 1) requestAnimationFrame(tick); }; const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { requestAnimationFrame(tick); io.disconnect(); } }); io.observe(b); });
  // ---- back to top ----
  const up = document.createElement('button'); up.id = 'to-top'; up.className = 'icon-btn'; up.innerHTML = svg('up'); up.setAttribute('aria-label', T.top); up.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' }); document.body.appendChild(up);
  addEventListener('scroll', () => up.classList.toggle('show', scrollY > 600), { passive: true });
})();
`;
}

// ───────────────────────── section renderers ─────────────────────────
const ICON_FOR = (i, fallback = ['sparkle', 'bolt', 'shield', 'heart', 'star', 'award']) => fallback[i % fallback.length];
const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const str = (x, d = '') => (x == null ? d : String(x));
const btn = (b, cls = 'btn primary lg') => { if (!b) return ''; const o = typeof b === 'string' ? { label: b, href: '#' } : b; return `<a class="${cls}" href="${esc(o.href || '#')}">${esc(o.label || o.text || '')}</a>`; };
const head = (s, center = true) => (s.title || s.lead || s.eyebrow ? `<div class="section-head${center ? ' center' : ''}">${s.eyebrow ? `<div class="eyebrow">${esc(s.eyebrow)}</div>` : ''}${s.title ? `<h2>${rich(s.title)}</h2>` : ''}${s.lead ? `<p class="lead">${rich(s.lead)}</p>` : ''}</div>` : '');
const initial = (s) => esc(String(s || '?').trim().charAt(0));

// A section that arrived without `type` (models forget it) — infer from its shape so nothing degrades to plain text.
function inferType(s, i) {
  if (s.type) return String(s.type).toLowerCase();
  const it = arr(s.items)[0] || {};
  if (i === 0 && (s.primary || s.secondary || s.subtitle || s.badge || s.trust)) return 'hero';
  if (s.q || (it.q || it.question) && (it.a || it.answer)) return 'faq';
  if (it.quote) return 'testimonials';
  if (it.price != null && (it.features || it.period)) return 'pricing';
  if (it.price != null || it.category) return 'catalog';
  if (it.value != null && it.label) return 'stats';
  if (it.bio || (it.role && !it.quote && !it.text)) return 'team';
  if (s.fields || s.formId || s.submit) return 'contact';
  if (s.paragraphs) return 'text';
  if (arr(s.items).length) return 'features';
  if (s.primary && s.title) return 'cta';
  return 'text';
}
// **word** → gradient accent span (hero, headings); everything else escaped
const rich = (v) => esc(v).replace(/\*\*(.+?)\*\*/g, '<span class="accent">$1</span>');
function renderSection(s, ctx, index) {
  const t = ctx.t; const type = inferType(s, index);
  const alt = s.alt ? ' alt' : '';
  const id = s.id ? ` id="${esc(s.id)}"` : '';
  switch (type) {
    case 'hero': {
      const split = s.layout === 'split' || !!s.image;
      const title = rich(s.title || ctx.siteName);
      const trust = arr(s.trust).map((x) => `<span>${'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'}${esc(x)}</span>`).join('');
      return `<section class="hero${split ? ' split' : ''}"${id}><div class="blob a"></div><div class="blob b"></div><div class="grid-bg"></div><div class="container"><div>${s.eyebrow && !s.badge ? `<div class="eyebrow">${esc(s.eyebrow)}</div>` : ''}${s.badge ? `<span class="badge">${esc(s.badge)}</span>` : ''}<h1>${title}</h1>${s.subtitle || s.text ? `<p>${rich(s.subtitle || s.text)}</p>` : ''}<div class="actions">${btn(s.primary || (s.cta ? s.cta : null))}${btn(s.secondary, 'btn lg ghost')}</div>${trust ? `<div class="trust">${trust}</div>` : ''}</div>${split ? `<div class="visual">${s.image ? `<img src="${esc(s.image)}" alt="${esc(s.title || '')}">` : `<i data-icon="${esc(s.icon || 'sparkle')}"></i>`}</div>` : ''}</div></section>`;
    }
    case 'features': case 'services': case 'cards': {
      const items = arr(s.items).map((it, i) => `<article class="card">${it.image ? `<div class="media"><img src="${esc(it.image)}" alt="${esc(it.title)}"></div>` : `<div class="icon"><i data-icon="${esc(it.icon || ICON_FOR(i))}"></i></div>`}<h3>${esc(it.title || it.name)}</h3><p class="muted">${esc(it.text || it.description || '')}</p>${it.href ? `<a class="btn sm mt" href="${esc(it.href)}">${esc(it.link || t.more)}</a>` : ''}</article>`).join('');
      return `<section class="section${alt}"${id}><div class="container">${head(s)}<div class="grid${arr(s.items).length >= 4 ? ' cols-4' : ''}">${items}</div></div></section>`;
    }
    case 'stats': {
      const items = arr(s.items).map((raw) => { const isNum = (x) => /[\d۰-۹]/.test(String(x ?? '')); const it = !isNum(raw.value) && isNum(raw.label) ? { ...raw, value: raw.label, label: raw.value } : raw; const num = String(it.value ?? '').match(/^([\d.,]+)(.*)$/); return `<div class="stat"><b${num && !/[.,]\d{1,2}$/.test(num[1]) ? ` data-count="${num[1].replace(/,/g, '')}" data-suffix="${esc(num[2])}"` : ''}>${esc(it.value)}</b><span>${esc(it.label)}</span></div>`; }).join('');
      return `<section class="section tight${alt}"${id}><div class="container">${head(s)}<div class="stats">${items}</div></div></section>`;
    }
    case 'steps': case 'process': case 'how': {
      const items = arr(s.items).map((it) => `<article class="card step"><h3>${esc(it.title)}</h3><p class="muted">${esc(it.text || it.description || '')}</p></article>`).join('');
      return `<section class="section${alt}"${id}><div class="container">${head(s)}<div class="grid steps">${items}</div></div></section>`;
    }
    case 'catalog': case 'menu': case 'products': case 'shop': case 'portfolio': case 'courses': {
      const cats = [...new Set(arr(s.items).map((it) => it.category).filter(Boolean))];
      const dataName = s.data || ctx.dataName || 'items';
      return `<section class="section${alt}"${id}><div class="container">${head(s)}<div class="filters" id="filters-${esc(dataName)}"><button class="chip active" data-cat="">${t.all}</button>${cats.map((c) => `<button class="chip" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}<input type="search" placeholder="${t.search}" data-search="${esc(dataName)}"></div><div class="grid" id="catalog-${esc(dataName)}" data-catalog="${esc(dataName)}" data-add="${s.cart === false ? '0' : '1'}"></div></div></section>`;
    }
    case 'gallery': {
      const items = arr(s.items).map((it, i) => { const o = typeof it === 'string' ? { image: it } : it; return `<figure>${o.image ? `<img src="${esc(o.image)}" alt="${esc(o.caption || '')}" loading="lazy">` : `<span>${o.caption ? initial(o.caption) : i + 1}</span>`}${o.caption ? `<figcaption>${esc(o.caption)}</figcaption>` : ''}</figure>`; }).join('');
      return `<section class="section${alt}"${id}><div class="container">${head(s)}<div class="gallery">${items}</div></div></section>`;
    }
    case 'testimonials': case 'reviews': {
      const items = arr(s.items).map((it) => `<article class="card">${it.rating ? `<div class="stars">${'★'.repeat(Math.max(1, Math.min(5, +it.rating || 5)))}</div>` : ''}<p class="quote">${esc(it.quote || it.text)}</p><div class="person"><span class="avatar">${initial(it.name)}</span><div><b>${esc(it.name)}</b><span>${esc(it.role || '')}</span></div></div></article>`).join('');
      return `<section class="section${alt}"${id}><div class="container">${head(s)}<div class="grid">${items}</div></div></section>`;
    }
    case 'pricing': case 'plans': {
      const items = arr(s.items || s.plans).map((p) => `<article class="card plan${p.featured ? ' featured' : ''}">${p.featured ? `<span class="badge ribbon">${esc(p.badge || t.popular)}</span>` : ''}<div><h3>${esc(p.name)}</h3><p class="muted">${esc(p.text || p.description || '')}</p></div><div class="amount">${esc(p.price)}<small> ${esc(p.period || (p.price && /\d/.test(String(p.price)) ? t.perMonth : ''))}</small></div><ul>${arr(p.features).map((f) => `<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg><span>${esc(f)}</span></li>`).join('')}</ul>${btn(p.cta || { label: t.choose, href: p.href || (ctx.contactFile || '#') }, p.featured ? 'btn primary block' : 'btn block')}</article>`).join('');
      return `<section class="section${alt}"${id}><div class="container">${head(s)}<div class="grid">${items}</div></div></section>`;
    }
    case 'faq': {
      const items = arr(s.items).map((it, i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(it.q || it.question || it.title)}</summary><p>${esc(it.a || it.answer || it.text)}</p></details>`).join('');
      return `<section class="section${alt}"${id}><div class="container">${head(s)}<div class="faq">${items}</div></div></section>`;
    }
    case 'cta': {
      return `<section class="section tight"${id}><div class="container"><div class="cta-band"><h2>${rich(s.title)}</h2>${s.text ? `<p>${esc(s.text)}</p>` : ''}${btn(s.primary || s.cta || s.button)}</div></div></section>`;
    }
    case 'text': case 'about': case 'story': case 'prose': {
      const paras = arr(s.paragraphs || s.text).map((p) => `<p>${esc(p)}</p>`).join('');
      const body = `<div class="prose">${s.eyebrow ? `<div class="eyebrow">${esc(s.eyebrow)}</div>` : ''}${s.title ? `<h2>${rich(s.title)}</h2>` : ''}${paras}${s.primary ? `<div class="mt">${btn(s.primary, 'btn primary')}</div>` : ''}</div>`;
      if (s.image || s.icon) return `<section class="section${alt}"${id}><div class="container two-col">${body}<div class="visual">${s.image ? `<img src="${esc(s.image)}" alt="${esc(s.title || '')}">` : `<i data-icon="${esc(s.icon)}"></i>`}</div></div></section>`;
      return `<section class="section${alt}"${id}><div class="container">${body}</div></section>`;
    }
    case 'team': {
      const items = arr(s.items).map((it) => `<article class="card center"><span class="avatar" style="width:72px;height:72px;font-size:1.5rem;margin:0 auto 14px">${initial(it.name)}</span><h3>${esc(it.name)}</h3><p class="badge">${esc(it.role || '')}</p><p class="muted">${esc(it.bio || it.text || '')}</p></article>`).join('');
      return `<section class="section${alt}"${id}><div class="container">${head(s)}<div class="grid">${items}</div></div></section>`;
    }
    case 'contact': case 'form': case 'booking': case 'order': case 'signup': {
      const fields = arr(s.fields).length ? arr(s.fields) : [{ name: 'name', label: t.name, required: true }, { name: 'email', label: t.email, type: 'email', required: true }, { name: 'phone', label: t.phone, type: 'tel' }, { name: 'message', label: t.message, type: 'textarea', required: true, minlength: 10 }];
      const field = (f) => { const o = typeof f === 'string' ? { name: slug(f), label: f } : f; const req = o.required ? ' required' : ''; const min = o.minlength ? ` minlength="${+o.minlength}"` : ''; const nm = esc(o.name || slug(o.label)); if (o.type === 'textarea') return `<label>${esc(o.label)}<textarea name="${nm}" rows="5"${req}${min} placeholder="${esc(o.placeholder || '')}"></textarea></label>`; if (o.type === 'select') return `<label>${esc(o.label)}<select name="${nm}"${req}>${arr(o.options).map((x) => `<option>${esc(x)}</option>`).join('')}</select></label>`; return `<label>${esc(o.label)}<input name="${nm}" type="${esc(o.type || 'text')}"${req}${min} placeholder="${esc(o.placeholder || '')}"></label>`; };
      const short = fields.filter((f) => f.type !== 'textarea' && f.type !== 'select'); const long = fields.filter((f) => f.type === 'textarea' || f.type === 'select');
      const rows = []; for (let i = 0; i < short.length; i += 2) rows.push(`<div class="row">${short.slice(i, i + 2).map(field).join('')}</div>`);
      const info = s.info || ctx.footer || {};
      const infoList = [info.address ? ['pin', t.address, info.address] : null, info.phone ? ['phone', t.phone, info.phone] : null, info.email ? ['mail', t.email, info.email] : null, info.hours ? ['clock', t.hours, info.hours] : null].filter(Boolean).map(([ic, l, v]) => `<div class="card"><div class="icon"><i data-icon="${ic}"></i></div><div><b>${esc(l)}</b><span dir="auto">${esc(v)}</span></div></div>`).join('');
      return `<section class="section${alt}"${id}><div class="container">${head(s, false)}<div class="contact-grid"><form class="form" id="${esc(s.formId || 'contact')}" data-validate data-success="${esc(s.success || t.sent)}">${rows.join('')}${long.map(field).join('')}<div><button class="btn primary lg" type="submit">${esc(s.submit || t.send)}</button></div></form>${infoList ? `<div class="info-list">${infoList}${s.map ? `<div class="card" style="padding:0;overflow:hidden;aspect-ratio:4/3"><iframe src="${esc(s.map)}" style="border:0;width:100%;height:100%" loading="lazy"></iframe></div>` : ''}</div>` : ''}</div></div></section>`;
    }
    case 'cart': {
      return `<section class="section"${id}><div class="container">${head(s, false)}<div id="cart-root"></div></div></section>`;
    }
    case 'dashboard': {
      return `<section class="section"${id}><div class="container">${head(s, false)}<div class="stats" id="kpis"></div><div class="card mt"><h3>${esc(s.tableTitle || '')}</h3><table class="table" id="records"><thead></thead><tbody></tbody></table></div></div></section>`;
    }
    case 'html': return str(s.html);
    default: {
      // unknown type: render as a text block so nothing is lost
      return `<section class="section${alt}"${id}><div class="container">${head(s, false)}${arr(s.paragraphs || s.text).map((p) => `<p class="lead">${esc(p)}</p>`).join('')}</div></section>`;
    }
  }
}

// default sections when the model gives only a title — plausible, in the site's language, never "TODO"
function defaultSections(kind, page, ctx) {
  const t = ctx.t; const n = ctx.siteName; const tg = ctx.tagline;
  const D = {
    fa: { heroCta: 'شروع کنید', more: 'بیشتر بدانید', why: 'چرا ' + n + '؟', whyLead: tg, f: [['quality', 'کیفیت بی‌نظیر', 'هر جزئیات با دقت و وسواس انتخاب شده تا بهترین تجربه را داشته باشید.'], ['speed', 'سریع و قابل اعتماد', 'همیشه در دسترس، همیشه سر وقت — بدون دردسر.'], ['support', 'پشتیبانی واقعی', 'هر سؤالی داشتید، یک پیام کافی است؛ خودمان پاسخ می‌دهیم.']], cta: ['آماده‌اید شروع کنیم؟', 'همین امروز با ما در تماس باشید.', 'تماس با ما'], about: ['داستان ما', ['ما ' + n + ' را با یک هدف ساده ساختیم: ارائهٔ چیزی که خودمان دوست داریم استفاده کنیم.', 'هر روز تلاش می‌کنیم بهتر از دیروز باشیم و تجربه‌ای بسازیم که ارزش بازگشتن داشته باشد.']], values: [['heart', 'صداقت', 'همان چیزی را می‌گوییم که انجام می‌دهیم.'], ['star', 'کیفیت', 'از میان‌بر زدن خبری نیست.'], ['users', 'مشتری‌مداری', 'شما در مرکز هر تصمیم ما هستید.']], contact: ['با ما در تماس باشید', 'سؤال، پیشنهاد یا سفارش؟ فرم را پر کنید؛ در اولین فرصت پاسخ می‌دهیم.'], catalog: [page.title, 'انتخاب‌های ما را ببینید'], cart: [t.cart, ''], dash: [page.title, 'نمای کلی'] },
    en: { heroCta: 'Get started', more: 'Learn more', why: 'Why ' + n + '?', whyLead: tg, f: [['quality', 'Uncompromising quality', 'Every detail chosen with care so you get the best experience.'], ['speed', 'Fast and reliable', 'Always available, always on time — no hassle.'], ['support', 'Real support', 'One message away; we answer ourselves.']], cta: ['Ready to start?', 'Get in touch today.', 'Contact us'], about: ['Our story', [n + ' started with one simple goal: to offer something we would love to use ourselves.', 'Every day we try to be better than yesterday and build an experience worth coming back to.']], values: [['heart', 'Honesty', 'We say what we do.'], ['star', 'Quality', 'No shortcuts.'], ['users', 'Customer first', 'You are at the center of every decision.']], contact: ['Get in touch', 'Questions, ideas or orders? Fill in the form and we will reply shortly.'], catalog: [page.title, 'Browse our selection'], cart: [t.cart, ''], dash: [page.title, 'Overview'] },
    ru: { heroCta: 'Начать', more: 'Подробнее', why: 'Почему ' + n + '?', whyLead: tg, f: [['quality', 'Безупречное качество', 'Каждая деталь продумана, чтобы вы получили лучший опыт.'], ['speed', 'Быстро и надёжно', 'Всегда доступны, всегда вовремя.'], ['support', 'Живая поддержка', 'Одно сообщение — и мы отвечаем сами.']], cta: ['Готовы начать?', 'Свяжитесь с нами сегодня.', 'Связаться'], about: ['Наша история', [n + ' начался с простой цели: сделать то, чем мы сами хотели бы пользоваться.', 'Каждый день мы стараемся быть лучше, чем вчера.']], values: [['heart', 'Честность', 'Говорим то, что делаем.'], ['star', 'Качество', 'Без компромиссов.'], ['users', 'Клиент прежде всего', 'Вы в центре каждого решения.']], contact: ['Свяжитесь с нами', 'Вопросы, идеи или заказы? Заполните форму — ответим в ближайшее время.'], catalog: [page.title, 'Наш ассортимент'], cart: [t.cart, ''], dash: [page.title, 'Обзор'] },
    zh: { heroCta: '立即开始', more: '了解更多', why: '为什么选择 ' + n + '？', whyLead: tg, f: [['quality', '卓越品质', '每一个细节都经过精心打磨，只为最佳体验。'], ['speed', '快速可靠', '随时可用，准时交付。'], ['support', '真诚服务', '一条消息，我们亲自回复。']], cta: ['准备好开始了吗？', '今天就联系我们。', '联系我们'], about: ['我们的故事', [n + ' 源于一个简单的目标：做出我们自己也愿意使用的产品。', '我们每天都在努力比昨天更好。']], values: [['heart', '诚信', '言行一致。'], ['star', '品质', '绝不妥协。'], ['users', '客户至上', '您是每个决定的中心。']], contact: ['联系我们', '有问题、建议或订单？填写表单，我们会尽快回复。'], catalog: [page.title, '浏览我们的精选'], cart: [t.cart, ''], dash: [page.title, '概览'] },
  };
  const d = D[L2(ctx.lang)] || D.en;
  const icons = { quality: 'award', speed: 'bolt', support: 'users' };
  switch (kind) {
    case 'home': return [{ type: 'hero', badge: n, title: tg || n, subtitle: tg ? '' : '', primary: { label: d.heroCta, href: ctx.contactFile || '#features' }, secondary: { label: d.more, href: '#features' } }, { type: 'features', id: 'features', title: d.why, lead: d.whyLead, items: d.f.map(([k, title, text]) => ({ icon: icons[k], title, text })) }, { type: 'cta', title: d.cta[0], text: d.cta[1], primary: { label: d.cta[2], href: ctx.contactFile || '#' } }];
    case 'catalog': return [{ type: 'catalog', title: d.catalog[0], lead: d.catalog[1] }];
    case 'cart': return [{ type: 'cart', title: d.cart[0] }];
    case 'contact': return [{ type: 'contact', title: d.contact[0], lead: d.contact[1] }];
    case 'about': return [{ type: 'about', title: d.about[0], paragraphs: d.about[1], icon: 'heart' }, { type: 'features', alt: true, items: d.values.map(([icon, title, text]) => ({ icon, title, text })) }];
    case 'dashboard': return [{ type: 'dashboard', title: d.dash[0], lead: d.dash[1], tableTitle: '' }];
    default: return [{ type: 'text', title: page.title, paragraphs: [tg || n] }];
  }
}

function pageHtml({ page, siteName, lang, dir, body, theme, description, dataFiles = [] }) {
  return `<!DOCTYPE html>
<html lang="${esc(lang)}" dir="${dir}" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)} — ${esc(siteName)}</title>
<meta name="description" content="${esc(description || '')}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${GFONT(lang)}&display=swap" media="print" onload="this.media='all'">
<link rel="stylesheet" href="style.css">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='%23${'5e6ad2'}'/><text x='32' y='42' font-size='32' font-family='sans-serif' font-weight='700' text-anchor='middle' fill='white'>${String(siteName).trim().charAt(0)}</text></svg>`)}">
</head>
<body>
<header class="site-header" id="site-header"></header>
<main>
${body}
</main>
<footer class="site-footer" id="site-footer"></footer>
<script src="data/site.js"></script>
${dataFiles.map((d) => `<script src="data/${d}.js"></script>`).join('\n')}
<script src="main.js"></script>
<script src="${esc(page.file.replace(/\.html$/, ''))}.js"></script>
</body>
</html>
`;
}

function pageJs(kind, base, t) {
  const K = {
    catalog: `// ${base}.js — renders data/items into the catalog grid with category chips, search and add-to-cart
document.querySelectorAll('[data-catalog]').forEach(async (root) => {
  const name = root.dataset.catalog; const items = await loadData(name); const canAdd = root.dataset.add === '1' && window.cart;
  const filters = document.getElementById('filters-' + name); let cat = '', q = '';
  const card = (it) => \`<article class="card" data-id="\${esc(it.id)}"><div class="media">\${it.image ? '<img src="' + esc(it.image) + '" alt="' + esc(it.name) + '" loading="lazy">' : (it.emoji ? '<span style="font-size:3rem">' + esc(it.emoji) + '</span>' : esc(String(it.name || '?').charAt(0)))}</div>\${it.category ? '<span class="tag">' + esc(it.category) + '</span>' : ''}<h3>\${esc(it.name)}</h3><p class="muted">\${esc(it.description || '')}</p><div class="row">\${it.price != null && it.price !== '' ? '<span class="price">' + (typeof it.price === 'number' ? fmtPrice(it.price, it.unit) : esc(it.price)) + '</span>' : '<span></span>'}\${canAdd && it.price != null ? '<button class="btn sm primary" data-add="' + esc(it.id) + '">' + T.add + '</button>' : (it.href ? '<a class="btn sm" href="' + esc(it.href) + '">' + T.more + '</a>' : '')}</div></article>\`;
  const paint = () => { const rows = items.filter((it) => (!cat || it.category === cat) && (!q || JSON.stringify(it).toLowerCase().includes(q))); root.innerHTML = rows.map(card).join('') || '<div class="empty">' + T.noResults + '</div>'; root.querySelectorAll('.card').forEach((c) => c.classList.add('reveal', 'in')); };
  paint();
  if (filters) { filters.addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; cat = b.dataset.cat; filters.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === b)); paint(); }); const s = filters.querySelector('input[type=search]'); if (s) s.addEventListener('input', () => { q = s.value.trim().toLowerCase(); paint(); }); }
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-add]'); if (!b) return; const it = items.find((x) => String(x.id) === b.dataset.add); if (it) cart.add({ id: String(it.id), name: it.name, price: +it.price || 0 }); });
});`,
    cart: `// ${base}.js — cart page: quantities, remove, total, checkout (stored in localStorage)
(function () {
  const root = document.getElementById('cart-root'); if (!root) return;
  const paint = () => {
    if (!cart.items.length) { root.innerHTML = '<div class="empty">' + T.empty + '</div><div class="mt"><a class="btn" href="index.html">' + T.continueShopping + '</a></div>'; return; }
    root.innerHTML = '<table class="table"><thead><tr><th>' + T.item + '</th><th>' + T.qty + '</th><th>' + T.price + '</th><th></th></tr></thead><tbody>' + cart.items.map((it) => '<tr><td><b>' + esc(it.name) + '</b></td><td><button class="qty-btn" data-dec="' + esc(it.id) + '">−</button> <b>' + it.qty + '</b> <button class="qty-btn" data-inc="' + esc(it.id) + '">+</button></td><td>' + fmtPrice(it.price * it.qty) + '</td><td><button class="btn sm ghost" data-rm="' + esc(it.id) + '">' + T.remove + '</button></td></tr>').join('') + '</tbody></table><div class="cart-summary"><span class="lead" style="margin:0">' + T.total + ': <b>' + fmtPrice(cart.total()) + '</b></span><span><a class="btn" href="index.html">' + T.continueShopping + '</a> <button class="btn primary" id="checkout">' + T.checkout + '</button></span></div>';
  };
  root.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.inc) cart.set(b.dataset.inc, (cart.items.find((x) => x.id === b.dataset.inc) || {}).qty + 1); if (b.dataset.dec) cart.set(b.dataset.dec, (cart.items.find((x) => x.id === b.dataset.dec) || {}).qty - 1); if (b.dataset.rm) cart.remove(b.dataset.rm); if (b.id === 'checkout') { const orders = JSON.parse(localStorage.getItem('orders') || '[]'); orders.push({ items: cart.items, total: cart.total(), at: new Date().toISOString() }); localStorage.setItem('orders', JSON.stringify(orders)); cart.clear(); toast(T.ordered); } paint(); });
  paint();
})();`,
    dashboard: `// ${base}.js — KPI cards + records table from data/records
loadData('records').then((rows) => {
  const kpis = document.getElementById('kpis'); const tbl = document.getElementById('records'); if (!rows.length) return;
  const nums = Object.keys(rows[0]).filter((k) => typeof rows[0][k] === 'number');
  if (kpis) kpis.innerHTML = nums.slice(0, 4).map((k) => '<div class="stat"><b>' + rows.reduce((a, r) => a + (+r[k] || 0), 0).toLocaleString() + '</b><span>' + esc(k) + '</span></div>').join('');
  if (tbl) { const cols = Object.keys(rows[0]); tbl.querySelector('thead').innerHTML = '<tr>' + cols.map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr>'; tbl.querySelector('tbody').innerHTML = rows.map((r) => '<tr>' + cols.map((c) => '<td>' + esc(r[c]) + '</td>').join('') + '</tr>').join(''); }
});`,
    generic: `// ${base}.js — page script (shared behaviour lives in main.js)`,
  };
  return K[kind] || K.generic;
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
const kindFromSections = (secs) => { const types = arr(secs).map((s) => String(s.type || '').toLowerCase()); if (types.includes('hero')) return 'home'; if (types.some((x) => ['catalog', 'menu', 'products', 'shop', 'portfolio', 'courses'].includes(x))) return 'catalog'; if (types.includes('cart')) return 'cart'; if (types.some((x) => ['contact', 'form', 'booking', 'order', 'signup'].includes(x))) return 'contact'; if (types.includes('dashboard')) return 'dashboard'; if (types.some((x) => ['about', 'story', 'team'].includes(x))) return 'about'; return ''; };

const LABELS = {
  fa: { home: 'خانه', index: 'خانه', menu: 'منو', shop: 'فروشگاه', store: 'فروشگاه', products: 'محصولات', catalog: 'کاتالوگ', services: 'خدمات', pricing: 'قیمت‌ها', portfolio: 'نمونه‌کارها', gallery: 'گالری', courses: 'دوره‌ها', blog: 'وبلاگ', cart: 'سبد خرید', checkout: 'پرداخت', contact: 'تماس', about: 'دربارهٔ ما', team: 'تیم', faq: 'سوالات متداول', booking: 'رزرو', reservation: 'رزرو', order: 'سفارش', dashboard: 'داشبورد', login: 'ورود', signup: 'ثبت‌نام', register: 'ثبت‌نام' },
  ru: { home: 'Главная', index: 'Главная', menu: 'Меню', shop: 'Магазин', store: 'Магазин', products: 'Товары', catalog: 'Каталог', services: 'Услуги', pricing: 'Цены', portfolio: 'Портфолио', gallery: 'Галерея', courses: 'Курсы', blog: 'Блог', cart: 'Корзина', checkout: 'Оформление', contact: 'Контакты', about: 'О нас', team: 'Команда', faq: 'Вопросы', booking: 'Бронирование', reservation: 'Бронирование', order: 'Заказ', dashboard: 'Панель', login: 'Вход', signup: 'Регистрация', register: 'Регистрация' },
  zh: { home: '首页', index: '首页', menu: '菜单', shop: '商店', store: '商店', products: '产品', catalog: '目录', services: '服务', pricing: '价格', portfolio: '作品', gallery: '画廊', courses: '课程', blog: '博客', cart: '购物车', checkout: '结账', contact: '联系', about: '关于我们', team: '团队', faq: '常见问题', booking: '预订', reservation: '预订', order: '订单', dashboard: '仪表盘', login: '登录', signup: '注册', register: '注册' },
};

/**
 * scaffold({ root, dir, name, tagline, lang, theme, accent, currency, footer, pages, overwrite })
 * pages: [ "Title" | { title, file?, kind?, description?, nav?, sections: [ {type, …} ], items?: [...] } ]
 * Writes: style.css, main.js, data/site.js, <page>.html + <page>.js per page, data/items.js|json (catalog), README.md
 * Calling it again with the same dir and only some pages rewrites those pages (overwrite) and merges them into the shared nav.
 */
function scaffold({ root, dir = '.', name = 'My Site', tagline = '', lang = 'en', theme = 'dark', accent = 'indigo', currency = '', footer = {}, pages = [], overwrite = false, logoText = '' }) {
  const dirAbs = path.resolve(root, dir);
  if (!dirAbs.startsWith(path.resolve(root))) throw new Error('dir must be inside the workspace');
  fs.mkdirSync(dirAbs, { recursive: true });
  const siteFile = path.join(dirAbs, 'data', 'site.js');
  // incremental call: merge with the existing data/site.js
  let existing = null;
  if (fs.existsSync(siteFile)) { try { const m = fs.readFileSync(siteFile, 'utf8').match(/window\.SITE\s*=\s*(\{[\s\S]*\});?\s*$/); if (m) existing = JSON.parse(m[1]); } catch (_) { existing = null; } }
  if (existing) { name = name === 'My Site' ? existing.name : name; tagline = tagline || existing.tagline || ''; lang = existing.lang || lang; theme = existing.theme || theme; accent = existing.accent || accent; currency = currency || existing.currency || ''; footer = { ...(existing.footer || {}), ...(footer || {}) }; logoText = logoText || existing.logoText || ''; }
  if (!Array.isArray(pages) || !pages.length) pages = existing ? [] : ['Home', 'About', 'Contact'];
  const l2 = L2(lang); const t = tr(lang); const dirTag = RTL.has(l2) ? 'rtl' : 'ltr';
  const pal = PALETTES[accent] || PALETTES.indigo;
  const labels = LABELS[l2] || null;
  const norm = pages.map((p, i) => {
    const o = typeof p === 'string' ? { title: p } : { ...p };
    o.title = String(o.title || '').trim() || 'Page';
    if (labels && /^[a-z][a-z -]{1,20}$/i.test(o.title)) { const key = o.title.toLowerCase().replace(/\s+/g, ''); const l = labels[key] || labels[key.replace(/s$/, '')]; if (l) { o.file = o.file || (key === 'home' || key === 'index' || (i === 0 && !existing) ? 'index.html' : slug(o.title) + '.html'); o.title = l; } }
    const first = i === 0 && !existing;
    const k = o.kind || kindFromSections(o.sections) || (first && (!o.file || o.file === 'index.html') ? 'home' : kindOf((o.file || '').replace(/\.html$/, '') + ' ' + o.title));
    if (k === 'home' && !o.file) o.file = 'index.html';
    const latin = String(o.title).replace(/[^\x00-\x7F]+/g, '').trim();
    o.file = o.file || (k === 'home' ? 'index.html' : (latin ? slug(latin) : k) + '.html'); // non-Latin titles → file named after the page kind (menu → catalog.html)
    if (!/\.html$/.test(o.file)) o.file += '.html'; o.kind = k; return o;
  });
  // merge nav: existing pages + new/replaced ones (by file)
  const navPages = existing ? [...existing.pages] : [];
  for (const p of norm) { const idx = navPages.findIndex((x) => x.file === p.file); const row = { title: p.title, file: p.file, kind: p.kind, ...(p.nav === false ? { nav: false } : {}) }; if (idx >= 0) navPages[idx] = row; else navPages.push(row); }
  // unique file names among new pages
  const seen = new Set(navPages.map((p) => p.file).filter((f) => !norm.find((n) => n.file === f)));
  for (const p of norm) { let f = p.file, n = 2; while (seen.has(f)) f = p.file.replace(/\.html$/, `-${n++}.html`); if (f !== p.file) { const row = navPages.find((x) => x.file === p.file && x.title === p.title); if (row) row.file = f; p.file = f; } seen.add(f); }
  const contactFile = (navPages.find((p) => p.kind === 'contact') || {}).file || '';
  const ctx = { t, lang: l2, siteName: name, tagline, contactFile, footer };
  const written = [], skipped = [];
  const put = (rel, content, force) => { const f = path.join(dirAbs, rel); if (fs.existsSync(f) && !overwrite && !force) { skipped.push(rel); return; } fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); written.push(rel); };
  if (!existing || overwrite) { put('style.css', css({ ...pal, theme, lang: l2 })); put('main.js', mainJs(l2)); }
  put('data/site.js', `// Site-wide settings: name, pages (navigation order), footer. Edit here — every page reads it.\nwindow.SITE = ${JSON.stringify({ name, tagline, lang: l2, theme, accent, currency, logoText, pages: navPages, footer }, null, 2)};\n`, true);
  const putData = (dname, rows) => { put(`data/${dname}.js`, `// Edit this file to change the ${dname} content (also mirrored in ${dname}.json)\nwindow.SITE_DATA = window.SITE_DATA || {};\nwindow.SITE_DATA[${JSON.stringify(dname)}] = ${JSON.stringify(rows, null, 2)};\n`, true); put(`data/${dname}.json`, JSON.stringify(rows, null, 2), true); };
  for (const p of norm) {
    const base = p.file.replace(/\.html$/, '');
    let sections = arr(p.sections);
    if (!sections.length) sections = defaultSections(p.kind, p, ctx);
    // catalog items may be given on the page or inside the catalog section
    sections.forEach((sec, i) => { if (!sec.type) sec.type = inferType(sec, i); });
    const catSec = sections.find((s) => ['catalog', 'menu', 'products', 'shop', 'portfolio', 'courses'].includes(String(s.type || '').toLowerCase()));
    const dataFiles = [];
    if (catSec) {
      // one catalog page → data/items.js; several catalog pages in one site → data/<page>.js each
      const catalogPages = norm.filter((q) => arr(q.sections).some((x) => ['catalog', 'menu', 'products', 'shop', 'portfolio', 'courses'].includes(String(x.type || '').toLowerCase())) || q.kind === 'catalog');
      const dname = catSec.data || (catalogPages.length <= 1 || base === 'index' ? 'items' : slug(base).replace(/-/g, '_')) || 'items';
      catSec.data = dname; ctx.dataName = dname;
      const items = arr(catSec.items).length ? arr(catSec.items) : arr(p.items);
      if (items.length) putData(dname, items.map((it, i) => ({ id: it.id ?? i + 1, ...it, ...(it.price != null && it.price !== '' ? { price: normPrice(it.price) } : {}) })));
      else if (!fs.existsSync(path.join(dirAbs, 'data', dname + '.js'))) putData(dname, []);
      dataFiles.push(dname);
    }
    if (p.kind === 'dashboard') { const rows = arr(p.records).length ? arr(p.records) : arr((sections.find((s) => s.type === 'dashboard') || {}).records); if (rows.length || !fs.existsSync(path.join(dirAbs, 'data', 'records.js'))) putData('records', rows.length ? rows : []); dataFiles.push('records'); }
    const body = sections.map((s, i) => renderSection(s, ctx, i)).join('\n');
    put(p.file, pageHtml({ page: p, siteName: name, lang: l2, dir: dirTag, body, theme, description: p.description || tagline || name, dataFiles }), !!p.sections);
    const kindJs = catSec ? 'catalog' : p.kind === 'cart' || sections.some((s) => s.type === 'cart') ? 'cart' : p.kind === 'dashboard' ? 'dashboard' : 'generic';
    put(base + '.js', pageJs(kindJs, base, t), !!p.sections);
  }
  put('README.md', `# ${name}\n\n${tagline}\n\nStatic multi-page site (no build step). Open \`index.html\` in a browser or serve the folder (\`npx serve\`, \`python -m http.server\`).\n\n| Page | File | Script |\n|---|---|---|\n${navPages.map((p) => `| ${p.title} | ${p.file} | ${p.file.replace(/\.html$/, '')}.js |`).join('\n')}\n\n- \`style.css\` — design tokens at the top (colors, radius, font); dark/light themes\n- \`main.js\` — header/nav/footer (from \`data/site.js\`), icons, theme toggle, cart, form validation, reveal animations\n- \`data/site.js\` — site name, page list (navigation order), footer contact info\n- \`data/*.js\` — catalog items / records (edit to change content)\n`, true);
  const todos = [];
  for (const rel of written) { if (/\.(html|js|json)$/.test(rel)) { const n = (fs.readFileSync(path.join(dirAbs, rel), 'utf8').match(/TODO/g) || []).length; if (n) todos.push(`${rel}: ${n}`); } }
  return { dir: path.relative(root, dirAbs).replace(/\\/g, '/') || '.', pages: navPages.map((p) => ({ title: p.title, file: p.file, kind: p.kind })), written, skipped, todo_markers: todos, complete: !todos.length, next: todos.length ? 'Replace the remaining TODO markers with real content (edit_file), then browser_check every page.' : 'Pages are complete. browser_check each page (fix any error), then report the file list to the user. To change content, edit the page HTML / data/*.js, or call scaffold_site again with that page\'s sections (overwrite).' };
}

module.exports = { scaffold, kindOf, PALETTES };
