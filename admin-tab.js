// ============================================================================
// ALEL Pulse — Admin + Settings tabs (inside the main app, admin roles only)
// ============================================================================
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  window.isAdminUser = false;
  window.toggleAdminTabs = function (isAdmin) {
    window.isAdminUser = !!isAdmin;
    $('tab-admin').classList.toggle('hidden', !isAdmin);
  };

  let adminPane = 'users', masterSel = 'lines', masterRows = [], selRows = new Set();

  function wireDom() {
    document.querySelectorAll('.a-sub').forEach(b => b.addEventListener('click', () => {
      adminPane = b.dataset.a;
      document.querySelectorAll('.a-sub').forEach(x => x.classList.toggle('bg-enovar', x === b));
      document.querySelectorAll('.a-pane').forEach(x => x.classList.add('hidden'));
      $('a-' + adminPane).classList.remove('hidden');
      if (adminPane === 'users') renderAdminUsers();
      if (adminPane === 'master') renderAdminMaster();
      if (adminPane === 'audit') renderAdminAudit();
    }));
    document.querySelectorAll('.m-sub2').forEach(b => b.addEventListener('click', () => { masterSel = b.dataset.m2; renderAdminMaster(); }));
    $('m2-add').addEventListener('click', () => adminMasterForm({}));
    $('m2-export').addEventListener('click', exportMaster);
    $('m2-import').addEventListener('change', importMaster);
    $('ad-load').addEventListener('click', loadAdminData);
    $('ad-trash').addEventListener('click', () => batchAdminData('trash'));
    $('ad-restore').addEventListener('click', () => batchAdminData('restore'));
    $('ad-hard').addEventListener('click', () => batchAdminData('hard'));
    $('a-add-btn').addEventListener('click', addUser);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireDom); else wireDom();

  async function myRole() { return (await window.sb.from('users').select('role').eq('id', (await window.sb.auth.getUser()).data.user.id).maybeSingle()).data?.role; }

  // ---------------- USERS & REQUESTS ----------------
  async function renderAdminUsers() {
    const [u, r] = await Promise.all([
      window.sb.from('user_status').select('*').order('email'),
      window.sb.from('access_requests').select('*').order('created_at', { ascending: false }).limit(50),
    ]);
    const users = u.data || [], reqs = (r.data || []).filter(x => x.status === 'pending');
    $('a-req-badge').textContent = reqs.length || '';
    $('a-req-badge').classList.toggle('hidden', !reqs.length);
    $('a-requests').innerHTML = '<tr><th>Name</th><th>Email</th><th>Requested</th><th>Note</th><th></th></tr>' +
      (reqs.length ? reqs.map(x => `<tr><td class="font-bold">${esc(x.name || '—')}</td><td>${esc(x.email)}</td><td>${esc(x.requested_role)}</td><td>${esc(x.note || '')}</td>
        <td><select id="ar-role-${x.id}" class="mr-1">${['manager','quality','operator'].map(rr => `<option ${rr === x.requested_role ? 'selected' : ''}>${rr}</option>`).join('')}</select>
        <button onclick="decideReq('${x.id}', true)" class="font-bold text-emerald-700 mr-2">Approve</button><button onclick="decideReq('${x.id}', false)" class="font-bold text-red-500">Reject</button></td></tr>`).join('')
        : '<tr><td colspan="5" class="text-center text-slate-400 py-3">No pending requests.</td></tr>');
    const roleBadge = rl => ({ super_admin: 'bg-purple-100 text-purple-700', admin: 'bg-teal-100 text-teal-800', manager: 'bg-blue-100 text-blue-700', quality: 'bg-amber-100 text-amber-700', operator: 'bg-slate-200 text-slate-600' }[rl] || '');
    $('a-users-table').innerHTML = '<tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Entries 7d</th><th></th></tr>' +
      users.map(x => `<tr><td class="font-bold">${esc(x.name || '—')}</td><td>${esc(x.email)}</td>
        <td><select onchange="changeRoleA('${esc(x.email)}', this.value)" ${x.role === 'super_admin' ? 'disabled' : ''}>${['super_admin','admin','manager','quality','operator'].map(rl => `<option ${rl === x.role ? 'selected' : ''} ${rl === 'super_admin' ? 'disabled' : ''}>${rl}</option>`).join('')}</select></td>
        <td><span class="badge ${x.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${x.active ? 'active' : 'inactive'}</span></td>
        <td>${x.entries_7d ?? 0}</td>
        <td><button onclick="toggleActiveA('${esc(x.email)}', ${!x.active})" ${x.role === 'super_admin' ? 'disabled' : ''} class="font-bold text-enovar">${x.active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('');
  }
  window.decideReq = async (id, approve) => {
    const role = approve ? ($('ar-role-' + id) ? $('ar-role-' + id).value : 'operator') : 'operator';
    const { error } = await window.sb.rpc('decide_request', { p_req: id, p_approve: approve, p_role: role });
    if (error) return alert(error.message);
    renderAdminUsers();
  };
  window.changeRoleA = async (email, role) => {
    const { error } = await window.sb.rpc('set_user_role', { p_email: email, p_role: role });
    if (error) return alert(error.message);
    renderAdminUsers();
  };
  window.toggleActiveA = async (email, active) => {
    const { error } = await window.sb.rpc('set_user_active', { p_email: email, p_active: active });
    if (error) return alert(error.message);
    renderAdminUsers();
  };
  async function addUser() {
    const email = $('a-add-email').value.trim(), name = $('a-add-name').value.trim(), role = $('a-add-role').value;
    if (!email) return alert('Email required');
    const { error } = await window.sb.from('allowed_emails').upsert({ email, name, role });
    if (error) return alert(error.message);
    await window.sb.from('users').update({ role, active: true, name }).eq('email', email);
    $('a-add-email').value = ''; $('a-add-name').value = '';
    renderAdminUsers();
  }

  // ---------------- MASTER DATA ----------------
  async function renderAdminMaster() {
    const { data } = await window.sb.from(masterSel).select('*').order('name');
    masterRows = data || [];
    const cols = { lines: ['name', 'section', 'active'], items: ['code', 'name', 'pg', 'target_productivity', 'target_qty', 'active'], defect_types: ['name', 'category', 'active'], time_slots: ['label', 'sort_order', 'active'] }[masterSel];
    $('a-master-table').innerHTML = '<tr>' + cols.map(c => `<th>${c.replace(/_/g, ' ')}</th>`).join('') + '<th></th></tr>' +
      masterRows.map(r => `<tr>${cols.map(c => `<td>${esc(r[c])}</td>`).join('')}<td><button onclick="adminMasterFormById('${r.id}')" class="font-bold text-enovar">Edit</button></td></tr>`).join('');
  }
  window.adminMasterFormById = id => adminMasterForm(masterRows.find(r => r.id === id));
  function adminMasterForm(r) {
    const cols = { lines: ['name', 'section'], items: ['code', 'name', 'pg', 'target_productivity', 'target_qty'], defect_types: ['name', 'category'], time_slots: ['label', 'sort_order'] }[masterSel];
    const html = '<h3 class="font-black mb-3">' + (r ? 'Edit' : 'Add') + ' ' + masterSel + '</h3>' +
      cols.map(c => `<label class="text-[11px] font-bold block">${c.replace(/_/g, ' ')}</label><input id="mf2-${c}" value="${esc(r[c] ?? '')}" class="w-full mb-2 border border-gray-200 rounded-lg px-2 py-1.5 text-[12px]">`).join('') +
      `<div class="flex gap-2 justify-end mt-2"><button class="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-[11px] font-bold" onclick="document.getElementById('admin-modal-root').innerHTML=''">Cancel</button><button class="px-3 py-1.5 rounded-lg bg-enovar text-white text-[11px] font-bold" id="mf2-save">Save</button></div>`;
    $('admin-modal-root').innerHTML = `<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50"><div class="bg-white rounded-xl p-5 w-full max-w-sm">${html}</div></div>`;
    $('mf2-save').onclick = async () => {
      const row = {};
      cols.forEach(c => { const v = $('mf2-' + c).value; row[c] = ['sort_order', 'target_productivity', 'target_qty'].includes(c) && v !== '' ? +v : v; });
      const { error } = r ? await window.sb.from(masterSel).update(row).eq('id', r.id) : await window.sb.from(masterSel).insert(row);
      if (error) return alert(error.message);
      $('admin-modal-root').innerHTML = ''; renderAdminMaster();
    };
  }
  function exportMaster() {
    const ws = XLSX.utils.json_to_sheet(masterRows.map(({ id, created_at, updated_at, ...rest }) => rest));
    XLSX.writeFile(XLSX.utils.book_new(ws), masterSel + '.xlsx');
  }
  async function importMaster(ev) {
    const f = ev.target.files[0]; if (!f) return;
    const wb = XLSX.read(await f.arrayBuffer());
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const key = masterSel === 'items' ? 'code' : masterSel === 'time_slots' ? 'label' : 'name';
    for (const r of rows) {
      const row = { ...r };
      row.active = String(row.active).toLowerCase() === 'false' ? false : true;
      await window.sb.from(masterSel).upsert(row, { onConflict: key });
    }
    renderAdminMaster(); ev.target.value = '';
  }

  // ---------------- DATA EDIT ----------------
  async function loadAdminData() {
    const set = $('ad-set').value, date = $('ad-date').value, st = $('ad-status').value;
    let q = window.sb.from(set).select('*').order('entry_date', { ascending: false }).limit(300);
    if (date) q = q.eq('entry_date', date);
    if (st === 'active') q = q.is('deleted_at', null); else if (st === 'trash') q = q.not('deleted_at', 'is', null);
    const { data, error } = await q;
    if (error) return alert(error.message);
    selRows.clear(); window.__adminData = data || [];
    const itemName = id => { const i = (window.__masterCacheItems || []).find(x => x.id === id); return i ? `[${i.code}] ${i.name}` : '—'; };
    const isProd = set === 'production_entries';
    const cols = isProd ? ['entry_date', 'item_id', 'time_slot', 'qty', 'mp', 'productivity'] : ['entry_date', 'item_id', 'defect_type_id', 'time_slot', 'qty'];
    $('a-data-table').innerHTML = '<tr><th></th>' + cols.map(c => `<th>${c.replace(/_/g, ' ')}</th>`).join('') + '<th></th></tr>' +
      window.__adminData.map(r => `<tr class="${r.deleted_at ? 'opacity-50' : ''}"><td><input type="checkbox" onchange="adSel('${r.id}', this.checked)"></td>
        ${cols.map(c => `<td>${c === 'item_id' ? esc(itemName(r.item_id)) : c === 'defect_type_id' ? esc(r.defect_type_id) : esc(r[c])}</td>`).join('')}
        <td><button onclick="adEdit('${r.id}')" class="font-bold text-enovar">Edit</button></td></tr>`).join('');
    $('ad-sel').textContent = '0 selected';
    $('ad-hard').classList.toggle('hidden', window.isAdminUser !== true && myRole() !== 'super_admin');
  }
  window.adSel = (id, on) => { on ? selRows.add(id) : selRows.delete(id); $('ad-sel').textContent = selRows.size + ' selected'; };
  window.adEdit = id => {
    const r = window.__adminData.find(x => x.id === id); if (!r) return;
    const isProd = $('ad-set').value === 'production_entries';
    const fields = isProd ? ['entry_date', 'time_slot', 'qty', 'mp', 'productivity', 'target_productivity', 'remarks'] : ['entry_date', 'time_slot', 'qty', 'remarks'];
    $('admin-modal-root').innerHTML = `<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50"><div class="bg-white rounded-xl p-5 w-full max-w-sm">
      <h3 class="font-black mb-3">Edit row</h3>` +
      fields.map(f => `<label class="text-[11px] font-bold block">${f.replace(/_/g, ' ')}</label><input id="adf-${f}" value="${esc(r[f] ?? '')}" class="w-full mb-2 border border-gray-200 rounded-lg px-2 py-1.5 text-[12px]">`).join('') +
      `<div class="flex gap-2 justify-end mt-2"><button class="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-[11px] font-bold" onclick="document.getElementById('admin-modal-root').innerHTML=''">Cancel</button><button class="px-3 py-1.5 rounded-lg bg-enovar text-white text-[11px] font-bold" id="adf-save">Save</button></div></div></div>`;
    $('adf-save').onclick = async () => {
      const row = {};
      fields.forEach(f => { const v = $('adf-' + f).value; row[f] = ['qty', 'mp', 'productivity', 'target_productivity'].includes(f) ? +v : v; });
      const { error } = await window.sb.from($('ad-set').value).update(row).eq('id', id);
      if (error) return alert(error.message);
      $('admin-modal-root').innerHTML = ''; loadAdminData();
    };
  };
  async function batchAdminData(op) {
    const ids = [...selRows]; if (!ids.length) return;
    const set = $('ad-set').value;
    if (op === 'hard') await window.sb.from(set).delete().in('id', ids);
    else await window.sb.from(set).update({ deleted_at: op === 'trash' ? new Date().toISOString() : null }).in('id', ids);
    loadAdminData();
  }

  // ---------------- AUDIT ----------------
  async function renderAdminAudit() {
    const { data } = await window.sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(150);
    $('a-audit-table').innerHTML = '<tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th></tr>' +
      (data || []).map(r => `<tr><td>${new Date(r.created_at).toLocaleString()}</td><td>${esc(r.actor_email)}</td><td class="font-bold">${esc(r.action)}</td><td>${esc(r.entity)}#${esc(r.entity_id)}</td></tr>`).join('');
  }

  window.renderAdminHook = () => { document.querySelector('.a-sub[data-a="users"]').click(); };

  function wireTail() {
    window.sb.from('items').select('id,code,name').then(({ data }) => { window.__masterCacheItems = data || []; });
    const root = document.createElement('div');
    root.id = 'admin-modal-root';
    document.body.appendChild(root);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireTail); else wireTail();
})();
