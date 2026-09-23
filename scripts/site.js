(function () {
  'use strict';
  // theme
  var root = document.documentElement;
  var saved = null; try { saved = localStorage.getItem('orca-theme'); } catch (e) {}
  var dark = saved ? saved === 'dark' : (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  var tb = document.getElementById('theme');
  if (tb) tb.addEventListener('click', function () {
    dark = root.getAttribute('data-theme') !== 'dark';
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    try { localStorage.setItem('orca-theme', dark ? 'dark' : 'light'); } catch (e) {}
  });
  // mobile sidebar
  var burger = document.getElementById('burger'), side = document.getElementById('sidebar');
  if (burger && side) burger.addEventListener('click', function () { side.classList.toggle('open'); });
  if (side) side.addEventListener('click', function (e) { if (e.target.tagName === 'A') side.classList.remove('open'); });
  // copy buttons
  document.querySelectorAll('.copy').forEach(function (b) {
    b.addEventListener('click', function () {
      var pre = b.closest('.codeblock').querySelector('pre code');
      var t = pre ? pre.textContent : '';
      var done = function () { b.textContent = 'Copied ✓'; setTimeout(function () { b.textContent = 'Copy'; }, 1400); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, done);
      else {
        var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta);
        ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); done();
      }
    });
  });
  // toc scroll-spy
  var links = [].slice.call(document.querySelectorAll('.toc-link'));
  if (links.length) {
    var heads = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); }).filter(Boolean);
    var spy = function () {
      var y = window.scrollY + 90, cur = null;
      for (var i = 0; i < heads.length; i++) if (heads[i].offsetTop <= y) cur = heads[i].id;
      links.forEach(function (a) { a.style.color = a.getAttribute('href') === '#' + cur ? 'var(--accent)' : ''; });
    };
    window.addEventListener('scroll', spy, { passive: true }); spy();
  }
  // search
  var q = document.getElementById('q'), qres = document.getElementById('qres');
  if (q && qres) {
    var idx = null;
    var load = function (cb) {
      if (idx) return cb();
      fetch('index.json').then(function (r) { return r.json(); }).then(function (j) { idx = j; cb(); }).catch(function () { idx = []; cb(); });
    };
    var run = function () {
      var v = q.value.trim().toLowerCase();
      if (!v) { qres.hidden = true; qres.innerHTML = ''; return; }
      load(function () {
        var scored = idx.map(function (p) {
          var s = 0, t = p.title.toLowerCase(), x = (p.text || '').toLowerCase(), hs = (p.heads || []).join(' ').toLowerCase();
          var words = v.split(/\s+/);
          for (var i = 0; i < words.length; i++) {
            var w = words[i]; if (!w) continue;
            if (t.indexOf(w) === 0) s += 12; else if (t.indexOf(w) > -1) s += 7;
            if (hs.indexOf(w) > -1) s += 4;
            var c = x.split(w).length - 1; s += Math.min(c, 8);
            if (!s && c === 0 && t.indexOf(w) < 0 && hs.indexOf(w) < 0) s -= 5;
          }
          return { p: p, s: s };
        }).filter(function (r) { return r.s > 0; }).sort(function (a, b) { return b.s - a.s; }).slice(0, 8);
        if (!scored.length) { qres.innerHTML = '<a href="#"><small>No results</small></a>'; qres.hidden = false; return; }
        qres.innerHTML = scored.map(function (r) {
          var snip = '';
          var at = (r.p.text || '').toLowerCase().indexOf(v.split(/\s+/)[0]);
          if (at > -1) snip = '…' + r.p.text.slice(Math.max(0, at - 40), at + 90).replace(/\s+/g, ' ') + '…';
          return '<a href="' + r.p.slug + '.html">' + r.p.title + (snip ? '<small>' + snip.replace(/</g, '&lt;') + '</small>' : '') + '</a>';
        }).join('');
        qres.hidden = false;
      });
    };
    q.addEventListener('input', run);
    q.addEventListener('focus', run);
    document.addEventListener('click', function (e) { if (!qres.contains(e.target) && e.target !== q) qres.hidden = true; });
    q.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var a = qres.querySelector('a[href$=".html"]'); if (a) location.href = a.getAttribute('href'); }
      if (e.key === 'Escape') { qres.hidden = true; q.blur(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement !== q && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); q.focus(); }
    });
  }
})();
