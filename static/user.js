/* =========================================================
   User Panel — v6.0
   ========================================================= */

(async function initUser() {
  let me;
  try {
    me = await api('/api/me');
    if (!me.email) { location.href = '/'; return; }
    if (me.kind === 'admin') { location.href = '/admin'; return; }
  } catch { location.href = '/'; return; }

  // disabled users can only see tickets
  const DISABLED = (me.status || 'active') !== 'active';

  applyTheme(me.theme || 'dark', false);
  setThemeSync(debounce(async t => { try { await api('/api/me', { method: 'PUT', body: JSON.stringify({ theme: t }) }); } catch {} }, 500));

  $('#who-name').textContent = me.name || 'User';
  const roleEl = $('#who-role');
  if (roleEl) roleEl.textContent = (me.role_label || 'USER').toUpperCase();
  $('#hero-name').textContent = (me.name || 'User').split(' ')[0];

  function setAvatar(m) {
    const chip = $('#avatarChip');
    const prev = $('#avatarPreview');
    const who = $('#who-avatar');
    const initial = (m.name || m.email || 'U').trim().charAt(0).toUpperCase();
    const url = m.avatar ? `/avatars/${m.avatar}?t=${Date.now()}` : null;

    if (chip) chip.innerHTML = url ? `<img src="${url}" alt="" />` : `<span>${initial}</span>`;
    if (prev) prev.innerHTML = url ? `<img src="${url}" alt="" />` : `<span>${initial}</span>`;
    if (who) who.innerHTML = url ? `<img src="${url}" alt="" />` : initial;
    if (who) who.style.overflow = 'hidden';
  }
  setAvatar(me);

  // plan pill
//   function renderPlanPill() {
//     const plan = me.plan;
//     if (!plan) return;
//     const cls = plan.id === 'premium' ? 'premium' : plan.id === 'pro' ? 'pro' : 'free';
//     $('#planPillWrap').innerHTML = `<span class="plan-chip ${cls}">${plan.icon || '💎'} ${plan.name}</span>`;
//   }
//   renderPlanPill();

  initNav({
    dashboard: 'Dashboard', tickets: 'Support', tools: 'API Tools',
    plan: 'My Plan', settings: 'Settings',
  });

  // disabled users: hide everything except tickets + settings
  if (DISABLED) {
    ['dashboard','tools','plan'].forEach(v => {
      const el = $$('.nav-item').find(n => n.dataset.view === v);
      if (el) el.style.display = 'none';
    });
    // tickets remain accessible
    $$('.nav-item').find(n => n.dataset.view === 'tickets')?.click();
    setTimeout(() => Modal.alert('Account Disabled',
      'Your account is currently disabled. Only the Support tab is available — you can create and reply to tickets. Contact admin to restore full access.'), 500);
  }

  // who chip + avatar chip → settings
  $('#whoChip')?.addEventListener('click', () => $$('.nav-item').find(n => n.dataset.view === 'settings')?.click());
  $('#avatarChip')?.addEventListener('click', () => $$('.nav-item').find(n => n.dataset.view === 'settings')?.click());

  const notif = await initNotifBell({ onCount: n => animateNum($('#stat-unread'), n) });

  // =========================================================
  //  STATS
  // =========================================================
  async function loadStats() {
    try {
      const s = await api('/api/stats');
      const usageEl = $('#stat-usage') || $('#stat-actions');
      if (usageEl) animateNum(usageEl, s.actions || 0);
      animateNum($('#stat-sessions'), s.sessions || 0);
      animateNum($('#stat-tickets'), s.tickets || 0);
      animateNum($('#stat-unread'), s.unread || 0);
    } catch {}
  }

  // =========================================================
  //  ACTIVITY
  // =========================================================
  // Dashboard recent activity feed — has its own pagination
  const dashActState = { page: 1, limit: 5, sort: 'at|desc' };

  async function loadDashboardActivity() {
    try {
      const [sort, order] = dashActState.sort.split('|');
      const params = new URLSearchParams({
        page: dashActState.page,
        limit: dashActState.limit,
        sort, order,
      });
      const r = await api('/api/activity?' + params);
      const feed = $('#activity-list');
      if (!r.items.length) feed.innerHTML = `<div class="empty">No activity yet.</div>`;
      else feed.innerHTML = r.items.map(x => `
        <div class="activity-item"><span class="dot ok"></span>
          <span class="a-region">${escapeHtml(x.action)}</span>
          <span class="a-time">${timeAgo(x.at)}</span></div>`).join('');
      renderPager($('#recentPager'), r, p => {
        dashActState.page = p;
        loadDashboardActivity();
      });
    } catch (e) { toast(e.message, 'error'); }
  }

  $('#dashActSort')?.addEventListener('change', e => {
    dashActState.sort = e.target.value;
    dashActState.page = 1;
    loadDashboardActivity();
  });

  // =========================================================
  //  TICKETS
  // =========================================================
  const ticketState = { page: 1, limit: 10 };
  let _tickets = [], _activeTicket = null;

  async function loadTickets() {
    try {
      const params = new URLSearchParams({ page: ticketState.page, limit: ticketState.limit });
      const r = await api('/api/tickets?' + params);
      _tickets = r.items;
      const list = $('#ticketList');
      if (!r.items.length) list.innerHTML = `<div class="empty">No tickets yet. Click "+ New Ticket".</div>`;
      else {
        list.innerHTML = r.items.map(t => `
          <div class="ticket-card ${_activeTicket && _activeTicket.id === t.id ? 'active' : ''}" data-tid="${t.id}">
            <div class="row1"><span class="subj">${escapeHtml(t.subject)}</span>
              <span class="pill ${t.priority}">${escapeHtml(t.priority)}</span></div>
            <div class="row2"><span class="pill ${t.status}">${t.status.replace('_',' ')}</span>
              <span class="spacer"></span><span>${timeAgo(t.updated)}</span></div>
          </div>`).join('');
        list.querySelectorAll('.ticket-card').forEach(c => c.onclick = () => openTicket(c.dataset.tid));
      }
      renderPager($('#ticketsPager'), r, p => { ticketState.page = p; loadTickets(); });
    } catch (e) { toast(e.message, 'error'); }
  }

  async function openTicket(tid) {
    try {
      const t = await api('/api/tickets/' + tid);
      _activeTicket = t;
      $$('.ticket-card').forEach(c => c.classList.toggle('active', c.dataset.tid === tid));
      renderTicketDetail();
    } catch (e) { toast(e.message, 'error'); }
  }
  window.__openTicket = openTicket;  // ← for notification redirect
  function renderTicketDetail() {
    const t = _activeTicket, el = $('#ticketDetail');
    if (!t) { el.innerHTML = `<div class="empty">Select a ticket.</div>`; return; }
    const isClosed = t.status === 'closed';
    el.innerHTML = `
      <div class="panel" style="margin:0;position:relative">
        <div class="panel-head">
          <h3 style="font-size:13px">${escapeHtml(t.subject)}</h3>
          <button class="modal-x" id="closeTicketDetail">×</button>
        </div>
        <div class="muted" style="font-size:11.5px;font-family:var(--font-mono);margin-bottom:10px">
          opened ${timeAgo(t.created)} · priority <span class="pill ${t.priority}">${t.priority}</span>
        </div>
        <div class="ticket-thread" id="ticketThread">
          ${t.messages.map(m => `
            <div class="ticket-msg ${m.from_role === 'user' ? 'mine' : ''}">
              <div class="meta">${escapeHtml(m.from_name || 'User')} · ${timeAgo(m.at)}</div>
              <div class="body">${escapeHtml(m.body || '')}</div>
              ${(m.attachments||[]).length ? `<div class="attach-list">${m.attachments.map(attachChip).join('')}</div>` : ''}
            </div>`).join('')}
        </div>
        ${!isClosed ? `
          <div class="ticket-reply">
            <div class="ticket-composer">
              <label class="attach-btn" title="Attach">📎<input type="file" id="ticketFileInput" multiple style="display:none" /></label>
              <textarea id="ticketReplyBody" placeholder="Type your reply... (Enter to send)"></textarea>
              <button class="btn btn-primary send-btn" id="sendReplyBtn">Send</button>
            </div>
            <div class="attach-preview" id="pendingAttach"></div>
          </div>` : `<p class="muted" style="margin-top:12px;text-align:center">🔒 Closed ticket. Admin must reopen to continue.</p>`}
      </div>`;

    $('#closeTicketDetail').onclick = () => { _activeTicket = null; renderTicketDetail(); };

    if (!isClosed) {
      const pending = [];
      const fileInput = $('#ticketFileInput');
      fileInput.onchange = async e => {
        for (const f of e.target.files) {
          const fd = new FormData(); fd.append('file', f);
          try { const up = await apiUpload('/api/upload/ticket', fd);
            pending.push({ url: up.url, name: up.name, size: up.size });
            renderPending();
          } catch (err) { toast(err.message, 'error'); }
        }
        e.target.value = '';
      };
      function renderPending() {
        $('#pendingAttach').innerHTML = pending.map((a, i) =>
          `<div class="attach-chip">📎 ${escapeHtml(a.name)} <span class="x" data-idx="${i}">×</span></div>`
        ).join('');
        $$('#pendingAttach .x').forEach(x => x.onclick = () => { pending.splice(+x.dataset.idx, 1); renderPending(); });
      }
      $('#sendReplyBtn').onclick = async () => {
        const body = $('#ticketReplyBody').value.trim();
        if (!body && !pending.length) return toast('Empty', 'warn');
        try {
          const r = await api(`/api/tickets/${t.id}/reply`, { method: 'POST',
            body: JSON.stringify({ body, attachments: pending }) });
          _activeTicket = r.ticket;
          pending.length = 0;
          toast('Replied'); renderTicketDetail(); loadTickets(); loadStats();
        } catch (e) { toast(e.message, 'error'); }
      };
      $('#ticketReplyBody')?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#sendReplyBtn').click(); }
      });
    }
  }

  $('#newTicketBtn').onclick = () => Modal.form({
    title: 'New Support Ticket', submitLabel: 'Create',
    fields: [
      { name: 'subject', label: 'Subject', required: true },
      { name: 'priority', label: 'Priority', type: 'select',
        options: [{ value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }],
        value: 'normal' },
      { name: 'body', label: 'Describe your issue', type: 'textarea', required: true, rows: 5 },
    ],
    onSubmit: async d => {
      await api('/api/tickets', { method: 'POST', body: JSON.stringify(d) });
      Modal.close(); toast('Created'); loadTickets(); loadStats(); loadActivity();
    },
  });

  // =========================================================
  //  API TOOLS  (params-driven, URL hidden)
  // =========================================================
  let _shared = [];

  async function loadShared() {
    try {
      _shared = await api('/api/shared/mine');
      const list = $('#toolsList');
      if (!_shared.length) {
        list.innerHTML = `<div class="empty">No API tools available for your plan.</div>`;
        return;
      }
      list.innerHTML = _shared.map(s => {
        const creditTxt = s.credit_limit == null
          ? '<span class="credit-badge ok">⚡ Unlimited</span>'
          : `<span class="credit-badge ${s.remaining === 0 ? 'danger' : 'ok'}">⚡ ${s.used} / ${s.credit_limit} per ${s.credit_period}</span>`;
        const exp = s.expires_at ? `<span class="credit-badge">⏰ ${new Date(s.expires_at).toLocaleDateString('en-GB')}</span>` : '';
        return `<div class="api-use-card" data-sid="${s.id}">
          <h4>${escapeHtml(s.name)} ${creditTxt} ${exp}</h4>
          ${s.description ? `<div class="desc">${escapeHtml(s.description)}</div>` : ''}
          ${s.params && s.params.length ? `
            <div class="params-grid">
              ${s.params.map(p => `
                <div class="param-field">
                  <label>${escapeHtml(p.label || p.name)}${p.required ? ' *' : ''}</label>
                  <input data-pname="${escapeHtml(p.name)}" type="${p.type === 'number' ? 'number' : 'text'}"
                         placeholder="${escapeHtml(p.default || '')}" value="${escapeHtml(p.default || '')}" />
                </div>`).join('')}
            </div>` : '<div class="desc" style="font-size:11.5px">No parameters required.</div>'}
          <button class="btn btn-primary" data-run="${s.id}" ${s.remaining === 0 ? 'disabled' : ''}>
            ${s.remaining === 0 ? '🚫 Limit Reached' : '▶ Run'}
          </button>
        </div>`;
      }).join('');
      list.querySelectorAll('[data-run]').forEach(b => b.onclick = () => runShared(b.dataset.run, b.closest('.api-use-card')));
    } catch (e) { toast(e.message, 'error'); }
  }

  async function runShared(id, cardEl) {
    const s = _shared.find(x => x.id === id); if (!s) return;
    const params = {};
    if (cardEl) {
      cardEl.querySelectorAll('[data-pname]').forEach(inp => {
        params[inp.dataset.pname] = inp.value;
      });
      // validate required
      for (const p of (s.params||[])) {
        if (p.required && !params[p.name]) {
          return toast(`Please fill: ${p.label || p.name}`, 'warn');
        }
      }
    }
    const btn = cardEl?.querySelector('[data-run]');
    if (btn) { btn.disabled = true; btn.textContent = 'Running...'; }
    try {
      const r = await api(`/api/shared/${id}/execute`, { method: 'POST', body: JSON.stringify({ params }) });
      showSharedResult(s, r);
      loadShared(); loadStats(); loadActivity();
    } catch (e) {
      toast(e.message, 'error');
      loadShared();
    }
  }

  function showSharedResult(s, r) {
    const cls = r.status >= 500 ? 'status-5xx' : r.status >= 400 ? 'status-4xx' :
                r.status >= 300 ? 'status-3xx' : 'status-2xx';
    const creditLine = r.credits_limit == null
      ? '<span class="resp-stat"><span class="lbl">Credits</span><span class="val">unlimited</span></span>'
      : `<span class="resp-stat"><span class="lbl">Credits</span><span class="val">${r.credits_used} / ${r.credits_limit}</span></span>`;
    Modal.open({
      title: `Result — ${s.name}`, width: 720,
      body: `
        <div class="resp-stats" style="margin-bottom:12px">
          <div class="resp-stat"><span class="lbl">Status</span><span class="val ${cls}">${r.status} ${r.status_text || ''}</span></div>
          <div class="resp-stat"><span class="lbl">Time</span><span class="val">${r.time_ms} ms</span></div>
          <div class="resp-stat"><span class="lbl">Size</span><span class="val">${bytesFmt(r.size)}</span></div>
          ${creditLine}
        </div>
        <div class="resp-body" style="max-height:360px">${escapeHtml(prettyJson(r.body || ''))}</div>`,
      actions: [
        { label: 'Copy', cls: 'btn-ghost', onClick: async () => {
            try { await navigator.clipboard.writeText(r.body || ''); toast('Copied'); } catch { toast('Copy failed','error'); }
          } },
        { label: 'Close', cls: 'btn-primary', onClick: () => Modal.close() },
      ],
    });
  }

  // =========================================================
  //  MY PLAN
  // =========================================================
  async function loadMyPlan() {
    try {
      const data = await api('/api/my-subscription');
      const { subscription, plan, plans_active, all_plans } = data;
      const activeIds = new Set((plans_active || []).map(p => p.id));
      const daysLeft = subscription.expires_at
        ? Math.max(0, Math.ceil((new Date(subscription.expires_at) - Date.now()) / 86400000))
        : null;
      $('#myPlanWrap').innerHTML = `
        <div class="sub-status" style="--pc:${plan.color}">
          <div class="icon">${escapeHtml(plan.icon || '💎')}</div>
          <div class="info">
            <div class="plan-name-big">${escapeHtml(plan.name)} Plan</div>
            <div class="sub-meta">
              Status: <b>${subscription.status}</b>
              ${daysLeft !== null && daysLeft < 36500 ? ` · Expires in <b>${daysLeft} day${daysLeft===1?'':'s'}</b>` : ''}
              ${subscription.auto_renew ? ' · Auto-renew ON' : ''}
            </div>
          </div>
        </div>
        <ul class="plan-features">
          ${(plan.features || []).map(f => `<li style="--pc:${plan.color}">${escapeHtml(f)}</li>`).join('')}
        </ul>
        ${plans_active && plans_active.length > 1 ? `
          <div style="margin-top:16px">
            <div class="muted" style="font-size:11px;letter-spacing:1.2px;margin-bottom:8px">ALSO ACTIVE</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${plans_active.slice(1).map(p => roleChip(p.id, p.name, p.color)).join('')}
            </div>
          </div>` : ''}`;

      $('#allPlansGrid').innerHTML = all_plans.map(p => {
        const isCurrent = activeIds.has(p.id);
        const isFree = p.price <= 0;
        return `<div class="pricing-card ${isCurrent ? 'current' : ''}" style="--pc:${p.color}">
          <div class="icon">${escapeHtml(p.icon || '💎')}</div>
          <h3>${escapeHtml(p.name)}</h3>
          <div class="price">${isFree ? 'Free' : (p.currency||'BDT') + ' ' + p.price}
            ${!isFree ? `<small>/ ${p.duration_days}d</small>` : ''}</div>
          <ul>${(p.features||[]).map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
          ${isCurrent ? `<div style="margin-top:14px"><span class="pill ok">CURRENT PLAN</span></div>` :
            (isFree ? `<button class="btn btn-ghost" disabled style="margin-top:16px">Free</button>` :
            `<button class="btn btn-primary" data-buy="${p.id}" style="margin-top:16px">Purchase ${escapeHtml(p.name)}</button>`)}
        </div>`;
      }).join('');

      $('#allPlansGrid').querySelectorAll('[data-buy]').forEach(b => b.onclick = () => buyPlan(b.dataset.buy));
      loadPaymentHistory();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function buyPlan(planId) {
    const ok = await Modal.confirm('Confirm Purchase',
      `Proceed to payment for this plan?`, { okLabel: 'Pay Now' });
    if (!ok) return;
    try {
      const r = await api('/api/payments/checkout', { method: 'POST', body: JSON.stringify({ plan_id: planId }) });
      if (r.free) { toast('Activated'); loadMyPlan(); return; }
      if (r.bkashURL) {
        toast('Redirecting to payment gateway...');
        setTimeout(() => window.location.href = r.bkashURL, 600);
      }
    } catch (e) { toast(e.message, 'error'); }
  }

  async function loadPaymentHistory() {
    try {
      const list = await api('/api/payments/history');
      const tb = $('#paymentHistoryBody');
      if (!list.length) tb.innerHTML = `<tr><td colspan="5" class="empty">No payments yet.</td></tr>`;
      else tb.innerHTML = list.map(p => `
        <tr>
          <td>${new Date(p.created).toLocaleString('en-GB')}</td>
          <td>${escapeHtml(p.plan_id)}</td>
          <td>${p.amount} ${p.currency}</td>
          <td><span class="pill ${p.status==='completed'?'ok':p.status==='pending'?'':'bad'}">${p.status}</span></td>
          <td style="font-family:var(--font-mono);font-size:11px">${escapeHtml(p.provider_trx_id||'—')}</td>
        </tr>`).join('');
    } catch {}
  }

  // =========================================================
  //  SETTINGS
  // =========================================================
  $('#changeNameBtn').onclick = () => Modal.form({
    title: 'Change Name', submitLabel: 'Save',
    fields: [{ name: 'name', label: 'Display Name', required: true, value: me.name || '' }],
    onSubmit: async d => { await api('/api/me', { method: 'PUT', body: JSON.stringify(d) });
      Modal.close(); toast('Updated'); me = await api('/api/me');
      $('#who-name').textContent = me.name;
      $('#hero-name').textContent = (me.name || 'User').split(' ')[0];
      setAvatar(me); loadActivity(); },
  });
  $('#changeEmailBtn').onclick = () => Modal.form({
    title: 'Change Email', submitLabel: 'Save',
    fields: [{ name: 'email', label: 'New Email', type: 'email', required: true, value: me.email }],
    onSubmit: async d => { await api('/api/me', { method: 'PUT', body: JSON.stringify(d) });
      Modal.close(); toast('Updated'); me = await api('/api/me');
      $('#who-email').textContent = me.email; loadActivity(); },
  });
  $('#changePwBtn').onclick = () => Modal.form({
    title: 'Change Password', submitLabel: 'Change',
    fields: [{ name: 'password', label: 'New Password', type: 'password', required: true }],
    onSubmit: async d => { await api('/api/me', { method: 'PUT', body: JSON.stringify(d) });
      Modal.close(); toast('Changed'); loadActivity(); },
  });
  $('#avatarUploadBtn').onclick = () => $('#avatarFile').click();
  $('#avatarFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { await uploadAvatar(f); toast('Uploaded'); me = await api('/api/me'); setAvatar(me); loadActivity(); }
    catch (err) { toast(err.message, 'error'); }
    e.target.value = '';
  };
  $('#avatarRemoveBtn').onclick = async () => {
    const ok = await Modal.confirm('Remove Avatar', 'Remove?', { danger: true, okLabel: 'Remove' });
    if (!ok) return;
    try { await api('/api/avatar', { method: 'DELETE' }); toast('Removed'); me = await api('/api/me'); setAvatar(me); loadActivity(); }
    catch (e) { toast(e.message, 'error'); }
  };

  async function render2FA() {
    const area = $('#twofaArea'), tag = $('#twofaTag');
    me = await api('/api/me');
    const enabled = me.has2fa;
    tag.textContent = enabled ? 'ON' : 'OFF'; tag.classList.toggle('ok', enabled);
    if (enabled) {
      area.innerHTML = `<div class="twofa-box"><div class="twofa-info">
        <h4>✅ 2FA enabled</h4><p>Account protected.</p>
        <button class="btn btn-danger" id="disable2faBtn">Disable 2FA</button></div></div>`;
      $('#disable2faBtn').onclick = () => Modal.form({
        title: 'Disable 2FA', submitLabel: 'Disable',
        fields: [{ name: 'password', label: 'Password', type: 'password', required: true }],
        onSubmit: async d => { await api('/api/2fa/disable', { method: 'POST', body: JSON.stringify(d) });
          Modal.close(); toast('Disabled'); render2FA(); },
      });
    } else {
      area.innerHTML = `<div style="text-align:center;padding:20px 0">
        <p class="muted" style="margin-bottom:14px">Add 2FA protection.</p>
        <button class="btn btn-primary" id="setup2faBtn">Set Up 2FA</button></div>`;
      $('#setup2faBtn').onclick = async () => {
        try {
          const s = await api('/api/2fa/setup', { method: 'POST', body: '{}' });
          area.innerHTML = `<div class="twofa-box">
            <div class="twofa-qr"><img src="${s.qr}" alt="QR" /></div>
            <div class="twofa-info">
              <h4>1. Scan QR</h4><p>Or secret:</p>
              <div class="twofa-secret">${s.secret}</div>
              <h4>2. Verify</h4>
              <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px">
                <input type="text" id="verifyCode" class="twofa-code-input" maxlength="6" placeholder="______" />
                <button class="btn btn-primary" id="verify2faBtn">Verify & Enable</button>
                <button class="btn btn-ghost" id="cancel2faBtn">Cancel</button>
              </div></div></div>`;
          $('#cancel2faBtn').onclick = () => render2FA();
          $('#verify2faBtn').onclick = async () => {
            const code = $('#verifyCode').value.trim();
            if (!code) return toast('Enter code', 'warn');
            try { await api('/api/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) });
              toast('Enabled'); render2FA(); }
            catch (e) { toast(e.message, 'error'); }
          };
        } catch (e) { toast(e.message, 'error'); }
      };
    }
  }
  $('#wipeBtn').onclick = async () => {
    const ok = await Modal.confirm('Reset Preferences', 'Clear local data?', { danger: true, okLabel: 'Reset' });
    if (!ok) return;
    Object.keys(localStorage).filter(k => k.startsWith('panel_')).forEach(k => localStorage.removeItem(k));
    toast('Reset'); setTimeout(() => location.reload(), 500);
  };
  $('#deleteAccountBtn').onclick = () => Modal.form({
    title: 'Delete My Account', submitLabel: 'Permanently Delete',
    fields: [{ name: 'password', label: 'Confirm Password', type: 'password', required: true }],
    onSubmit: async d => {
      try { await api('/api/me/delete', { method: 'POST', body: JSON.stringify(d) });
        toast('Account deleted'); setTimeout(() => location.href = '/', 800); }
      catch (e) { toast(e.message, 'error'); }
    },
  });
  $('#logoutBtn').onclick = async () => {
    const ok = await Modal.confirm('Sign Out', 'Sign out?', { okLabel: 'Sign Out' });
    if (!ok) return;
    try { await api('/api/logout', { method: 'POST' }); } catch {}
    location.href = '/';
  };

  // =========================================================
  //  INIT
  // =========================================================
  await Promise.all([
    loadStats(), loadDashboardActivity(), loadTickets(), loadShared(), loadMyPlan(), render2FA(),
  ]);
  logLine('User session started.', 'ok');
  setInterval(() => { loadStats(); notif.refresh(); loadShared(); loadDashboardActivity(); }, 20000);
})();