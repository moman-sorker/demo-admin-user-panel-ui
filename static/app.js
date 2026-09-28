/* =========================================================
   Shared utilities — Modal, Toast, Matrix, API, Table, 2FA
   ========================================================= */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const LS = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del: k => localStorage.removeItem(k)
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function debounce(fn, ms = 250) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ============ API ============ */
async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'same-origin',
    ...opts,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) { const e = new Error(data.error || `HTTP ${res.status}`); e.status = res.status; e.data = data; throw e; }
  return data;
}

async function apiUpload(url, formData) {
  const res = await fetch(url, {
    method: 'POST', body: formData, credentials: 'same-origin',
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) { const e = new Error(data.error || `HTTP ${res.status}`); e.status = res.status; e.data = data; throw e; }
  return data;
}

/* ============ Toast ============ */
function toast(msg, type = 'ok') {
  let wrap = $('#toasts');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toasts'; wrap.className = 'toasts'; document.body.appendChild(wrap); }
  const icon = type === 'ok' ? '✅' : type === 'error' ? '⛔' : '⚠️';
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'ok' ? '' : ' ' + type);
  el.innerHTML = `<span>${icon}</span><span>${escapeHtml(msg)}</span>`;
  wrap.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3400);
}

/* ============ Modal ============ */
const Modal = {
  open({ title = '', body = '', actions = [], onClose = null, width = null }) {
    Modal.close();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="${width ? `max-width:${width}px;` : ''}">
        <div class="modal-head">
          <h3>${escapeHtml(title)}</h3>
          <button class="modal-x" data-x type="button">&times;</button>
        </div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot"></div>
      </div>`;
    const foot = overlay.querySelector('.modal-foot');
    actions.forEach(a => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (a.cls || 'btn-ghost');
      b.textContent = a.label;
      b.onclick = () => { if (a.onClick) a.onClick(overlay); else Modal.close(); };
      foot.appendChild(b);
    });
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.dataset.x !== undefined) { Modal.close(); if (onClose) onClose(); }
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    setTimeout(() => overlay.querySelector('input,select,textarea,button.btn-primary')?.focus(), 60);
    document.addEventListener('keydown', Modal._esc = e => {
      if (e.key === 'Escape') { Modal.close(); if (onClose) onClose(); }
    });
    return overlay;
  },
  close() {
    $$('.modal-overlay').forEach(o => { o.classList.remove('show'); setTimeout(() => o.remove(), 200); });
    if (Modal._esc) { document.removeEventListener('keydown', Modal._esc); Modal._esc = null; }
  },
  alert(title, message) {
    return new Promise(res => Modal.open({
      title, body: `<p class="modal-text">${escapeHtml(message)}</p>`,
      actions: [{ label: 'OK', cls: 'btn-primary', onClick: () => { Modal.close(); res(true); } }],
      onClose: () => res(false),
    }));
  },
  confirm(title, message, opts = {}) {
    return new Promise(res => Modal.open({
      title, body: `<p class="modal-text">${escapeHtml(message)}</p>`,
      actions: [
        { label: opts.cancelLabel || 'Cancel', cls: 'btn-ghost', onClick: () => { Modal.close(); res(false); } },
        { label: opts.okLabel || 'Confirm', cls: opts.danger ? 'btn-danger' : 'btn-primary',
          onClick: () => { Modal.close(); res(true); } },
      ],
      onClose: () => res(false),
    }));
  },
  form({ title, fields, onSubmit, submitLabel = 'Save', cancelLabel = 'Cancel', width = null }) {
    const body = `<form class="modal-form" autocomplete="off">
      ${fields.map(f => {
        const val = f.value ?? '';
        if (f.type === 'select') {
          return `<div class="field"><label>${escapeHtml(f.label)}</label>
            <select name="${f.name}">${f.options.map(o =>
              `<option value="${escapeHtml(o.value)}"${String(o.value) === String(val) ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
            </select></div>`;
        }
        if (f.type === 'textarea') {
          return `<div class="field"><label>${escapeHtml(f.label)}</label>
            <textarea name="${f.name}" rows="${f.rows || 4}" placeholder="${escapeHtml(f.placeholder || '')}" ${f.required ? 'required' : ''}>${escapeHtml(val)}</textarea></div>`;
        }
        return `<div class="field"><label>${escapeHtml(f.label)}</label>
          <input type="${f.type || 'text'}" name="${f.name}" value="${escapeHtml(val)}"
                 placeholder="${escapeHtml(f.placeholder || '')}" ${f.required ? 'required' : ''} /></div>`;
      }).join('')}
    </form>`;

    return new Promise(res => {
      const overlay = Modal.open({
        title, body, width,
        actions: [
          { label: cancelLabel, cls: 'btn-ghost', onClick: () => { Modal.close(); res(null); } },
          { label: submitLabel, cls: 'btn-primary', onClick: async () => {
              const form = overlay.querySelector('form');
              if (!form.reportValidity()) return;
              const data = {};
              fields.forEach(f => { data[f.name] = form.elements[f.name].value; });
              try { await onSubmit(data, overlay); }
              catch (e) { toast(e.message || 'Error', 'error'); }
            } },
        ],
        onClose: () => res(null),
      });
      overlay.querySelector('form').addEventListener('submit', e => {
        e.preventDefault();
        overlay.querySelector('.modal-foot .btn-primary')?.click();
      });
    });
  }
};

/* ============ Clock ============ */
function initClock() {
  const c = $('#clock'); if (!c) return;
  const p = n => String(n).padStart(2, '0');
  const tick = () => { const d = new Date(); c.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
  tick(); setInterval(tick, 1000);
}

/* ============ Matrix ============ */
function initMatrix() {
  const c = $('#matrix-canvas'); if (!c) return;
  const ctx = c.getContext('2d');
  const chars = 'アイウエオカキクケコサシスセソタチツテト0123456789ABCDEF</>{}[]();=+*&%$#@!';
  let cols, drops, fs = 14;
  function resize() { c.width = innerWidth; c.height = innerHeight; cols = Math.floor(c.width / fs); drops = Array(cols).fill(1); }
  resize(); addEventListener('resize', resize);
  setInterval(() => {
    if (document.documentElement.classList.contains('no-matrix')) { ctx.clearRect(0, 0, c.width, c.height); return; }
    const p = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#00ff9d';
    ctx.fillStyle = 'rgba(4,7,12,0.08)'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = p; ctx.font = fs + 'px JetBrains Mono, monospace';
    for (let i = 0; i < drops.length; i++) {
      const txt = chars.charAt(Math.floor(Math.random() * chars.length));
      ctx.fillText(txt, i * fs, drops[i] * fs);
      if (drops[i] * fs > c.height && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    }
  }, 60);
}

/* ============ Theme ============ */
const THEME_KEY = 'panel_theme';
let _themeSync = null;   // optional callback to server sync
function applyTheme(t, sync = true) {
  document.documentElement.dataset.theme = t;
  LS.set(THEME_KEY, t);
  if (sync && _themeSync) _themeSync(t);
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  toast('Theme: ' + next);
}
function initTheme() {
  applyTheme(LS.get(THEME_KEY, 'dark'), false);
  $('#themeToggle')?.addEventListener('click', toggleTheme);
  $('#themeBtn')?.addEventListener('click', toggleTheme);
  const mtx = $('#matrixToggle');
  if (mtx) {
    mtx.checked = LS.get('panel_matrix', true);
    document.documentElement.classList.toggle('no-matrix', !mtx.checked);
    mtx.addEventListener('change', e => { LS.set('panel_matrix', e.target.checked); document.documentElement.classList.toggle('no-matrix', !e.target.checked); });
  }
  const sc = $('#scanToggle');
  if (sc) {
    sc.checked = LS.get('panel_scan', true);
    document.documentElement.classList.toggle('no-scan', !sc.checked);
    sc.addEventListener('change', e => { LS.set('panel_scan', e.target.checked); document.documentElement.classList.toggle('no-scan', !e.target.checked); });
  }
}

/* ============ Nav ============ */
function initNav(labelMap) {
  $$('.nav-item').forEach(n => n.addEventListener('click', () => {
    const view = n.dataset.view; if (!view) return;
    $$('.view').forEach(v => v.classList.remove('active'));
    $('#view-' + view)?.classList.add('active');
    $$('.nav-item').forEach(x => x.classList.toggle('active', x.dataset.view === view));
    $('#page-title').textContent = labelMap[view] || view;
    $('#breadcrumb-current').textContent = view;
    $('#sidebar')?.classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (window.onViewChange) window.onViewChange(view);
  }));
  $('#menuToggle')?.addEventListener('click', () => $('#sidebar')?.classList.toggle('open'));
  $$('[data-nav]').forEach(b => b.addEventListener('click', () => {
    const target = $$('.nav-item').find(n => n.dataset.view === b.dataset.nav);
    target?.click();
  }));
}

/* ============ Log ============ */
function logLine(msg, cls = 'info') {
  const el = $('#logConsole'); if (!el) return;
  const ts = new Date().toLocaleTimeString('en-GB');
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<span class="ts">[${ts}]</span><span class="${cls}">${escapeHtml(msg)}</span>`;
  el.appendChild(line); el.scrollTop = el.scrollHeight;
  while (el.children.length > 200) el.removeChild(el.firstChild);
}

/* ============ Numbers / time ============ */
function animateNum(el, target) {
  if (!el) return;
  const start = parseInt(el.textContent.replace(/[^\d]/g, ''), 10) || 0;
  const dur = 600, t0 = performance.now();
  (function step(t) {
    const p = Math.min((t - t0) / dur, 1);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(start + (target - start) * e).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}
function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

/* =========================================================
   Pager — renders <div class="pager">…</div>
   state: {page, pages, total, limit}
   onPage(n) → callback
   ========================================================= */
function renderPager(container, state, onPage) {
  if (!container) return;
  const { page = 1, pages = 1, total = 0, limit = 10 } = state;
  if (pages <= 1) {
    container.innerHTML = `<span class="pager-info">${total} result${total === 1 ? '' : 's'}</span>`;
    return;
  }
  const btn = (label, target, disabled, active = false) =>
    `<button class="pager-btn${active ? ' active' : ''}" data-page="${target}" ${disabled ? 'disabled' : ''}>${label}</button>`;

  let nums = '';
  const range = 1;
  const start = Math.max(1, page - range);
  const end   = Math.min(pages, page + range);
  if (start > 1) nums += btn('1', 1, false, page === 1) + (start > 2 ? `<span class="pager-dots">…</span>` : '');
  for (let i = start; i <= end; i++) nums += btn(i, i, false, i === page);
  if (end < pages) nums += (end < pages - 1 ? `<span class="pager-dots">…</span>` : '') + btn(pages, pages, false, page === pages);

  container.innerHTML = `
    <span class="pager-info">${total} result${total === 1 ? '' : 's'} · page ${page}/${pages}</span>
    <div class="pager-controls">
      ${btn('‹', page - 1, page <= 1)}
      ${nums}
      ${btn('›', page + 1, page >= pages)}
    </div>`;

  container.querySelectorAll('[data-page]').forEach(b => {
    b.addEventListener('click', () => {
      const p = parseInt(b.dataset.page, 10);
      if (!b.disabled && p >= 1 && p <= pages && p !== page) onPage(p);
    });
  });
}

/* =========================================================
   Notification Bell (header widget)
   ========================================================= */
async function initNotifBell({ onCount, onNavigate } = {}) {
  const wrap = $('#notifWrap'); if (!wrap) return;

  async function refresh() {
    try {
      const list = await api('/api/notifications');
      const unread = list.filter(n => !n.read);
      const badge = $('#notifBadge');
      if (badge) {
        badge.textContent = unread.length;
        badge.style.display = unread.length ? 'grid' : 'none';
      }
      if (onCount) onCount(unread.length);

      const panel = $('#notifPanel');
      if (!panel) return;
      if (!list.length) {
        panel.innerHTML = `<div class="notif-empty">No notifications yet.</div>`;
        return;
      }
      panel.innerHTML = list.slice(0, 20).map(n => `
        <div class="notif-item ${n.read ? '' : 'unread'}"
             data-nid="${escapeHtml(n.id)}"
             data-rv="${escapeHtml(n.redirect_view || '')}"
             data-rid="${escapeHtml(n.redirect_id || '')}">
          <div class="notif-dot ${n.kind || 'info'}"></div>
          <div class="notif-body">
            <div class="notif-title">${escapeHtml(n.title)}</div>
            <div class="notif-text">${escapeHtml(n.body)}</div>
            <div class="notif-time">${timeAgo(n.at)} · from ${escapeHtml(n.from)}</div>
          </div>
        </div>`).join('');

      // ---- Click handler: mark read + close + redirect ----
      panel.querySelectorAll('.notif-item').forEach(el => {
        el.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const nid = el.dataset.nid;
          const rv  = el.dataset.rv;
          const rid = el.dataset.rid;

          // mark read
          try {
            await api('/api/notifications/read', {
              method: 'POST',
              body: JSON.stringify({ ids: [nid] }),
            });
            el.classList.remove('unread');
          } catch {}

          // close panel
          wrap.classList.remove('open');

          // redirect to view
          if (rv) {
            const nav = [...document.querySelectorAll('.nav-item')]
                        .find(n => n.dataset.view === rv);
            if (nav) nav.click();

            // open specific item if provided
            if (rv === 'tickets' && rid) {
              setTimeout(() => {
                if (typeof window.__openTicket === 'function') {
                  try { window.__openTicket(rid); } catch {}
                }
              }, 400);
            }
          } else if (onNavigate) {
            onNavigate(el.dataset);
          }

          refresh();
        });
      });
    } catch (e) {
      // Silent — bell is non-critical
    }
  }

  // Toggle panel
  $('#notifBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    $('#notifWrap')?.classList.toggle('open');
  });

  // Click outside → close
  document.addEventListener('click', e => {
    const w = document.getElementById('notifWrap');
    if (w && !w.contains(e.target)) w.classList.remove('open');
  });

  // Scroll anywhere → close
  window.addEventListener('scroll', () => {
    const w = document.getElementById('notifWrap');
    if (w?.classList.contains('open')) w.classList.remove('open');
  }, true);

  // ESC → close
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const w = document.getElementById('notifWrap');
      if (w?.classList.contains('open')) w.classList.remove('open');
    }
  });

  // Mark-all-read
  $('#notifMarkRead')?.addEventListener('click', async e => {
    e.stopPropagation();
    try {
      await api('/api/notifications/read', { method: 'POST', body: '{}' });
      toast('All marked as read');
      refresh();
    } catch (err) { toast(err.message, 'error'); }
  });

  await refresh();
  return { refresh };
}

/* =========================================================
   Avatar Upload
   ========================================================= */
async function uploadAvatar(file) {
  const fd = new FormData();
  fd.append('avatar', file);
  return apiUpload('/api/avatar', fd);
}

/* =========================================================
   Confetti / Pop mini animation for success
   ========================================================= */
function pulse(el) {
  if (!el) return;
  el.style.transition = 'transform .25s ease';
  el.style.transform = 'scale(1.06)';
  setTimeout(() => { el.style.transform = 'scale(1)'; }, 220);
}

/* =========================================================
   Init on DOM ready
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {
  initTheme(); initClock(); initMatrix();
});

/* =========================================================
   ROLE HELPERS — v3.0
   ========================================================= */
const ROLE_RANK = { viewer: 1, editor: 2, superadmin: 3 };

function hasRole(myRole, minRole) {
  return (ROLE_RANK[myRole] || 0) >= (ROLE_RANK[minRole] || 99);
}

function rolePill(role) {
  const label = { viewer: '👁️ Viewer', editor: '✏️ Editor', superadmin: '👑 Superadmin' }[role] || role;
  return `<span class="role-pill ${role}">${label}</span>`;
}

/* =========================================================
   v4.0 Helpers — Permissions, Role chips, Postman utils
   ========================================================= */
function hasPerm(perms, name) {
  return Array.isArray(perms) && perms.includes(name);
}
function roleChip(role, label, color) {
  const c = color || '#00ff9d';
  return `<span class="role-chip" style="--rc:${c}">${escapeHtml(label || role)}</span>`;
}
function methodClass(m) {
  return 'method-mini ' + (m || 'GET').toUpperCase();
}
function prettyJson(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}
function bytesFmt(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

/* =========================================================
   v5.0 — WebSocket helper (auto ping/pong-safe, reconnect-free)
   ========================================================= */
class WSTester {
  constructor({ onMessage, onState, onError } = {}) {
    this.ws = null;
    this.url = '';
    this.onMessage = onMessage || (() => {});
    this.onState = onState || (() => {});
    this.onError = onError || (() => {});
  }
  get state() {
    if (!this.ws) return 'disconnected';
    const map = { 0: 'connecting', 1: 'connected', 2: 'closing', 3: 'closed' };
    return map[this.ws.readyState] || 'disconnected';
  }
  connect(url) {
    if (this.ws) this.disconnect();
    if (!url || !/^wss?:\/\//i.test(url)) throw new Error('URL must start with ws:// or wss://');
    this.url = url;
    try { this.onState('connecting'); } catch {}
    try {
      this.ws = new WebSocket(url);
    } catch (e) { this.onError(e.message); this.onState('disconnected'); throw e; }
    this.ws.onopen = () => { this.onState('connected'); };
    this.ws.onclose = () => { this.onState('closed'); this.ws = null; };
    this.ws.onerror = () => { this.onError('WebSocket error'); };
    this.ws.onmessage = (e) => {
      let data = e.data;
      // binary?
      if (data instanceof Blob) {
        data.text().then(t => this.onMessage(t)).catch(() => this.onMessage('[blob]'));
        return;
      }
      this.onMessage(data);
    };
  }
  disconnect() {
    if (this.ws) {
      try { this.ws.close(1000, 'user disconnect'); } catch {}
      this.ws = null;
    }
    this.onState('disconnected');
  }
  send(payload) {
    if (!this.ws || this.ws.readyState !== 1) throw new Error('Not connected');
    this.ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
  }
}

/* =========================================================
   v6.0 — Extra helpers
   ========================================================= */

// Debounced search + sort + pagination helper (server-side)
function makeListController({ fetcher, renderPagerEl, renderBodyEl,
                              state = {}, onLoaded }) {
  const s = { page: 1, limit: 10, q: '', sort: 'created', order: 'desc', ...state };
  async function refresh() {
    const params = new URLSearchParams({
      page: s.page, limit: s.limit, q: s.q, sort: s.sort, order: s.order,
    });
    if (s.filters) for (const [k, v] of Object.entries(s.filters)) {
      if (v != null && v !== '') params.append(k, v);
    }
    try {
      const r = await fetcher(params);
      if (renderBodyEl) renderBodyEl(r);
      if (renderPagerEl) renderPager($(renderPagerEl), r, p => { s.page = p; refresh(); });
      if (onLoaded) onLoaded(r);
    } catch (e) { toast(e.message, 'error'); }
  }
  return { state: s, refresh };
}

// Read page URL hash to know current route (for notification redirects)
function getRouteFromHash() {
  const h = (window.location.hash || '').replace('#/', '');
  return h || 'dashboard';
}

// File size formatter
function bytes(n) {
  if (n == null) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

// Build attachment chip HTML
function attachChip(a) {
  if (!a) return '';
  const isImg = /\.(png|jpe?g|gif|webp)$/i.test(a.url || '') ||
                /\.(png|jpe?g|gif|webp)$/i.test(a.name || '');
  if (isImg) {
    return `<a href="${a.url}" target="_blank" class="attach-item">
      <img src="${a.url}" alt="${escapeHtml(a.name||'')}" />
      <span>${escapeHtml(a.name||'image')}</span>
    </a>`;
  }
  return `<a href="${a.url}" target="_blank" class="attach-item">
    📎 <span>${escapeHtml(a.name||'file')}</span>
    <span style="color:var(--muted);font-size:10px">${bytes(a.size)}</span>
  </a>`;
}

// Notification: clickable redirect + outside click close
const NotifManager = {
  init() {
    document.addEventListener('click', (e) => {
      const wrap = document.getElementById('notifWrap');
      if (wrap && !wrap.contains(e.target)) wrap.classList.remove('open');
    });
  },
};
document.addEventListener('DOMContentLoaded', () => NotifManager.init());

Object.assign(window, {
  $, $$, LS, api, apiUpload, toast, Modal, logLine, initNav,
  escapeHtml, debounce, animateNum, timeAgo, applyTheme,
  renderPager, initNotifBell, uploadAvatar, pulse,
  setThemeSync: fn => { _themeSync = fn; },
  ROLE_RANK, hasRole, rolePill,
  hasPerm, roleChip, methodClass, prettyJson, bytesFmt,
  // v6.0
  makeListController, getRouteFromHash, bytes, attachChip, NotifManager,
});