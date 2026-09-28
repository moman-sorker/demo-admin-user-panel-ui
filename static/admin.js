/* =========================================================
   Admin Panel — v6.0
   ========================================================= */

(async function initAdmin() {
  let me;
  try { me = await api('/api/me'); if (me.kind !== 'admin') { location.href = '/'; return; } }
  catch { location.href = '/'; return; }

  const MY_ROLE = me.role || 'viewer';
  const PERMS = me.permissions || [];
  const can = p => hasPerm(PERMS, p);

  applyTheme(me.theme || 'dark', false);
  setThemeSync(debounce(async t => { try { await api('/api/me', { method: 'PUT', body: JSON.stringify({ theme: t }) }); } catch {} }, 500));

  $('#who-name').textContent = me.name || 'Admin';
  const roleEl = $('#who-role');
  if (roleEl) roleEl.textContent = (me.role_label || me.role || 'ADMIN').toUpperCase();
  $('#hero-name').textContent = (me.name || 'Admin').split(' ')[0];

  let roleDefs = {};
  try { const r = await api('/api/roles'); r.roles.forEach(x => roleDefs[x.name] = x); } catch {}

  function setAvatar(m) {
    if (!m) return;
    const chip = $('#avatarChip');
    const prev = $('#avatarPreview');
    const who = $('#who-avatar');
    const initial = (m.name || m.email || 'A').trim().charAt(0).toUpperCase();
    const url = m.avatar ? `/avatars/${m.avatar}?t=${Date.now()}` : null;

    if (chip) chip.innerHTML = url ? `<img src="${url}" alt="" />` : `<span>${initial}</span>`;
    if (prev) prev.innerHTML = url ? `<img src="${url}" alt="" />` : `<span>${initial}</span>`;
    if (who) {
      who.innerHTML = url ? `<img src="${url}" alt="" />` : initial;
      who.style.overflow = 'hidden';
    }
  }
  setAvatar(me);
  // NOTE: #rolePillWrap removed in v6.1 — role label is now shown under name.

  initNav({
    dashboard: 'Dashboard', users: 'User Management', admins: 'Admin Management',
    tickets: 'Support Tickets', notifications: 'Broadcast',
    activity: 'Activity Log', roles: 'Roles & Permissions',
    postman: 'API Tester', shared: 'Shared APIs', subscriptions: 'Subscriptions',
    settings: 'Settings',
  });

  // hide nav items
  const hideNav = (v, c) => { const el = $$('.nav-item').find(n => n.dataset.view === v); if (el) el.style.display = c ? 'none' : ''; };
  hideNav('admins', !can('admins.view'));
  hideNav('notifications', !can('broadcast.send'));
  hideNav('roles', !can('roles.manage'));
  hideNav('postman', !can('api_tester.use'));
  hideNav('shared', !can('api_share.manage'));
  hideNav('subscriptions', !can('subscriptions.manage'));

  const notif = await initNotifBell({ onCount: n => animateNum($('#stat-unread'), n) });

  // who chip + avatar chip → settings
  $('#whoChip')?.addEventListener('click', () => $$('.nav-item').find(n => n.dataset.view === 'settings')?.click());
  $('#avatarChip')?.addEventListener('click', () => $$('.nav-item').find(n => n.dataset.view === 'settings')?.click());

  // =========================================================
  //  STATS
  // =========================================================
  async function loadStats() {
    try {
      const s = await api('/api/stats');
      animateNum($('#stat-users'), s.users || 0);
      animateNum($('#stat-admins'), s.admins || 0);
      animateNum($('#stat-tickets'), s.tickets || 0);
      animateNum($('#stat-payments'), s.payments || 0);
    } catch {}
  }

  // =========================================================
  //  ROLES
  // =========================================================
  let ALL_PERMS = [];
  try { const r = await api('/api/roles'); ALL_PERMS = r.permissions; } catch {}

  async function loadRoles() {
    if (!can('roles.manage')) return;
    try {
      const r = await api('/api/roles');
      roleDefs = {}; r.roles.forEach(x => roleDefs[x.name] = x);
      const wrap = $('#rolesList');
      wrap.innerHTML = r.roles.map(role => `
        <div class="role-edit-card">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
            <span class="role-color-dot" style="background:${role.color};color:${role.color}"></span>
            ${roleChip(role.name, role.label, role.color)}
            ${role.built_in ? '<span class="pill">BUILT-IN</span>' : '<span class="pill ok">CUSTOM</span>'}
            <span style="flex:1"></span>
            <button class="mini-btn" data-edit-role="${role.name}">EDIT</button>
            ${!role.built_in ? `<button class="mini-btn danger" data-del-role="${role.name}">DEL</button>` : ''}
          </div>
          <div class="perm-grid">
            ${r.permissions.map(p => `<div class="perm-item ${role.permissions.includes(p) ? 'checked' : ''}">
              <div class="perm-name">${p}</div></div>`).join('')}
          </div>
        </div>`).join('');
      wrap.querySelectorAll('[data-edit-role]').forEach(b => b.onclick = () => editRole(b.dataset.editRole));
      wrap.querySelectorAll('[data-del-role]').forEach(b => b.onclick = () => delRole(b.dataset.delRole));
    } catch (e) { toast(e.message, 'error'); }
  }

  async function editRole(name) {
    if (!can('roles.manage')) return;
    const r = await api('/api/roles');
    const role = r.roles.find(x => x.name === name); if (!role) return;
    const perms = r.permissions;
    const body = `
      <div style="max-height:400px;overflow:auto">
        ${!role.built_in ? `
          <div class="field"><label>Label</label><input id="roleLabel" value="${escapeHtml(role.label)}" /></div>
          <div class="field"><label>Color (hex)</label><input id="roleColor" value="${escapeHtml(role.color)}" /></div>
        ` : ''}
        <div class="field"><label>Permissions</label></div>
        <div class="perm-grid" id="permGrid">
          ${perms.map(p => `<label class="perm-item ${role.permissions.includes(p) ? 'checked' : ''}">
            <input type="checkbox" value="${p}" ${role.permissions.includes(p) ? 'checked' : ''} />
            <div><div class="perm-name">${p}</div></div>
          </label>`).join('')}
        </div>
      </div>`;
    Modal.open({
      title: `Edit Role: ${role.label}`, body,
      actions: [
        { label: 'Cancel', cls: 'btn-ghost', onClick: () => Modal.close() },
        { label: 'Save', cls: 'btn-primary', onClick: async () => {
            const ov = $('.modal-overlay');
            const selected = [...ov.querySelectorAll('#permGrid input:checked')].map(i => i.value);
            const payload = { permissions: selected };
            if (!role.built_in) {
              payload.label = ov.querySelector('#roleLabel')?.value || role.label;
              payload.color = ov.querySelector('#roleColor')?.value || role.color;
            }
            try { await api('/api/roles/' + name, { method: 'PUT', body: JSON.stringify(payload) });
              Modal.close(); toast('Role updated'); loadRoles(); }
            catch (e) { toast(e.message, 'error'); }
          } },
      ],
    });
    setTimeout(() => {
      $$('.perm-item').forEach(el => el.addEventListener('click', e => {
        if (e.target.tagName !== 'INPUT') el.querySelector('input').click();
        el.classList.toggle('checked', el.querySelector('input').checked);
      }));
    }, 40);
  }

  function addRoleModal() {
    Modal.open({
      title: 'Create New Role',
      body: `
        <div class="field"><label>Role Name (slug)</label><input id="newRoleName" placeholder="moderator" /></div>
        <div class="field"><label>Label</label><input id="newRoleLabel" placeholder="Moderator" /></div>
        <div class="field"><label>Color (hex)</label><input id="newRoleColor" value="#00ff9d" /></div>
        <div class="field"><label>Permissions</label></div>
        <div class="perm-grid" id="permGridNew">
          ${ALL_PERMS.map(p => `<label class="perm-item"><input type="checkbox" value="${p}" /><div><div class="perm-name">${p}</div></div></label>`).join('')}
        </div>`,
      width: 640,
      actions: [
        { label: 'Cancel', cls: 'btn-ghost', onClick: () => Modal.close() },
        { label: 'Create', cls: 'btn-primary', onClick: async () => {
            const ov = $('.modal-overlay');
            const payload = {
              name: ov.querySelector('#newRoleName').value.trim(),
              label: ov.querySelector('#newRoleLabel').value.trim(),
              color: ov.querySelector('#newRoleColor').value.trim() || '#00ff9d',
              permissions: [...ov.querySelectorAll('#permGridNew input:checked')].map(i => i.value),
            };
            if (!payload.name) return toast('Name required', 'warn');
            try { await api('/api/roles', { method: 'POST', body: JSON.stringify(payload) });
              Modal.close(); toast('Role created'); loadRoles(); }
            catch (e) { toast(e.message, 'error'); }
          } },
      ],
    });
    setTimeout(() => {
      $$('.perm-item').forEach(el => el.addEventListener('click', e => {
        if (e.target.tagName !== 'INPUT') el.querySelector('input').click();
        el.classList.toggle('checked', el.querySelector('input').checked);
      }));
    }, 40);
  }

  async function delRole(name) {
    const ok = await Modal.confirm('Delete Role', `Delete role "${name}"?`, { danger: true, okLabel: 'Delete' });
    if (!ok) return;
    try { await api('/api/roles/' + name, { method: 'DELETE' }); toast('Deleted'); loadRoles(); }
    catch (e) { toast(e.message, 'error'); }
  }

  $('#addRoleBtn')?.addEventListener('click', () => { if (can('roles.manage')) addRoleModal(); });

  // =========================================================
  //  USERS  (with sort, search, pagination, view modal)
  // =========================================================
  const userState = { page: 1, limit: 10, q: '', status: '', sort: 'created|desc' };
  let _users = [];
  const _selected = new Set();

  async function loadUsers() {
    try {
      const [sort, order] = userState.sort.split('|');
      const params = new URLSearchParams({
        page: userState.page, limit: userState.limit,
        q: userState.q, status: userState.status,
        sort, order,
      });
      const r = await api('/api/users?' + params.toString());
      _users = r.items;
      const tb = $('#usersBody');
      if (!r.items.length) {
        tb.innerHTML = `<tr><td colspan="7" class="empty">No users.</td></tr>`;
      } else {
        tb.innerHTML = r.items.map(u => `
          <tr>
            <td>${can('users.edit') ? `<input type="checkbox" class="checkbox user-check" data-uid="${u.id}" ${_selected.has(u.id) ? 'checked' : ''} />` : '—'}</td>
            <td>${escapeHtml(u.name || '—')}</td>
            <td class="email-mask">${maskEmail(u.email)}</td>
            <td><span class="pill ${u.status === 'active' ? 'ok' : 'bad'}">${escapeHtml(u.status || 'active')}</span></td>
            <td>${u.has2fa ? '<span class="pill ok">ON</span>' : '<span class="pill">OFF</span>'}</td>
            <td>${new Date(u.created).toLocaleDateString('en-GB')}</td>
            <td class="actions">
              <button class="mini-btn" data-view-user="${u.id}">VIEW</button>
              ${can('broadcast.send') ? `<button class="mini-btn" data-notify-user="${u.id}">NOTIFY</button>` : ''}
              ${can('users.delete') ? `<button class="mini-btn danger" data-del-user="${u.id}">DEL</button>` : ''}
            </td>
          </tr>`).join('');
        tb.querySelectorAll('[data-view-user]').forEach(b => b.onclick = () => viewUser(b.dataset.viewUser));
        tb.querySelectorAll('[data-del-user]').forEach(b => b.onclick = () => delUser(b.dataset.delUser));
        tb.querySelectorAll('[data-notify-user]').forEach(b => b.onclick = () => notifyOneUser(b.dataset.notifyUser));
        tb.querySelectorAll('.user-check').forEach(c => c.onchange = () => {
          if (c.checked) _selected.add(c.dataset.uid); else _selected.delete(c.dataset.uid);
          updateBulkBar();
        });
      }
      renderPager($('#usersPager'), r, p => { userState.page = p; loadUsers(); });
      updateBulkBar();
    } catch (e) { toast(e.message, 'error'); }
  }

  function maskEmail(e) {
    if (!e) return '—';
    const [n, d] = e.split('@');
    if (!d) return '***';
    return n.slice(0, 2) + '***@' + d;
  }

  function updateBulkBar() {
    const bar = $('#bulkBar'); if (!bar) return;
    bar.classList.toggle('show', _selected.size > 0);
    $('#bulkCount').textContent = `${_selected.size} selected`;
    if (!can('users.delete')) $('#bulkDelete').style.display = 'none';
    if (!can('users.edit')) { $('#bulkActivate').style.display = 'none'; $('#bulkDisable').style.display = 'none'; }
  }

  if (!can('users.create') && $('#addUserBtn')) { $('#addUserBtn').disabled = true; $('#addUserBtn').classList.add('soft'); }
  if (!can('users.edit') && $('#usersSelectAll')) $('#usersSelectAll').disabled = true;

  $('#userSearch')?.addEventListener('input', debounce(e => {
    userState.q = e.target.value.trim(); userState.page = 1; loadUsers();
  }, 300));
  $('#userStatus')?.addEventListener('change', e => { userState.status = e.target.value; userState.page = 1; loadUsers(); });
  $('#userSort')?.addEventListener('change', e => { userState.sort = e.target.value; userState.page = 1; loadUsers(); });
  $('#usersSelectAll')?.addEventListener('change', e => {
    _users.forEach(u => e.target.checked ? _selected.add(u.id) : _selected.delete(u.id));
    $$('.user-check').forEach(c => c.checked = e.target.checked); updateBulkBar();
  });

  async function bulkAction(action) {
    if (!_selected.size) return;
    const ok = await Modal.confirm('Bulk ' + action.toUpperCase(),
      `Apply "${action}" to ${_selected.size} user(s)?`,
      { danger: action === 'delete', okLabel: 'Yes' });
    if (!ok) return;
    try {
      await api('/api/users/bulk', { method: 'POST', body: JSON.stringify({ ids: [..._selected], action }) });
      toast(`Bulk ${action} ok`);
      _selected.clear(); if ($('#usersSelectAll')) $('#usersSelectAll').checked = false;
      loadUsers(); loadStats(); loadActivity();
    } catch (e) { toast(e.message, 'error'); }
  }
  $('#bulkActivate')?.addEventListener('click', () => bulkAction('activate'));
  $('#bulkDisable')?.addEventListener('click', () => bulkAction('disable'));
  $('#bulkDelete')?.addEventListener('click', () => bulkAction('delete'));

  function addUserModal() {
    Modal.form({
      title: 'Add New User', submitLabel: 'Create User',
      fields: [
        { name: 'name', label: 'Full Name', required: true },
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'password', label: 'Password', type: 'password', required: true },
        { name: 'status', label: 'Status', type: 'select',
          options: [{ value: 'active', label: 'Active' }, { value: 'disabled', label: 'Disabled' }], value: 'active' },
      ],
      onSubmit: async d => {
        await api('/api/users', { method: 'POST', body: JSON.stringify(d) });
        Modal.close(); toast('User created');
        loadUsers(); loadStats(); loadActivity();
      },
    });
  }

  async function viewUser(id) {
    try {
      const u = await api('/api/users/' + id);
      const d = new Date(u.created).toLocaleString('en-GB');
      const body = `
        <div class="field"><label>Full Name</label><input type="text" value="${escapeHtml(u.name||'')}" disabled /></div>
        <div class="field"><label>Email</label><input type="text" value="${escapeHtml(u.email||'')}" disabled /></div>
        <div class="field"><label>Password</label><input type="text" value="••••••••" disabled /></div>
        <div class="field"><label>Status</label>
          <select id="viewUserStatus" ${can('users.edit') ? '' : 'disabled'}>
            <option value="active" ${u.status==='active'?'selected':''}>Active</option>
            <option value="disabled" ${u.status==='disabled'?'selected':''}>Disabled</option>
          </select>
        </div>
        <div class="field"><label>Created</label><input type="text" value="${d}" disabled /></div>
        <div class="field"><label>2FA</label><input type="text" value="${u.has2fa ? 'Enabled' : 'Disabled'}" disabled /></div>
        <div style="margin-top:14px;padding:12px;background:var(--bg-3);border:1px dashed var(--border-2);border-radius:9px">
          <div style="font-size:12px;color:var(--muted);margin-bottom:8px">🔐 Password reset — only use if the user requests it</div>
          <button class="btn btn-ghost" id="resetPwBtn" style="width:100%">Reset Password</button>
        </div>`;
      Modal.open({
        title: `User: ${escapeHtml(u.name || u.email)}`,
        body,
        actions: [
          { label: 'Close', cls: 'btn-ghost', onClick: () => Modal.close() },
          { label: 'Save Status', cls: 'btn-primary', onClick: async () => {
              const ov = $('.modal-overlay');
              const status = ov.querySelector('#viewUserStatus').value;
              try { await api('/api/users/' + id, { method: 'PUT', body: JSON.stringify({ status }) });
                Modal.close(); toast('Status updated'); loadUsers(); }
              catch (e) { toast(e.message, 'error'); }
            } },
        ],
      });
      setTimeout(() => {
        $('#resetPwBtn')?.addEventListener('click', () => {
          Modal.close();
          Modal.form({
            title: 'Reset User Password', submitLabel: 'Reset',
            fields: [{ name: 'password', label: 'New Password (min 6)', type: 'password', required: true }],
            onSubmit: async d => {
              await api(`/api/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify(d) });
              Modal.close(); toast('Password reset');
            },
          });
        });
      }, 40);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function delUser(id) {
    const u = _users.find(x => x.id === id); if (!u) return;
    const ok = await Modal.confirm('Delete User', `Delete "${u.name || u.email}"?`, { danger: true, okLabel: 'Delete' });
    if (!ok) return;
    try { await api('/api/users/' + id, { method: 'DELETE' }); toast('Deleted'); loadUsers(); loadStats(); loadActivity(); }
    catch (e) { toast(e.message, 'error'); }
  }

  function notifyOneUser(id) {
    const u = _users.find(x => x.id === id); if (!u) return;
    Modal.form({
      title: `Notify ${u.name || u.email}`, submitLabel: 'Send',
      fields: [
        { name: 'title', label: 'Title', required: true },
        { name: 'body', label: 'Message', type: 'textarea', required: true },
      ],
      onSubmit: async d => {
        await api('/api/notifications/send', { method: 'POST',
          body: JSON.stringify({ to: u.email, title: d.title, body: d.body, kind: 'info' }) });
        Modal.close(); toast('Sent'); loadActivity();
      },
    });
  }

  // =========================================================
  //  ADMINS
  // =========================================================
  const adminState = { page: 1, limit: 10, q: '', sort: 'created|desc' };
  let _admins = [];

  async function loadAdmins() {
    try {
      const [sort, order] = adminState.sort.split('|');
      const params = new URLSearchParams({ page: adminState.page, limit: adminState.limit, q: adminState.q, sort, order });
      const r = await api('/api/admins?' + params.toString());
      _admins = r.items;
      const tb = $('#adminsBody');
      if (!r.items.length) tb.innerHTML = `<tr><td colspan="6" class="empty">No admins.</td></tr>`;
      else {
        tb.innerHTML = r.items.map(a => {
          const d = roleDefs[a.role];
          return `<tr>
            <td>${escapeHtml(a.name || '—')}</td>
            <td class="email-mask">${maskEmail(a.email)}${a.id === me.id ? '<span class="pill you">YOU</span>' : ''}</td>
            <td>${d ? roleChip(d.name, d.label, d.color) : escapeHtml(a.role)}</td>
            <td>${a.has2fa ? '<span class="pill ok">ON</span>' : '<span class="pill">OFF</span>'}</td>
            <td>${new Date(a.created).toLocaleDateString('en-GB')}</td>
            <td class="actions">
              ${can('admins.manage') ? `<button class="mini-btn" data-edit-admin="${a.id}">EDIT</button>` : ''}
              ${can('admins.manage') ? `<button class="mini-btn danger" data-del-admin="${a.id}" ${a.id === me.id ? 'disabled' : ''}>DEL</button>` : ''}
              ${!can('admins.manage') ? '<span class="readonly-tag">read only</span>' : ''}
            </td>
          </tr>`;
        }).join('');
        tb.querySelectorAll('[data-edit-admin]').forEach(b => b.onclick = () => editAdmin(b.dataset.editAdmin));
        tb.querySelectorAll('[data-del-admin]:not([disabled])').forEach(b => b.onclick = () => delAdmin(b.dataset.delAdmin));
      }
      renderPager($('#adminsPager'), r, p => { adminState.page = p; loadAdmins(); });
    } catch (e) { toast(e.message, 'error'); }
  }
  $('#adminSearch')?.addEventListener('input', debounce(e => { adminState.q = e.target.value.trim(); adminState.page = 1; loadAdmins(); }, 300));
  $('#adminSort')?.addEventListener('change', e => { adminState.sort = e.target.value; adminState.page = 1; loadAdmins(); });
  if (!can('admins.manage') && $('#addAdminBtn')) { $('#addAdminBtn').disabled = true; $('#addAdminBtn').classList.add('soft'); }

  function addAdminModal() {
    Modal.form({
      title: 'Add New Admin', submitLabel: 'Create',
      fields: [
        { name: 'name', label: 'Full Name', required: true },
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'password', label: 'Password', type: 'password', required: true },
        { name: 'role', label: 'Role', type: 'select',
          options: Object.values(roleDefs).map(r => ({ value: r.name, label: r.label })), value: 'viewer' },
      ],
      onSubmit: async d => {
        await api('/api/admins', { method: 'POST', body: JSON.stringify(d) });
        Modal.close(); toast('Admin created'); loadAdmins(); loadStats(); loadActivity();
      },
    });
  }
  function editAdmin(id) {
    const a = _admins.find(x => x.id === id); if (!a) return;
    Modal.form({
      title: 'Edit Admin', submitLabel: 'Save',
      fields: [
        { name: 'name', label: 'Full Name', value: a.name },
        { name: 'email', label: 'Email', type: 'email', value: a.email },
        { name: 'password', label: 'New Password (blank = keep)', type: 'password' },
        { name: 'role', label: 'Role', type: 'select',
          options: Object.values(roleDefs).map(r => ({ value: r.name, label: r.label })), value: a.role || 'viewer' },
      ],
      onSubmit: async d => {
        if (!d.password) delete d.password;
        await api('/api/admins/' + id, { method: 'PUT', body: JSON.stringify(d) });
        Modal.close(); toast('Updated'); loadAdmins(); loadActivity();
        if (id === me.id) {
          me = await api('/api/me');
          $('#who-name').textContent = me.name || 'Admin';
          const roleEl = $('#who-role');
          if (roleEl) roleEl.textContent = (me.role_label || me.role || 'ADMIN').toUpperCase();
          setAvatar(me);
        }
      },
    });
  }
  async function delAdmin(id) {
    const a = _admins.find(x => x.id === id); if (!a) return;
    const ok = await Modal.confirm('Delete Admin', `Delete "${a.email}"?`, { danger: true, okLabel: 'Delete' });
    if (!ok) return;
    try { await api('/api/admins/' + id, { method: 'DELETE' }); toast('Deleted'); loadAdmins(); loadStats(); loadActivity(); }
    catch (e) { toast(e.message, 'error'); }
  }

  // =========================================================
  //  TICKETS
  // =========================================================
  const ticketState = { page: 1, limit: 10, q: '', status: '', sort: 'updated|desc' };
  let _tickets = [], _activeTicket = null;

  async function loadTickets() {
    try {
      const [sort, order] = ticketState.sort.split('|');
      const params = new URLSearchParams({
        page: ticketState.page, limit: ticketState.limit,
        q: ticketState.q, status: ticketState.status, sort, order,
      });
      const r = await api('/api/tickets?' + params.toString());
      _tickets = r.items;
      const list = $('#ticketList');
      if (!r.items.length) list.innerHTML = `<div class="empty">No tickets.</div>`;
      else {
        list.innerHTML = r.items.map(t => `
          <div class="ticket-card ${_activeTicket && _activeTicket.id === t.id ? 'active' : ''}" data-tid="${t.id}">
            <div class="row1">
              <span class="subj">${escapeHtml(t.subject)}</span>
              <span class="pill ${t.priority}">${escapeHtml(t.priority)}</span>
            </div>
            <div class="row2">
              <span>${escapeHtml(t.user_name || 'User')}</span>
              <span class="spacer"></span>
              <span>${timeAgo(t.updated)}</span>
            </div>
          </div>`).join('');
        list.querySelectorAll('.ticket-card').forEach(c => c.onclick = () => openTicket(c.dataset.tid));
      }
      renderPager($('#ticketsPager'), r, p => { ticketState.page = p; loadTickets(); });
      // update support badge
      const open = (r.total || 0);
      const badge = $$('.nav-item').find(n => n.dataset.view === 'tickets');
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
  window.__openTicket = openTicket;  // ← add this line

  function renderTicketDetail() {
    const t = _activeTicket, el = $('#ticketDetail');
    if (!t) { el.innerHTML = `<div class="empty">Select a ticket.</div>`; return; }
    const canReply = can('tickets.reply');
    const canManage = can('tickets.manage');
    el.innerHTML = `
      <div class="panel" style="margin:0;position:relative">
        <div class="panel-head">
          <h3 style="font-size:13px">${escapeHtml(t.subject)}</h3>
          <button class="modal-x" id="closeTicketDetail" title="Close">×</button>
        </div>
        <div class="muted" style="font-size:11.5px;font-family:var(--font-mono);margin-bottom:10px">
          From <b style="color:var(--text)">${escapeHtml(t.user_name || 'User')}</b> · opened ${timeAgo(t.created)}
        </div>
        <div class="ticket-thread" id="ticketThread">
          ${t.messages.map(m => `
            <div class="ticket-msg ${m.from_role === 'admin' ? 'mine' : ''}">
              <div class="meta">${escapeHtml(m.from_name || 'User')} · ${timeAgo(m.at)}</div>
              <div class="body">${escapeHtml(m.body || '')}</div>
              ${(m.attachments||[]).length ? `<div class="attach-list">${m.attachments.map(attachChip).join('')}</div>` : ''}
            </div>`).join('')}
        </div>
        ${canReply ? `
          <div class="ticket-reply">
            <div class="ticket-composer">
              <label class="attach-btn" title="Attach file">
                📎<input type="file" id="ticketFileInput" multiple style="display:none" />
              </label>
              <textarea id="ticketReplyBody" placeholder="Type your reply... (Enter to send)"></textarea>
              <button class="btn btn-primary send-btn" id="sendReplyBtn">Send</button>
            </div>
            <div class="attach-preview" id="pendingAttach"></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
              ${canManage ? `
                <select class="filter-select" id="ticketStatusSel">
                  <option value="open" ${t.status==='open'?'selected':''}>Open</option>
                  <option value="in_progress" ${t.status==='in_progress'?'selected':''}>In Progress</option>
                  <option value="closed" ${t.status==='closed'?'selected':''}>Closed</option>
                </select>` : ''}
            </div>
          </div>` : `<p class="muted" style="margin-top:12px;text-align:center">🔒 No reply permission</p>`}
      </div>`;

    $('#closeTicketDetail').onclick = () => { _activeTicket = null; renderTicketDetail(); };

    const pending = [];

    if (canReply) {
      const fileInput = $('#ticketFileInput');
      fileInput.onchange = async e => {
        for (const f of e.target.files) {
          const fd = new FormData(); fd.append('file', f);
          try { const up = await apiUpload('/api/upload/ticket', fd);
            pending.push({ url: up.url, name: up.name, size: up.size });
            renderPendingAttach();
          } catch (err) { toast(err.message, 'error'); }
        }
        e.target.value = '';
      };
      function renderPendingAttach() {
        $('#pendingAttach').innerHTML = pending.map((a, i) =>
          `<div class="attach-chip">📎 ${escapeHtml(a.name)} <span class="x" data-idx="${i}">×</span></div>`
        ).join('');
        $$('#pendingAttach .x').forEach(x => x.onclick = () => {
          pending.splice(+x.dataset.idx, 1); renderPendingAttach();
        });
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
      if (canManage) {
        $('#ticketStatusSel').onchange = async e => {
          try {
            await api(`/api/tickets/${t.id}`, { method: 'PUT', body: JSON.stringify({ status: e.target.value }) });
            toast('Status updated');
            await openTicket(t.id); loadTickets();
          } catch (err) { toast(err.message, 'error'); }
        };
      }
    }
  }

  $('#ticketSearch')?.addEventListener('input', debounce(e => {
    ticketState.q = e.target.value.trim(); ticketState.page = 1; loadTickets();
  }, 300));
  $('#ticketSort')?.addEventListener('change', e => {
    ticketState.sort = e.target.value; ticketState.page = 1; loadTickets();
  });
  $('#ticketStatusChips')?.addEventListener('click', e => {
    const c = e.target.closest('.filter-chip'); if (!c) return;
    $$('#ticketStatusChips .filter-chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    ticketState.status = c.dataset.status; ticketState.page = 1;
    $('#ticketFilterTag').textContent = (ticketState.status || 'ALL').toUpperCase();
    loadTickets();
  });

  // =========================================================
  //  BROADCAST
  // =========================================================
  $('#notifTo')?.addEventListener('change', e => {
    $('#customEmailField').style.display = e.target.value === 'custom' ? 'block' : 'none';
  });
  $('#notifForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const to = $('#notifTo').value, email = $('#notifEmail').value.trim();
    const kind = $('#notifKind').value, title = $('#notifTitle').value.trim(), body = $('#notifBody').value.trim();
    if (to === 'custom' && !email) return toast('Enter email', 'warn');
    try {
      const r = await api('/api/notifications/send', { method: 'POST',
        body: JSON.stringify({ to: to === 'custom' ? email : '*', title, body, kind }) });
      toast(`Sent to ${r.sent}`); $('#notifForm').reset(); $('#customEmailField').style.display = 'none';
      loadActivity();
    } catch (err) { toast(err.message, 'error'); }
  });

  // =========================================================
  //  ACTIVITY
  // =========================================================
  const actState = { page: 1, limit: 5, q: '', sort: 'at|desc' };

  async function loadActivity() {
    try {
      const [sort, order] = actState.sort.split('|');
      const params = new URLSearchParams({ page: actState.page, limit: actState.limit, q: actState.q, sort, order });
      const r = await api('/api/activity?' + params.toString());
      const tb = $('#activityBody');
      if (!r.items.length) tb.innerHTML = `<tr><td colspan="3" class="empty">No activity.</td></tr>`;
      else tb.innerHTML = r.items.map(x => `<tr>
        <td>${new Date(x.at).toLocaleString('en-GB')}</td>
        <td>${escapeHtml(x.who)}</td>
        <td>${escapeHtml(x.action)}</td></tr>`).join('');
      renderPager($('#activityPager'), r, p => { actState.page = p; loadActivity(); });

      // dashboard card
      const feed = $('#activity-list');
      const dashState = { page: 1, limit: 5 };
      const dashFeed = await api(`/api/activity?page=${dashState.page}&limit=${dashState.limit}&sort=at&order=desc`);
      if (!dashFeed.items.length) feed.innerHTML = `<div class="empty">No activity yet.</div>`;
      else feed.innerHTML = dashFeed.items.map(x => `
        <div class="activity-item"><span class="dot ok"></span>
          <span class="a-uid">${escapeHtml(x.who)}</span>
          <span class="a-region">${escapeHtml(x.action)}</span>
          <span class="a-time">${timeAgo(x.at)}</span></div>`).join('');
      renderPager($('#dashActPager'), dashFeed, p => { /* handled by sort dropdown */ });
    } catch (e) { toast(e.message, 'error'); }
  }
  $('#activitySearch')?.addEventListener('input', debounce(e => { actState.q = e.target.value.trim(); actState.page = 1; loadActivity(); }, 300));
  $('#activitySort')?.addEventListener('change', e => { actState.sort = e.target.value; actState.page = 1; loadActivity(); });

  // =========================================================
  //  POSTMAN (with Params tab)
  // =========================================================
  let _lastResp = null, _collections = [], _savedReqs = [];

  function addHeaderRow(k = '', v = '') {
    const wrap = $('#pmHeaders');
    const row = document.createElement('div');
    row.className = 'kv-row';
    row.innerHTML = `<input placeholder="Header name" value="${escapeHtml(k)}" />
                     <input placeholder="Value" value="${escapeHtml(v)}" />
                     <button class="kv-del" title="Remove">×</button>`;
    row.querySelector('.kv-del').onclick = () => row.remove();
    wrap.appendChild(row);
  }

  // ---------- Params engine with 2-way URL sync ----------
  const PM = {
    template: '',           // URL template with {placeholders}
    params: [],             // [{ key, value, enabled }]
    syncing: false,
  };

  function pmExtractFromUrl(url) {
    const params = [];
    const seen = new Set();
    // 1. Extract {placeholder} tokens
    [...url.matchAll(/\{(\w+)\}/g)].forEach(m => {
      const k = m[1];
      if (!seen.has(k)) { params.push({ key: k, value: '', enabled: true }); seen.add(k); }
    });
    // 2. Extract ?query=value params
    try {
      const u = new URL(url);
      u.searchParams.forEach((v, k) => {
        if (!seen.has(k)) { params.push({ key: k, value: v, enabled: true }); seen.add(k); }
      });
    } catch {}
    return params;
  }

  function pmRender() {
    const wrap = $('#pmParams');
    if (!wrap) return;
    if (!PM.params.length) {
      wrap.innerHTML = `<div style="padding:14px 10px;text-align:center;color:var(--muted);font-family:var(--font-mono);font-size:11.5px">No params yet. Click "+ ADD PARAM" or paste a URL with query string.</div>`;
      return;
    }
    wrap.innerHTML = PM.params.map((p, i) => `
      <div class="param-row" data-idx="${i}">
        <input type="checkbox" ${p.enabled ? 'checked' : ''} />
        <input class="param-key"   placeholder="Key"   value="${escapeHtml(p.key || '')}" />
        <input class="param-value" placeholder="Value" value="${escapeHtml(p.value || '')}" />
        <button class="param-del" title="Remove">×</button>
      </div>`).join('');

    wrap.querySelectorAll('.param-row').forEach(row => {
      const idx = +row.dataset.idx;
      const [cb, kEl, vEl] = row.querySelectorAll('input');
      const del = row.querySelector('.param-del');

      cb.onchange = () => { PM.params[idx].enabled = cb.checked; };

      kEl.oninput = () => {
        PM.params[idx].key = kEl.value;
        pmSyncUrlFromParams();
      };

      vEl.oninput = () => {
        PM.params[idx].value = vEl.value;
        pmSyncUrlFromParams();
      };

      del.onclick = () => {
        PM.params.splice(idx, 1);
        pmRender();
        pmSyncUrlFromParams();
      };
    });
  }

  function pmSyncUrlFromParams() {
    if (PM.syncing) return;
    PM.syncing = true;
    let url = PM.template;
    PM.params.forEach(p => {
      if (!p.key) return;
      const re = new RegExp(`\\{${p.key}\\}`, 'g');
      if (re.test(url)) {
        url = url.replace(re, p.value || `{${p.key}}`);
      } else if (p.value) {
        // Append or update as query param
        try {
          const u = new URL(url);
          u.searchParams.set(p.key, p.value);
          url = u.toString();
        } catch {}
      }
    });
    $('#pmUrl').value = url;
    setTimeout(() => { PM.syncing = false; }, 50);
  }

  function pmSetUrlFromInput() {
    if (PM.syncing) return;
    const url = $('#pmUrl').value.trim();
    PM.template = url;
    PM.params = pmExtractFromUrl(url);
    pmRender();
  }

  function pmAddParam(k = '', v = '') {
    PM.params.push({ key: k, value: v, enabled: true });
    pmRender();
  }

  function pmCollect() {
    const out = {};
    PM.params.forEach(p => {
      if (p.enabled && p.key && p.key.trim()) out[p.key.trim()] = p.value || '';
    });
    return out;
  }

  function pmClear() {
    PM.template = '';
    PM.params = [];
    pmRender();
    $('#pmUrl').value = '';
  }

  // URL input → extract params on paste/type (debounced)
  const urlInput = $('#pmUrl');
  const urlExtractDebounced = debounce(() => {
    if (PM.syncing) return;
    const raw = urlInput.value.trim();
    if (!raw) { PM.template = ''; PM.params = []; pmRender(); return; }
    PM.template = raw;
    PM.params = pmExtractFromUrl(raw);
    pmRender();
  }, 450);
  urlInput?.addEventListener('input', urlExtractDebounced);
  urlInput?.addEventListener('paste', () => setTimeout(() => {
    PM.syncing = false;
    urlExtractDebounced();
  }, 120));

  // Manual buttons
  $('#pmAddParam').onclick = () => pmAddParam();
  $('#pmExtractParams').onclick = () => {
    const raw = $('#pmUrl').value.trim();
    if (!raw) return toast('URL required', 'warn');
    PM.template = raw;
    PM.params = pmExtractFromUrl(raw);
    pmRender();
    if (!PM.params.length) toast('No params in URL', 'warn');
    else toast(`Extracted ${PM.params.length} param(s)`);
  };

  function collectParams() { return pmCollect(); }
  function collectHeaders() {
    const h = {};
    $$('#pmHeaders .kv-row').forEach(r => {
      const [k, v] = r.querySelectorAll('input');
      if (k.value.trim()) h[k.value.trim()] = v.value;
    });
    return h;
  }

  $('#pmAddHeader').onclick = () => addHeaderRow();

  $$('.postman-tab').forEach(t => t.onclick = () => {
    $$('.postman-tab').forEach(x => x.classList.remove('active')); t.classList.add('active');
    $('#postmanHistory').style.display = t.dataset.ptab === 'history' ? 'block' : 'none';
    $('#postmanCollections').style.display = t.dataset.ptab === 'collections' ? 'block' : 'none';
  });
  $$('.postman-req-tab').forEach(t => t.onclick = () => {
    $$('.postman-req-tab').forEach(x => x.classList.remove('active')); t.classList.add('active');
    $('#pane-params').classList.toggle('active', t.dataset.ptab2 === 'params');
    $('#pane-headers').classList.toggle('active', t.dataset.ptab2 === 'headers');
    $('#pane-body').classList.toggle('active', t.dataset.ptab2 === 'body');
  });
  $$('.resp-tab').forEach(t => t.onclick = () => {
    $$('.resp-tab').forEach(x => x.classList.remove('active')); t.classList.add('active');
    renderResp(t.dataset.rtab);
  });
  function renderResp(which) {
    if (!_lastResp) return;
    const b = $('#pmRespBody');
    if (which === 'headers') b.textContent = JSON.stringify(_lastResp.headers || {}, null, 2);
    else b.textContent = prettyJson(_lastResp.body || '');
  }

  $('#pmClear').onclick = () => {
    $('#pmUrl').value = ''; $('#pmBody').value = '';
    $('#pmHeaders').innerHTML = '';
    pmClear();               // ← resets template + params + re-renders
    addHeaderRow('Content-Type', 'application/json');
    $('#pmResp').classList.remove('show'); _lastResp = null;
  };

  $('#pmSend').onclick = async () => {
    let url = $('#pmUrl').value.trim();
    if (!url) return toast('URL required', 'warn');
    // Ensure URL has no leftover {placeholders}
    url = url.replace(/\{(\w+)\}/g, (m, k) => {
      const p = PM.params.find(x => x.key === k);
      return p ? (p.value || m) : m;
    });
    const btn = $('#pmSend'); const orig = btn.textContent;
    btn.disabled = true; btn.textContent = 'Sending...';
    try {
      const r = await api('/api/tester/send', { method: 'POST', body: JSON.stringify({
        method: $('#pmMethod').value, url,
        params: collectParams(),
        headers: collectHeaders(),
        body: $('#pmBody').value,
      }) });
      _lastResp = r;
      const cls = r.status >= 500 ? 'status-5xx' : r.status >= 400 ? 'status-4xx' :
                  r.status >= 300 ? 'status-3xx' : 'status-2xx';
      $('#pmRespStats').innerHTML = `
        <div class="resp-stat"><span class="lbl">Status</span><span class="val ${cls}">${r.status} ${r.status_text || ''}</span></div>
        <div class="resp-stat"><span class="lbl">Time</span><span class="val">${r.time_ms} ms</span></div>
        <div class="resp-stat"><span class="lbl">Size</span><span class="val">${bytesFmt(r.size)}</span></div>`;
      $('#pmResp').classList.add('show');
      renderResp('body');
      loadPMHistory();
    } catch (e) { toast(e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = orig; }
  };

  $('#pmSave').onclick = () => {
    const url = $('#pmUrl').value.trim(); if (!url) return toast('URL required', 'warn');
    Modal.form({
      title: 'Save Request', submitLabel: 'Save',
      fields: [
        { name: 'name', label: 'Request Name', required: true },
        { name: 'collection_id', label: 'Collection', type: 'select', value: '',
          options: [{ value: '', label: '— None —' }, ...(_collections || []).map(c => ({ value: c.id, label: c.name }))] },
      ],
      onSubmit: async d => {
        await api('/api/tester/requests', { method: 'POST', body: JSON.stringify({
          name: d.name, collection_id: d.collection_id || null,
          method: $('#pmMethod').value, url,
          params: JSON.stringify(collectParams()),
          headers: JSON.stringify(collectHeaders()),
          body: $('#pmBody').value,
        }) });
        Modal.close(); toast('Saved'); loadPMCollections();
      },
    });
  };

  async function loadPMHistory() {
    try {
      const h = await api('/api/tester/history');
      const list = $('#postmanHistory');
      if (!h.length) { list.innerHTML = `<div class="empty" style="padding:20px 10px;font-size:11px">No history.</div>`; return; }
      list.innerHTML = h.slice(0, 40).map(x => `
        <div class="postman-list-item" data-hist="${x.id}">
          <span class="${methodClass(x.method)}">${x.method}</span>
          <span class="lbl">${escapeHtml(x.url)}</span>
          <span style="font-family:var(--font-mono);font-size:10px;color:${x.response_status >= 200 && x.response_status < 300 ? 'var(--primary)' : 'var(--red)'}">${x.response_status || 'ERR'}</span>
        </div>`).join('');
      list.querySelectorAll('[data-hist]').forEach(el => el.onclick = () => {
        const item = h.find(x => x.id === el.dataset.hist);
        if (item) {
          $('#pmMethod').value = item.method;
          $('#pmUrl').value = item.url;
          PM.template = item.url;
          PM.params = pmExtractFromUrl(item.url);
          // restore saved params if present
          try {
            const saved = JSON.parse(item.params || '{}');
            Object.entries(saved).forEach(([k, v]) => {
              const found = PM.params.find(p => p.key === k);
              if (found) found.value = v;
              else PM.params.push({ key: k, value: v, enabled: true });
            });
          } catch {}
          pmRender();
          $('#pmHeaders').innerHTML = '';
          try { Object.entries(JSON.parse(item.headers || '{}')).forEach(([k,v]) => addHeaderRow(k,v)); } catch {}
          $('#pmBody').value = item.body || '';
          toast('Loaded');
        }
      });
    } catch {}
  }

  async function loadPMCollections() {
    try {
      _collections = await api('/api/tester/collections');
      _savedReqs = await api('/api/tester/requests');
      const list = $('#postmanCollections');
      let html = `<div style="padding:6px 4px 10px"><button class="mini-btn" id="pmNewCollection" style="width:100%">+ NEW FOLDER</button></div>`;
      if (!_collections.length && !_savedReqs.length) {
        html += `<div class="empty" style="padding:20px 10px;font-size:11px">Nothing saved.</div>`;
      }
      _collections.forEach(c => {
        const inCol = _savedReqs.filter(r => r.collection_id === c.id);
        html += `<div style="margin:6px 0">
          <div style="display:flex;align-items:center;gap:6px;padding:6px 8px;font-family:var(--font-mono);font-size:11px;color:var(--primary);font-weight:700">
            📁 ${escapeHtml(c.name)}
            <span style="flex:1"></span>
            <span class="del" data-del-col="${c.id}" style="cursor:pointer;color:var(--red);opacity:.6">×</span>
          </div>
          ${inCol.map(savedItem).join('')}
        </div>`;
      });
      const loose = _savedReqs.filter(r => !r.collection_id);
      if (loose.length) html += `<div style="margin-top:8px;padding:6px 8px;font-family:var(--font-mono);font-size:10px;color:var(--muted);letter-spacing:1px">UNFILED</div>` + loose.map(savedItem).join('');
      list.innerHTML = html;
      list.querySelectorAll('[data-req]').forEach(el => el.onclick = e => {
        if (e.target.classList.contains('del')) return;
        const r = _savedReqs.find(x => x.id === el.dataset.req);
        if (r) {
          $('#pmMethod').value = r.method;
          $('#pmUrl').value = r.url;
          PM.template = r.url;
          PM.params = pmExtractFromUrl(r.url);
          try {
            const saved = JSON.parse(r.params || '{}');
            Object.entries(saved).forEach(([k, v]) => {
              const found = PM.params.find(p => p.key === k);
              if (found) found.value = v;
              else PM.params.push({ key: k, value: v, enabled: true });
            });
          } catch {}
          pmRender();
          $('#pmHeaders').innerHTML = '';
          try { Object.entries(JSON.parse(r.headers || '{}')).forEach(([k,v]) => addHeaderRow(k,v)); } catch {}
          $('#pmBody').value = r.body || '';
          toast('Loaded');
        }
      });
      list.querySelectorAll('[data-del-req]').forEach(el => el.onclick = async e => {
        e.stopPropagation();
        try { await api('/api/tester/requests/' + el.dataset.delReq, { method: 'DELETE' }); toast('Deleted'); loadPMCollections(); }
        catch (err) { toast(err.message, 'error'); }
      });
      list.querySelectorAll('[data-del-col]').forEach(el => el.onclick = async e => {
        e.stopPropagation();
        const ok = await Modal.confirm('Delete Folder', 'Delete folder and its requests?', { danger: true, okLabel: 'Delete' });
        if (!ok) return;
        try { await api('/api/tester/collections/' + el.dataset.delCol, { method: 'DELETE' }); toast('Deleted'); loadPMCollections(); }
        catch (err) { toast(err.message, 'error'); }
      });
      $('#pmNewCollection')?.addEventListener('click', () => Modal.form({
        title: 'New Collection', submitLabel: 'Create',
        fields: [{ name: 'name', label: 'Folder Name', required: true }],
        onSubmit: async d => { await api('/api/tester/collections', { method: 'POST', body: JSON.stringify({ name: d.name }) });
          Modal.close(); toast('Created'); loadPMCollections(); },
      }));
    } catch (e) { toast(e.message, 'error'); }
  }
  function savedItem(r) {
    return `<div class="postman-list-item" data-req="${r.id}" style="padding-left:16px">
      <span class="${methodClass(r.method)}">${r.method}</span>
      <span class="lbl">${escapeHtml(r.name)}</span>
      <span class="del" data-del-req="${r.id}" title="Delete">×</span>
    </div>`;
  }

  // =========================================================
  //  SHARED APIs  (URL hidden, params, secret keys)
  // =========================================================
  async function loadShared() {
    if (!can('api_share.manage')) return;
    try {
      const items = await api('/api/shared');
      const list = $('#sharedList');
      if (!items.length) { list.innerHTML = `<div class="empty">No shared APIs.</div>`; return; }
      list.innerHTML = items.map(s => {
        const allowed = s.allowed_users || ['*'];
        const scope = allowed.includes('*') ? 'All users' : `${allowed.length} user(s)`;
        const plans = (s.allowed_plans || []).length ? `Plans: ${s.allowed_plans.join(', ')}` : 'All plans';
        const limit = (s.request_limit_per_plan && Object.keys(s.request_limit_per_plan).length)
          ? Object.entries(s.request_limit_per_plan).map(([p,l]) => `${p}: ${l ?? '∞'}`).join(', ')
          : (s.credit_limit == null ? 'Plan default' : `${s.credit_limit} / ${s.credit_period}`);
        const params = (s.params || []).length;
        const secrets = Object.keys(s.secret_params || {}).length;
        return `<div class="shared-card">
          <div class="top">
            <span class="${methodClass(s.method)}">${s.method}</span>
            <span class="name">${escapeHtml(s.name)}</span>
            <span class="pill ${s.enabled ? 'ok' : 'bad'}">${s.enabled ? 'ENABLED' : 'DISABLED'}</span>
            ${s.show_url ? '<span class="pill">URL VISIBLE</span>' : '<span class="pill">URL HIDDEN</span>'}
          </div>
          ${s.description ? `<div class="desc">${escapeHtml(s.description)}</div>` : ''}
          <div class="url">${escapeHtml(s.url)}</div>
          <div class="meta">
            <span>👥 ${scope}</span>
            <span>📊 ${plans}</span>
            <span>⚡ ${limit}</span>
            <span>🔧 ${params} param(s)</span>
            <span>🔐 ${secrets} secret(s)</span>
          </div>
          <div class="actions">
            <button class="mini-btn" data-usage="${s.id}">USAGE</button>
            <button class="mini-btn" data-edit-shared="${s.id}">EDIT</button>
            <button class="mini-btn" data-toggle-shared="${s.id}">${s.enabled ? 'DISABLE' : 'ENABLE'}</button>
            <button class="mini-btn danger" data-del-shared="${s.id}">DELETE</button>
          </div>
        </div>`;
      }).join('');
      list.querySelectorAll('[data-edit-shared]').forEach(b => b.onclick = () => openSharedModal(items.find(x => x.id === b.dataset.editShared)));
      list.querySelectorAll('[data-del-shared]').forEach(b => b.onclick = () => delShared(b.dataset.delShared, items));
      list.querySelectorAll('[data-toggle-shared]').forEach(b => b.onclick = () => toggleShared(b.dataset.toggleShared, items));
      list.querySelectorAll('[data-usage]').forEach(b => b.onclick = () => showUsage(b.dataset.usage, items));
    } catch (e) { toast(e.message, 'error'); }
  }

  function openSharedModal(item) {
    const isEdit = !!item;
    const s = item || {
      name: '', description: '', method: 'GET', url: '',
      params: [], secret_params: {}, headers: {}, body: '',
      enabled: true, show_url: false,
      allowed_users: ['*'], allowed_plans: [],
      credit_limit: null, credit_period: 'day',
      request_limit_per_plan: {}, expires_at: null,
    };

    // Build params UI
    function paramsHtml() {
      return (s.params || []).map((p, i) => `
        <div class="kv-row" data-param-idx="${i}">
          <input placeholder="Name (e.g. city)" value="${escapeHtml(p.name||'')}" class="p-name" />
          <input placeholder="Label (e.g. City)" value="${escapeHtml(p.label||'')}" class="p-label" />
        </div>
        <div class="kv-row" data-param-idx="${i}" style="grid-template-columns:1fr 1fr 60px 30px">
          <input placeholder="Type (text/number)" value="${escapeHtml(p.type||'text')}" class="p-type" />
          <input placeholder="Default value" value="${escapeHtml(p.default||'')}" class="p-default" />
          <label style="font-family:var(--font-mono);font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px"><input type="checkbox" class="p-required" ${p.required?'checked':''}/> Req</label>
          <button class="kv-del param-del-row" data-del-param="${i}">×</button>
        </div>`).join('');
    }
    // overlay.querySelector('#shAddSecret').onclick = () => {
    //   const wrap = overlay.querySelector('#shSecretsWrap');
    //   const div = document.createElement('div');
    //   div.className = 'kv-row';
    //   div.innerHTML = `<input placeholder="Key name" class="s-key" /><input placeholder="Value" type="password" class="s-val" /><button class="kv-del">×</button>`;
    //   wrap.appendChild(div);
    //   div.querySelector('.kv-del').onclick = () => div.remove();
    // };
    function limitsHtml() {
      const plans = ['free', 'pro', 'premium'];
      return plans.map(p => `
        <div class="kv-row" style="grid-template-columns:1fr 1fr">
          <input value="${p}" disabled />
          <input type="number" min="0" placeholder="∞" value="${s.request_limit_per_plan?.[p] ?? ''}" data-limit-plan="${p}" />
        </div>`).join('');
    }

    const body = `
      <div class="form">
        <div class="form-row">
          <div class="field"><label>Name</label><input id="shName" value="${escapeHtml(s.name)}" /></div>
          <div class="field"><label>Method</label>
            <select id="shMethod">${['GET','POST','PUT','PATCH','DELETE'].map(m => `<option ${m===s.method?'selected':''}>${m}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field"><label>Description</label><input id="shDesc" value="${escapeHtml(s.description||'')}" /></div>
        <div class="field">
          <label>URL <span style="color:var(--muted);font-size:10px">— use {placeholders} for params</span></label>
          <div style="display:flex;gap:8px">
            <input id="shUrl" value="${escapeHtml(s.url)}" placeholder="https://api.example.com/v1?city={city}&key={api_key}" style="flex:1" />
            <button type="button" class="url-verify-btn" id="shVerify">Verify</button>
          </div>
          <div id="shVerifyResult" style="margin-top:8px"></div>
        </div>

        <div class="field">
          <label>User-facing params — these are the inputs users will fill</label>
          <div id="shParamsWrap">${paramsHtml()}</div>
          <button type="button" class="mini-btn" id="shAddParam" style="margin-top:8px">+ ADD PARAM</button>
          <button type="button" class="mini-btn" id="shExtractParams" style="margin-top:8px;margin-left:6px">EXTRACT FROM URL</button>
        </div>

        <div class="field"><label>Headers (JSON)</label><textarea id="shHeaders" rows="2">${escapeHtml(JSON.stringify(s.headers || {}, null, 2))}</textarea></div>
        <div class="field"><label>Body (optional)</label><textarea id="shBody" rows="2">${escapeHtml(s.body || '')}</textarea></div>
        <div class="field"><label>Allowed Users (comma-separated emails, or * for all)</label>
          <input id="shAllowed" value="${escapeHtml((s.allowed_users||['*']).join(','))}" /></div>
        <div class="field"><label>Allowed Plans (leave blank = all plans)</label>
          <input id="shAllowedPlans" value="${escapeHtml((s.allowed_plans||[]).join(','))}" placeholder="free,pro" /></div>

        <div class="field">
          <label>Per-plan request limits (blank = use plan default)</label>
          <div id="shLimitsWrap">${limitsHtml()}</div>
          <div class="field" style="margin-top:8px"><label>Period</label>
            <select id="shPeriod">
              <option value="day" ${s.credit_period==='day'?'selected':''}>Per Day</option>
              <option value="total" ${s.credit_period==='total'?'selected':''}>Total</option>
            </select>
          </div>
        </div>

        <div class="field"><label>Fallback credit limit (if no plan override)</label>
          <input id="shLimit" type="number" min="0" value="${s.credit_limit ?? ''}" placeholder="blank = plan default" /></div>

        <div class="field"><label>Expires At (optional)</label>
          <input id="shExpires" type="datetime-local" value="${s.expires_at ? s.expires_at.slice(0,16) : ''}" />
          <div style="font-size:10.5px;color:var(--muted);margin-top:4px;font-family:var(--font-mono)">Leave blank for no expiry</div>
        </div>

        <div class="form-row">
          <label class="checkbox-row ${s.enabled?'checked':''}">
            <input type="checkbox" id="shEnabled" ${s.enabled?'checked':''} />
            <span style="font-size:12.5px">Enabled</span>
          </label>
          <label class="checkbox-row ${s.show_url?'checked':''}">
            <input type="checkbox" id="shShowUrl" ${s.show_url?'checked':''} />
            <span style="font-size:12.5px">Show URL to users</span>
          </label>
        </div>
      </div>`;

    const overlay = Modal.open({
      title: isEdit ? 'Edit Shared API' : 'Share New API',
      body, width: 700,
      actions: [
        { label: 'Cancel', cls: 'btn-ghost', onClick: () => Modal.close() },
        { label: isEdit ? 'Save' : 'Create', cls: 'btn-primary', onClick: async () => {
            const ov = overlay;
            const collect = () => {
              const params = [];
              const wrap = ov.querySelector('#shParamsWrap');
              const rows = wrap.querySelectorAll('[data-param-idx]');
              const grouped = {};
              rows.forEach(r => {
                const idx = r.dataset.paramIdx;
                grouped[idx] = grouped[idx] || {};
                const nm = r.querySelector('.p-name'), lb = r.querySelector('.p-label'),
                      tp = r.querySelector('.p-type'), df = r.querySelector('.p-default'),
                      rq = r.querySelector('.p-required');
                if (nm) grouped[idx].name = nm.value;
                if (lb) grouped[idx].label = lb.value;
                if (tp) grouped[idx].type = tp.value;
                if (df) grouped[idx].default = df.value;
                if (rq) grouped[idx].required = rq.checked;
              });
              Object.values(grouped).forEach(p => { if (p.name) params.push(p); });

              const secrets = {};

              const limits = {};
              ov.querySelectorAll('[data-limit-plan]').forEach(i => {
                if (i.value !== '') limits[i.dataset.limitPlan] = parseInt(i.value);
              });

              return { params, secrets, limits };
            };

            const { params, secrets, limits } = collect();
            const payload = {
              name: ov.querySelector('#shName').value.trim(),
              description: ov.querySelector('#shDesc').value.trim(),
              method: ov.querySelector('#shMethod').value,
              url: ov.querySelector('#shUrl').value.trim(),
              params,
              secret_params: secrets,
              headers: (() => { try { return JSON.parse(ov.querySelector('#shHeaders').value || '{}'); } catch { return {}; } })(),
              body: ov.querySelector('#shBody').value,
              enabled: ov.querySelector('#shEnabled').checked,
              show_url: ov.querySelector('#shShowUrl').checked,
              allowed_users: ov.querySelector('#shAllowed').value.split(',').map(x => x.trim()).filter(Boolean) || ['*'],
              allowed_plans: ov.querySelector('#shAllowedPlans').value.split(',').map(x => x.trim()).filter(Boolean),
              credit_limit: ov.querySelector('#shLimit').value ? parseInt(ov.querySelector('#shLimit').value) : null,
              credit_period: ov.querySelector('#shPeriod').value,
              request_limit_per_plan: limits,
              expires_at: ov.querySelector('#shExpires').value ? ov.querySelector('#shExpires').value + ':00Z' : null,
            };
            if (!payload.name || !payload.url) return toast('Name & URL required', 'warn');
            try {
              if (isEdit) await api('/api/shared/' + item.id, { method: 'PUT', body: JSON.stringify(payload) });
              else await api('/api/shared', { method: 'POST', body: JSON.stringify(payload) });
              Modal.close(); toast(isEdit ? 'Updated' : 'Shared'); loadShared();
            } catch (e) { toast(e.message, 'error'); }
          } },
      ],
    });

    // wire dynamic buttons
    const addParamRow = () => {
      const wrap = overlay.querySelector('#shParamsWrap');
      const idx = wrap.querySelectorAll('[data-param-idx]').length / 2 | 0;
      const div = document.createElement('div');
      div.innerHTML = `<div class="kv-row" data-param-idx="${idx}">
          <input placeholder="Name" class="p-name" />
          <input placeholder="Label" class="p-label" />
        </div>
        <div class="kv-row" data-param-idx="${idx}" style="grid-template-columns:1fr 1fr 60px 30px">
          <input placeholder="Type" value="text" class="p-type" />
          <input placeholder="Default" class="p-default" />
          <label style="font-family:var(--font-mono);font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px"><input type="checkbox" class="p-required"/> Req</label>
          <button class="kv-del">×</button>
        </div>`;
      while (div.firstChild) wrap.appendChild(div.firstChild);
      wrap.querySelectorAll('.kv-del').forEach(b => b.onclick = () => b.closest('.kv-row').remove());
    };
    overlay.querySelector('#shAddParam').onclick = addParamRow;
    // overlay.querySelector('#shAddSecret').onclick = () => {
    //   const wrap = overlay.querySelector('#shSecretsWrap');
    //   const div = document.createElement('div');
    //   div.className = 'kv-row';
    //   div.innerHTML = `<input placeholder="Key name" class="s-key" /><input placeholder="Value" type="password" class="s-val" /><button class="kv-del">×</button>`;
    //   wrap.appendChild(div);
    //   div.querySelector('.kv-del').onclick = () => div.remove();
    // };
    overlay.querySelectorAll('.kv-del').forEach(b => b.onclick = () => b.closest('.kv-row').remove());
    overlay.querySelector('#shExtractParams').onclick = () => {
      const url = overlay.querySelector('#shUrl').value;
      const matches = [...url.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
      if (!matches.length) return toast('No {placeholders} in URL', 'warn');
      matches.forEach(k => {
        const wrap = overlay.querySelector('#shParamsWrap');
        const idx = Math.random().toString(36).slice(2);
        wrap.insertAdjacentHTML('beforeend', `
          <div class="kv-row" data-param-idx="${idx}">
            <input class="p-name" value="${escapeHtml(k)}" />
            <input class="p-label" value="${escapeHtml(k.charAt(0).toUpperCase() + k.slice(1))}" />
          </div>
          <div class="kv-row" data-param-idx="${idx}" style="grid-template-columns:1fr 1fr 60px 30px">
            <input class="p-type" value="text" />
            <input class="p-default" />
            <label style="font-family:var(--font-mono);font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px"><input type="checkbox" class="p-required"/> Req</label>
            <button class="kv-del">×</button>
          </div>`);
      });
      overlay.querySelectorAll('.kv-del').forEach(b => b.onclick = () => b.closest('.kv-row').remove());
      toast(`Extracted ${matches.length} param(s)`);
    };

    // Auto-extract on URL input
    const shUrlEl = overlay.querySelector('#shUrl');
    shUrlEl?.addEventListener('blur', () => {
      const url = shUrlEl.value;
      const matches = [...url.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
      if (!matches.length) return;
      const existing = new Set();
      overlay.querySelectorAll('#shParamsWrap .p-name').forEach(i => existing.add(i.value.trim()));
      let added = 0;
      matches.forEach(k => {
        if (existing.has(k)) return;
        const wrap = overlay.querySelector('#shParamsWrap');
        const idx = Math.random().toString(36).slice(2);
        wrap.insertAdjacentHTML('beforeend', `
          <div class="kv-row" data-param-idx="${idx}">
            <input class="p-name" value="${escapeHtml(k)}" />
            <input class="p-label" value="${escapeHtml(k.charAt(0).toUpperCase() + k.slice(1))}" />
          </div>
          <div class="kv-row" data-param-idx="${idx}" style="grid-template-columns:1fr 1fr 60px 30px">
            <input class="p-type" value="text" />
            <input class="p-default" />
            <label style="font-family:var(--font-mono);font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px"><input type="checkbox" class="p-required"/> Req</label>
            <button class="kv-del">×</button>
          </div>`);
        added++;
      });
      overlay.querySelectorAll('.kv-del').forEach(b => b.onclick = () => b.closest('.kv-row').remove());
      if (added) toast(`Auto-extracted ${added} param(s)`);
    });
    overlay.querySelector('#shVerify').onclick = async () => {
      const url = overlay.querySelector('#shUrl').value.trim();
      if (!url) return toast('URL required', 'warn');
      try {
        // try to reach URL (may fail without key, but we still detect DNS/connectivity)
        const r = await api('/api/tester/send', { method: 'POST', body: JSON.stringify({ method: 'GET', url: url.replace(/\{(\w+)\}/g, '') }) });
        overlay.querySelector('#shVerifyResult').innerHTML =
          `<span class="url-verified">✓ Reachable · HTTP ${r.status}</span>`;
      } catch (e) {
        overlay.querySelector('#shVerifyResult').innerHTML =
          `<span class="url-verified" style="background:rgba(255,77,77,.1);color:var(--red);border-color:rgba(255,77,77,.3)">✗ ${escapeHtml(e.message)}</span>`;
      }
    };
  }

  async function delShared(id, items) {
    const s = items.find(x => x.id === id); if (!s) return;
    const ok = await Modal.confirm('Delete Shared API', `Delete "${s.name}"?`, { danger: true, okLabel: 'Delete' });
    if (!ok) return;
    try { await api('/api/shared/' + id, { method: 'DELETE' }); toast('Deleted'); loadShared(); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function toggleShared(id, items) {
    const s = items.find(x => x.id === id); if (!s) return;
    try { await api('/api/shared/' + id, { method: 'PUT', body: JSON.stringify({ enabled: !s.enabled }) }); toast('Toggled'); loadShared(); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function showUsage(id, items) {
    const s = items.find(x => x.id === id); if (!s) return;
    try {
      const u = await api('/api/shared/' + id + '/usage');
      const rows = Object.entries(u).map(([email, data]) => {
        const [n, d] = email.split('@');
        const masked = n ? (n.slice(0,2) + '***@' + d) : email;
        return `<tr>
          <td class="email-mask">${escapeHtml(masked)}</td>
          <td class="num">${data.total_used || 0}</td>
          <td class="num">${data.day_date ? `${data.day_used || 0} (${data.day_date})` : '—'}</td>
        </tr>`;
      }).join('');
      Modal.open({
        title: `Usage — ${s.name}`,
        body: rows ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>User</th><th class="num">Total Used</th><th class="num">Today</th></tr></thead>
          <tbody>${rows}</tbody></table></div>`
          : `<p class="muted" style="text-align:center;padding:20px">No usage yet.</p>`,
        actions: [{ label: 'Close', cls: 'btn-ghost', onClick: () => Modal.close() }],
        width: 620,
      });
    } catch (e) { toast(e.message, 'error'); }
  }

  $('#addSharedBtn')?.addEventListener('click', () => { if (can('api_share.manage')) openSharedModal(null); });

  // =========================================================
  //  SUBSCRIPTIONS / PLANS / PAYMENTS
  // =========================================================
  let _plans = [], _subs = [];

  async function loadPlans() {
    if (!can('subscriptions.manage')) return;
    try {
      _plans = await api('/api/plans');
      const g = $('#plansGrid');
      g.innerHTML = _plans.map(p => `
        <div class="plan-card" style="--pc:${p.color}">
          <div class="plan-icon">${escapeHtml(p.icon || '💎')}</div>
          <div class="plan-name">${escapeHtml(p.name)}</div>
          <div class="plan-price">
            ${p.price > 0 ? p.currency + ' ' + p.price : 'Free'}
            ${p.price > 0 ? `<span class="per">/ ${p.duration_days}d</span>` : ''}
          </div>
          ${p.built_in ? `<span class="plan-current-tag" style="--pc:${p.color}">BUILT-IN</span>` : ''}
          <ul class="plan-features">${(p.features||[]).map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--muted);margin-top:8px">
            ⚡ Limit/URL: ${p.request_limit_per_url ?? '∞'} per ${p.request_period || '—'}
          </div>
          <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
            <button class="mini-btn" data-edit-plan="${p.id}">EDIT</button>
            ${!p.built_in ? `<button class="mini-btn danger" data-del-plan="${p.id}">DELETE</button>` : ''}
          </div>
        </div>`).join('');
      g.querySelectorAll('[data-edit-plan]').forEach(b => b.onclick = () => editPlan(b.dataset.editPlan));
      g.querySelectorAll('[data-del-plan]').forEach(b => b.onclick = () => delPlan(b.dataset.delPlan));
      const pf = $('#subPlan');
      if (pf) pf.innerHTML = `<option value="">All plans</option>` + _plans.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    } catch (e) { toast(e.message, 'error'); }
  }

  function editPlan(pid) {
    const p = _plans.find(x => x.id === pid); if (!p) return;
    const isEdit = true;
    const body = `
      <div class="form">
        <div class="form-row">
          <div class="field"><label>Name</label><input id="plName" value="${escapeHtml(p.name)}" /></div>
          <div class="field"><label>ID (slug)</label><input id="plId" value="${escapeHtml(p.id)}" disabled /></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Price</label><input id="plPrice" type="number" step="0.01" min="0" value="${p.price}" /></div>
          <div class="field"><label>Duration (days)</label><input id="plDays" type="number" min="1" value="${p.duration_days}" /></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Currency</label><input id="plCurrency" value="${escapeHtml(p.currency||'BDT')}" /></div>
          <div class="field"><label>Color</label><input id="plColor" value="${escapeHtml(p.color)}" /></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Icon (emoji)</label><input id="plIcon" value="${escapeHtml(p.icon)}" maxlength="4" /></div>
          <div class="field"><label>Request limit per URL</label><input id="plLimit" type="number" min="0" value="${p.request_limit_per_url ?? ''}" placeholder="blank = unlimited" /></div>
        </div>
        <div class="field"><label>Request period</label>
          <select id="plPeriod">
            <option value="day" ${p.request_period==='day'?'selected':''}>Per Day</option>
            <option value="total" ${p.request_period==='total'?'selected':''}>Total</option>
            <option value="" ${!p.request_period?'selected':''}>None (unlimited)</option>
          </select>
        </div>
        <div class="field">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1.2px;font-weight:600">Features (one per line)</label>
            <span style="flex:1"></span>
            <button type="button" class="mini-btn" id="plAutoFeatures">AUTO-FILL</button>
          </div>
          <textarea id="plFeatures" rows="4">${escapeHtml((p.features||[]).join('\n'))}</textarea>
        </div>
        <div class="form-row">
          <label class="checkbox-row ${p.auto_renew?'checked':''}">
            <input type="checkbox" id="plAutoRenew" ${p.auto_renew?'checked':''} />
            <div><div style="font-size:12.5px;font-weight:600">Auto-renew</div>
            <div style="font-size:11px;color:var(--muted)">Renew automatically at expiry</div></div>
          </label>
          <label class="checkbox-row ${p.show_features_input?'checked':''}">
            <input type="checkbox" id="plShowFeat" ${p.show_features_input?'checked':''} />
            <div><div style="font-size:12.5px;font-weight:600">Show features input</div>
            <div style="font-size:11px;color:var(--muted)">Show features box to users</div></div>
          </label>
        </div>
      </div>`;

    const overlay = Modal.open({
      title: isEdit ? 'Edit Plan' : 'Create Plan',
      body, width: 620,
      actions: [
        { label: 'Cancel', cls: 'btn-ghost', onClick: () => Modal.close() },
        { label: 'Save', cls: 'btn-primary', onClick: async () => {
            const ov = overlay;
            const payload = {
              name: ov.querySelector('#plName').value.trim(),
              price: parseFloat(ov.querySelector('#plPrice').value) || 0,
              duration_days: parseInt(ov.querySelector('#plDays').value) || 30,
              currency: ov.querySelector('#plCurrency').value.trim() || 'BDT',
              color: ov.querySelector('#plColor').value.trim() || '#00ff9d',
              icon: ov.querySelector('#plIcon').value.trim() || '💎',
              request_limit_per_url: ov.querySelector('#plLimit').value === '' ? null : parseInt(ov.querySelector('#plLimit').value),
              request_period: ov.querySelector('#plPeriod').value || null,
              features: ov.querySelector('#plFeatures').value.split('\n').map(x => x.trim()).filter(Boolean),
              auto_renew: ov.querySelector('#plAutoRenew').checked,
              show_features_input: ov.querySelector('#plShowFeat').checked,
            };
            if (!payload.name) return toast('Name required', 'warn');
            try { await api('/api/plans/' + p.id, { method: 'PUT', body: JSON.stringify(payload) });
              Modal.close(); toast('Saved'); loadPlans(); }
            catch (e) { toast(e.message, 'error'); }
          } },
      ],
    });
    // toggle checkbox-rows
    overlay.querySelectorAll('.checkbox-row input').forEach(cb => cb.onchange = () =>
      cb.closest('.checkbox-row').classList.toggle('checked', cb.checked));
    // auto-fill features
    overlay.querySelector('#plAutoFeatures').onclick = () => {
      const lim = overlay.querySelector('#plLimit').value;
      const per = overlay.querySelector('#plPeriod').value;
      const cur = overlay.querySelector('#plCurrency').value;
      const auto = [
        lim ? `${lim} requests per ${per || 'total'}` : 'Unlimited requests',
        'Priority support',
        'API tools access',
      ];
      overlay.querySelector('#plFeatures').value = auto.join('\n');
      toast('Auto-filled features');
    };
  }

  function addPlanModal() {
    const body = `
      <div class="form">
        <div class="form-row">
          <div class="field"><label>Name</label><input id="nplName" placeholder="Starter" /></div>
          <div class="field"><label>ID (slug)</label><input id="nplId" placeholder="starter" /></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Price</label><input id="nplPrice" type="number" step="0.01" min="0" value="0" /></div>
          <div class="field"><label>Duration (days)</label><input id="nplDays" type="number" min="1" value="30" /></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Currency</label><input id="nplCurrency" value="BDT" /></div>
          <div class="field"><label>Color</label><input id="nplColor" value="#00ff9d" /></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Icon</label><input id="nplIcon" value="💎" maxlength="4" /></div>
          <div class="field"><label>Request limit per URL</label><input id="nplLimit" type="number" min="0" placeholder="blank = unlimited" /></div>
        </div>
        <div class="field"><label>Request period</label>
          <select id="nplPeriod"><option value="day">Per Day</option><option value="total">Total</option><option value="">None</option></select>
        </div>
        <div class="field"><label>Features (one per line)</label><textarea id="nplFeatures" rows="4"></textarea></div>
      </div>`;
    Modal.open({
      title: 'Create Plan', body, width: 620,
      actions: [
        { label: 'Cancel', cls: 'btn-ghost', onClick: () => Modal.close() },
        { label: 'Create', cls: 'btn-primary', onClick: async () => {
            const ov = $('.modal-overlay');
            const payload = {
              name: ov.querySelector('#nplName').value.trim(),
              id: ov.querySelector('#nplId').value.trim().toLowerCase().replace(/\s+/g,'_'),
              price: parseFloat(ov.querySelector('#nplPrice').value) || 0,
              duration_days: parseInt(ov.querySelector('#nplDays').value) || 30,
              currency: ov.querySelector('#nplCurrency').value.trim() || 'BDT',
              color: ov.querySelector('#nplColor').value.trim() || '#00ff9d',
              icon: ov.querySelector('#nplIcon').value.trim() || '💎',
              request_limit_per_url: ov.querySelector('#nplLimit').value === '' ? null : parseInt(ov.querySelector('#nplLimit').value),
              request_period: ov.querySelector('#nplPeriod').value || null,
              features: ov.querySelector('#nplFeatures').value.split('\n').map(x => x.trim()).filter(Boolean),
            };
            if (!payload.name) return toast('Name required', 'warn');
            try { await api('/api/plans', { method: 'POST', body: JSON.stringify(payload) });
              Modal.close(); toast('Created'); loadPlans(); }
            catch (e) { toast(e.message, 'error'); }
          } },
      ],
    });
  }

  async function delPlan(id) {
    const p = _plans.find(x => x.id === id); if (!p) return;
    const ok = await Modal.confirm('Delete Plan', `Delete "${p.name}"?`, { danger: true, okLabel: 'Delete' });
    if (!ok) return;
    try { await api('/api/plans/' + id, { method: 'DELETE' }); toast('Deleted'); loadPlans(); }
    catch (e) { toast(e.message, 'error'); }
  }

  $('#addPlanBtn')?.addEventListener('click', addPlanModal);

  const subState = { page: 1, limit: 10, q: '', status: '', plan_id: '' };
  async function loadSubs() {
    if (!can('subscriptions.manage')) return;
    try {
      const params = new URLSearchParams(subState);
      const r = await api('/api/subscriptions?' + params);
      _subs = r.items;
      const tb = $('#subsBody');
      if (!r.items.length) tb.innerHTML = `<tr><td colspan="6" class="empty">No subscriptions.</td></tr>`;
      else tb.innerHTML = r.items.map(s => {
        const planNames = (s.plans || [s.plan_id]).map(pid => {
          const p = _plans.find(x => x.id === pid) || { id: pid, name: pid, color: '#7d8590' };
          return roleChip(p.id, p.name, p.color);
        }).join(' ');
        return `<tr>
          <td>${escapeHtml(s.user_name||'—')}<div class="email-mask" style="font-size:11px">${escapeHtml(s.email_masked||'')}</div></td>
          <td>${planNames}</td>
          <td><span class="pill ${s.status==='expired'?'bad':'ok'}">${escapeHtml(s.status)}</span></td>
          <td>${new Date(s.started_at).toLocaleDateString('en-GB')}</td>
          <td>${s.expires_at ? new Date(s.expires_at).toLocaleDateString('en-GB') : '—'}</td>
          <td class="actions">
            <button class="mini-btn" data-edit-sub="${s.email_masked}">EDIT</button>
            <button class="mini-btn danger" data-revoke-sub="${s.email_masked}">REVOKE</button>
          </td>
        </tr>`;
      }).join('');
      // since we masked emails, use a second lookup map for actions
      tb.querySelectorAll('[data-edit-sub]').forEach((b, i) => b.onclick = () => editSub(_subs[i]));
      tb.querySelectorAll('[data-revoke-sub]').forEach((b, i) => b.onclick = () => revokeSub(_subs[i]));
      renderPager($('#subsPager'), r, p => { subState.page = p; loadSubs(); });
    } catch (e) { toast(e.message, 'error'); }
  }

  function assignSubModal() {
    Modal.form({
      title: 'Assign Plan', submitLabel: 'Assign',
      fields: [
        { name: 'email', label: 'User Email', type: 'email', required: true },
        { name: 'plan_id', label: 'Plan', type: 'select', options: _plans.map(p => ({ value: p.id, label: p.name })), value: 'free' },
        { name: 'duration_days', label: 'Duration (days, blank = default)', type: 'number' },
        { name: 'auto_renew', label: 'Auto-renew', type: 'select',
          options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }], value: 'no' },
      ],
      onSubmit: async d => {
        await api('/api/subscriptions', { method: 'POST', body: JSON.stringify({
          email: d.email, plan_id: d.plan_id,
          duration_days: d.duration_days ? parseInt(d.duration_days) : null,
          auto_renew: d.auto_renew === 'yes',
        }) });
        Modal.close(); toast('Assigned'); loadSubs();
      },
    });
  }

  function editSub(sub) {
    const email = sub.email || '';
    Modal.form({
      title: `Edit Subscription`, submitLabel: 'Save',
      fields: [
        { name: 'plan_id', label: 'Primary Plan', type: 'select', options: _plans.map(p => ({ value: p.id, label: p.name })), value: sub.plan_id },
        { name: 'status', label: 'Status', type: 'select', options: [
          { value: 'active', label: 'Active' }, { value: 'expired', label: 'Expired' }], value: sub.status },
        { name: 'expires_at', label: 'Expires At (ISO)', value: sub.expires_at || '' },
      ],
      onSubmit: async d => {
        // since email may be masked, ask user to confirm via direct email
        const em = await Modal.form({
          title: 'Confirm Email', submitLabel: 'Confirm',
          fields: [{ name: 'email', label: 'Enter full email to confirm', type: 'email', required: true }],
          onSubmit: async x => { Modal.close(); return x.email; },
        });
      },
    });
  }

  async function revokeSub(sub) {
    const ok = await Modal.confirm('Revoke Subscription', `Revert user to Free plan?`, { danger: true, okLabel: 'Revert' });
    if (!ok) return;
    // fetch real email from server
    try {
      const r = await api('/api/subscriptions?limit=500');
      const target = r.items.find(x => x.email_masked === sub.email_masked);
      if (!target) return toast('Not found', 'error');
      await api('/api/subscriptions/' + encodeURIComponent(target.email_masked), { method: 'DELETE' });
      toast('Reverted'); loadSubs();
    } catch (e) { toast(e.message, 'error'); }
  }

  $('#assignSubBtn')?.addEventListener('click', assignSubModal);
  $('#subSearch')?.addEventListener('input', debounce(e => { subState.q = e.target.value.trim(); subState.page = 1; loadSubs(); }, 300));
  $('#subStatus')?.addEventListener('change', e => { subState.status = e.target.value; subState.page = 1; loadSubs(); });
  $('#subPlan')?.addEventListener('change', e => { subState.plan_id = e.target.value; subState.page = 1; loadSubs(); });

  $$('[data-subtab]').forEach(t => t.onclick = () => {
    $$('[data-subtab]').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $('#subtab-plans').style.display = t.dataset.subtab === 'plans' ? '' : 'none';
    $('#subtab-assigned').style.display = t.dataset.subtab === 'assigned' ? '' : 'none';
    $('#subtab-payments').style.display = t.dataset.subtab === 'payments' ? '' : 'none';
    if (t.dataset.subtab === 'assigned') loadSubs();
    if (t.dataset.subtab === 'payments') loadPayments();
  });

  async function loadPayments() {
    try {
      const list = await api('/api/payments/history');
      const tb = $('#paymentsBody');
      if (!list.length) tb.innerHTML = `<tr><td colspan="6" class="empty">No payments.</td></tr>`;
      else tb.innerHTML = list.map(p => `
        <tr>
          <td>${new Date(p.created).toLocaleString('en-GB')}</td>
          <td class="email-mask">${escapeHtml(p.email_masked||'')}</td>
          <td>${escapeHtml(p.plan_id)}</td>
          <td>${p.amount} ${p.currency}</td>
          <td><span class="pill ${p.status==='completed'?'ok':p.status==='pending'?'':'bad'}">${p.status}</span></td>
          <td style="font-family:var(--font-mono);font-size:11px">${escapeHtml(p.provider_trx_id||'—')}</td>
        </tr>`).join('');
    } catch (e) { toast(e.message, 'error'); }
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
      $('#hero-name').textContent = (me.name || 'Admin').split(' ')[0];
      setAvatar(me); loadActivity(); },
  });
  $('#changeEmailBtn').onclick = () => Modal.form({
    title: 'Change Email', submitLabel: 'Save',
    fields: [{ name: 'email', label: 'New Email', type: 'email', required: true, value: me.email }],
    onSubmit: async d => {
      await api('/api/me', { method: 'PUT', body: JSON.stringify(d) });
      Modal.close(); toast('Updated');
      me = await api('/api/me');
      const roleEl = $('#who-role');
      if (roleEl) roleEl.textContent = (me.role_label || me.role || 'ADMIN').toUpperCase();
      loadAdmins(); loadActivity();
    },
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
          Modal.close(); toast('Disabled'); render2FA(); loadActivity(); },
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
              toast('Enabled'); render2FA(); loadActivity(); }
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
  $('#logoutBtn').onclick = async () => {
    const ok = await Modal.confirm('Sign Out', 'Sign out?', { okLabel: 'Sign Out' });
    if (!ok) return;
    try { await api('/api/logout', { method: 'POST' }); } catch {}
    location.href = '/';
  };
  $('#addUserBtn')?.addEventListener('click', () => { if (can('users.create')) addUserModal(); });
  $('#addAdminBtn')?.addEventListener('click', () => { if (can('admins.manage')) addAdminModal(); });

  // =========================================================
  //  INIT
  // =========================================================
  addHeaderRow('Content-Type', 'application/json');
  await Promise.all([
    loadStats(), loadUsers(),
    can('admins.view') ? loadAdmins() : Promise.resolve(),
    loadTickets(), loadActivity(),
    can('roles.manage') ? loadRoles() : Promise.resolve(),
    can('api_tester.use') ? (loadPMHistory(), loadPMCollections()) : Promise.resolve(),
    can('api_share.manage') ? loadShared() : Promise.resolve(),
    can('subscriptions.manage') ? (loadPlans(), loadSubs()) : Promise.resolve(),
    render2FA(),
  ]);
  logLine(`Session started as ${MY_ROLE}.`, 'ok');
  setInterval(() => { loadStats(); notif.refresh(); }, 15000);
})();