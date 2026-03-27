// ─── LabQMS Pro — Shared UI Utilities ─────────────────────────────────────────
// showConfirm(baslik, mesaj, tip)  → Promise<boolean>
// showToast(mesaj, tip)            → void
// tip: 'success' | 'error' | 'warning' | 'info' | 'danger'
// ──────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  var CSS = [
    // ── Overlay & Card ────────────────────────────────────────────────────────
    '.lq-overlay{position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,.55);',
    'backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;',
    'opacity:0;transition:opacity .2s ease}',
    '.lq-overlay.lq-in{opacity:1}',
    '.lq-card{background:#fff;border-radius:20px;padding:36px 32px 28px;width:400px;',
    'max-width:92vw;text-align:center;',
    'box-shadow:0 24px 80px rgba(0,0,0,.22),0 2px 8px rgba(0,0,0,.08);',
    'transform:scale(.88) translateY(16px);opacity:0;',
    'transition:transform .25s cubic-bezier(.34,1.56,.64,1),opacity .2s}',
    '.lq-overlay.lq-in .lq-card{transform:scale(1) translateY(0);opacity:1}',
    '.lq-icon{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;',
    'justify-content:center;font-size:1.75rem;margin:0 auto 18px}',
    '.lq-title{font-size:1.05rem;font-weight:700;color:#0f172a;margin-bottom:8px;line-height:1.3}',
    '.lq-msg{font-size:0.875rem;color:#64748b;line-height:1.65;margin-bottom:28px}',
    '.lq-btns{display:flex;gap:12px;justify-content:center}',
    '.lq-btn{padding:10px 28px;border-radius:10px;border:none;font-weight:600;',
    'font-size:0.875rem;cursor:pointer;min-width:96px;',
    'transition:opacity .15s,transform .1s,box-shadow .15s}',
    '.lq-btn:hover{opacity:.87}',
    '.lq-btn:active{transform:scale(.97)}',
    '.lq-btn-cancel{background:#f1f5f9;color:#475569}',
    '.lq-btn-cancel:hover{background:#e2e8f0;opacity:1}',
    '.lq-btn-ok{color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.18)}',
    // ── Toast ─────────────────────────────────────────────────────────────────
    '#lq-toasts{position:fixed;top:20px;right:20px;z-index:9999;',
    'display:flex;flex-direction:column;gap:8px;pointer-events:none}',
    '.lq-toast{display:flex;align-items:center;gap:10px;',
    'padding:13px 18px;border-radius:12px;min-width:240px;max-width:360px;',
    'font-weight:600;font-size:0.875rem;color:#fff;pointer-events:all;',
    'box-shadow:0 6px 28px rgba(0,0,0,.18);',
    'transform:translateX(115%);opacity:0;',
    'transition:transform .3s cubic-bezier(.34,1.56,.64,1),opacity .22s}',
    '.lq-toast.lq-in{transform:translateX(0);opacity:1}',
    '.lq-toast.lq-out{transform:translateX(115%);opacity:0;',
    'transition:transform .24s ease-in,opacity .2s}',
    '.lq-toast-ic{font-size:1.1rem;flex-shrink:0}',
  ].join('');

  function injectCSS() {
    if (document.getElementById('lq-css')) return;
    var s = document.createElement('style');
    s.id = 'lq-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ── showConfirm ─────────────────────────────────────────────────────────────
  window.showConfirm = function (baslik, mesaj, tip) {
    tip = tip || 'danger';
    injectCSS();

    var cfg = {
      danger:  { icon: '🗑️', bg: '#fee2e2', c: '#dc2626', btn: 'Evet, Sil'  },
      warning: { icon: '⚠️',  bg: '#fef3c7', c: '#d97706', btn: 'Devam Et'  },
      info:    { icon: 'ℹ️',  bg: '#dbeafe', c: '#1E40AF', btn: 'Tamam'     },
    };
    var d = cfg[tip] || cfg.danger;

    return new Promise(function (resolve) {
      var ov = document.createElement('div');
      ov.className = 'lq-overlay';
      ov.innerHTML =
        '<div class="lq-card">' +
          '<div class="lq-icon" style="background:' + d.bg + ';color:' + d.c + '">' + d.icon + '</div>' +
          '<div class="lq-title">' + baslik + '</div>' +
          '<div class="lq-msg">' + mesaj + '</div>' +
          '<div class="lq-btns">' +
            '<button class="lq-btn lq-btn-cancel">İptal</button>' +
            '<button class="lq-btn lq-btn-ok" style="background:' + d.c + '">' + d.btn + '</button>' +
          '</div>' +
        '</div>';

      document.body.appendChild(ov);
      // Double rAF to trigger transition
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { ov.classList.add('lq-in'); });
      });

      function close(val) {
        ov.classList.remove('lq-in');
        setTimeout(function () { if (ov.parentNode) ov.remove(); }, 260);
        document.removeEventListener('keydown', onKey);
        resolve(val);
      }
      function onKey(e) {
        if (e.key === 'Escape') close(false);
        if (e.key === 'Enter')  close(true);
      }
      document.addEventListener('keydown', onKey);
      ov.querySelector('.lq-btn-cancel').addEventListener('click', function () { close(false); });
      ov.querySelector('.lq-btn-ok').addEventListener('click',     function () { close(true);  });
      ov.addEventListener('click', function (e) { if (e.target === ov) close(false); });
    });
  };

  // ── showToast ───────────────────────────────────────────────────────────────
  window.showToast = function (msg, tip) {
    // Accept legacy boolean second argument (true = error)
    if (tip === true)  tip = 'error';
    if (tip === false || !tip) tip = 'success';
    injectCSS();

    // Strip leading emoji clusters from message
    var clean = String(msg).replace(/^[\p{Emoji}\s]+/u, '').trim();
    if (!clean) clean = String(msg);

    var icons  = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    var colors = { success: '#16a34a', error: '#dc2626', warning: '#d97706', info: '#1E40AF' };
    var icon  = icons[tip]  || '✅';
    var color = colors[tip] || '#16a34a';

    var wrap = document.getElementById('lq-toasts');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'lq-toasts';
      document.body.appendChild(wrap);
    }

    var el = document.createElement('div');
    el.className = 'lq-toast';
    el.style.background = color;
    el.innerHTML = '<span class="lq-toast-ic">' + icon + '</span><span>' + clean + '</span>';
    wrap.appendChild(el);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.classList.add('lq-in'); });
    });
    setTimeout(function () {
      el.classList.add('lq-out');
      setTimeout(function () { if (el.parentNode) el.remove(); }, 280);
    }, 3200);
  };

})();
