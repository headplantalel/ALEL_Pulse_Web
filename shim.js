// ============================================================================
// ALEL Pulse — Supabase shim. Replaces the Apps Script backend 1:1.
// The original frontend (index.html) works unchanged; all its callAPI actions
// are served from Supabase/Postgres here.
// ============================================================================
window.SUPABASE_URL = "https://bskfvdgqzberzcdqmiku.supabase.co";
window.ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJza2Z2ZGdxemJlcnpjZHFtaWt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwNTQxNzUsImV4cCI6MjEwNzYzMDE3NX0.bjHLDs6NV5-clu2HIL-tmDDV6nBnt_fi0Q17PUY0Yhc";
window.sb = window.supabase.createClient(window.SUPABASE_URL, window.ANON_KEY);

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const MONTHS_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// --- date helpers (all timezone-safe, no toISOString on local dates) ---
function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function mmmDd(d) { return MONTHS_ABBR[d.getMonth()] + ' ' + String(d.getDate()).padStart(2, '0') + ', ' + d.getFullYear(); }
function ddMmm(d) { return String(d.getDate()).padStart(2, '0') + '-' + MONTHS_ABBR[d.getMonth()] + '-' + d.getFullYear(); }
function parseAny(s) {
  if (!s) return null;
  s = String(s).trim();
  if (s === 'today') return new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  if (s === 'yesterday') { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1); }
  let m;
  if ((m = s.match(/^(\w{3})\s+(\d{1,2}),\s+(\d{4})$/))) return new Date(+m[3], MONTHS[m[1]], +m[2]);
  if ((m = s.match(/^(\d{1,2})-(\w{3})-(\d{4})$/))) return new Date(+m[3], MONTHS[m[2]], +m[1]);
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

// --- caches ---
let masterCache = null; // {lines, items, dtypes, slots}
let prodRowIndex = 1000000, defRowIndex = 2000000;
const prodRowToId = new Map(), defRowToId = new Map();

async function getMaster() {
  if (masterCache) return masterCache;
  const [l, i, d, t] = await Promise.all([
    window.sb.from('lines').select('id,name,section,active'),
    window.sb.from('items').select('id,code,name,pg,line_id,target_productivity,active'),
    window.sb.from('defect_types').select('id,name,active'),
    window.sb.from('time_slots').select('label,sort_order,active'),
  ]);
  masterCache = { lines: l.data || [], items: i.data || [], dtypes: d.data || [], slots: (t.data || []).map(x => x.label) };
  return masterCache;
}
function lineName(id) { return (masterCache.lines.find(x => x.id === id) || {}).name || ''; }
function lineSection(id) { return (masterCache.lines.find(x => x.id === id) || {}).section || ''; }
function itemOf(id) { return masterCache.items.find(x => x.id === id); }

// fetch production rows for a date range (iso strings) → legacy raw row shape
async function fetchRawRows(fromIso, toIso) {
  let q = window.sb.from('production_entries')
    .select('id,entry_date,line_id,item_id,time_slot,qty,mp,productivity,target_productivity,operating_minutes,remarks')
    .is('deleted_at', null).order('entry_date', { ascending: true }).limit(1000);
  if (fromIso) q = q.gte('entry_date', fromIso);
  if (toIso) q = q.lte('entry_date', toIso);
  // paginate (max 1000/page)
  let rows = [], from = 0, page;
  do {
    page = (await q.range(from, from + 999)).data || [];
    rows = rows.concat(page);
    from += 1000;
  } while (page.length === 1000);
  return rows.map(r => {
    const it = itemOf(r.item_id);
    const d = parseAny(r.entry_date);
    return {
      date: mmmDd(d), line: lineName(r.line_id), section: lineSection(r.line_id),
      item: it ? it.name : '', itemCode: it ? it.code : '', pg: it ? it.pg : '',
      time: r.time_slot, qty: r.qty, mp: r.mp || 0,
      productivity: r.productivity, targetProductivity: r.target_productivity,
      minutes: r.operating_minutes || 0, remarks: r.remarks || '',
    };
  });
}

async function fetchDefectRows(fromIso, toIso) {
  let q = window.sb.from('defects')
    .select('id,entry_date,item_id,defect_type_id,time_slot,qty,remarks').is('deleted_at', null).order('entry_date', { ascending: true }).limit(1000);
  if (fromIso) q = q.gte('entry_date', fromIso);
  if (toIso) q = q.lte('entry_date', toIso);
  let rows = [], from = 0, page;
  do {
    page = (await q.range(from, from + 999)).data || [];
    rows = rows.concat(page);
    from += 1000;
  } while (page.length === 1000);
  return rows.map(r => {
    const it = itemOf(r.item_id);
    const dt = masterCache.dtypes.find(x => x.id === r.defect_type_id);
    const d = parseAny(r.entry_date);
    let ri = null;
    defRowToId.forEach((v, k) => { if (v === r.id) ri = k; });
    if (ri === null) { ri = ++defRowIndex; defRowToId.set(ri, r.id); }
    return {
      date: mmmDd(d), line: lineName(it ? it.line_id : null), item: it ? it.name : '', itemCode: it ? it.code : '',
      time: r.time_slot, defectiveQty: r.qty, defectType: dt ? dt.name : '', remarks: r.remarks || '', rowIndex: ri,
    };
  });
}

async function me() {
  const { data: { user } } = await window.sb.auth.getUser();
  if (!user) return null;
  const { data } = await window.sb.from('users').select('id,email,name,role,active').eq('id', user.id).maybeSingle();
  return data || null;
}

// ============================================================================
// callAPI — the single entry point the original frontend uses
// ============================================================================
window.callAPI = async function (payload, callback, retries) {
  retries = retries === undefined ? 2 : retries;
  try {
    const a = payload.action;
    let resp = {};

    if (a === 'getData') {
      const u = await me();
      if (!u) return callback({ error: 'not_authenticated' });
      const m = await getMaster();
      const role = u.role;
      const isAdm = role === 'admin' || role === 'super_admin';
      resp = {
        isAdmin: isAdm,
        authorizedEntry: ['operator', 'manager'].includes(role) || isAdm,
        authorizedDashboard: ['manager'].includes(role) || isAdm,
        authorizedFPY: ['quality', 'manager'].includes(role) || isAdm,
        items: m.items.map(x => x.name),
        lines: m.lines.map(x => x.name),
        times: m.slots,
        itemPgs: Object.fromEntries(m.items.map(x => [x.name, x.pg])),
        lineSections: Object.fromEntries(m.lines.map(x => [x.name, x.section])),
        itemDefectCodes: Object.fromEntries(m.items.map(x => [x.name, x.code])),
        defectTypes: m.dtypes.map(x => x.name),
      };
    }

    else if (a === 'getProductionMetadata') {
      const m = await getMaster();
      let dates = [];
      try {
        const { data } = await window.sb.from('production_entries').select('entry_date').is('deleted_at', null).order('entry_date', { ascending: false }).limit(1000);
        dates = [...new Set((data || []).map(r => r.entry_date))].sort();
      } catch (e) {}
      resp = {
        sections: [...new Set(m.lines.map(x => x.section))],
        pgs: [...new Set(m.items.map(x => x.pg))],
        items: m.items.map(x => ({ label: '[' + x.code + '] - ' + x.name, pg: x.pg })),
        dates: dates,
      };
    }

    else if (a === 'getDashboardRawData') {
      const from = parseAny(payload.startDate), to = parseAny(payload.endDate);
      resp = { raw: await fetchRawRows(from ? isoOf(from) : null, to ? isoOf(to) : null) };
    }

    else if (a === 'getDefectData') {
      const d1 = parseAny(payload.date), d2 = parseAny(payload.startDate);
      const from = d1 || d2;
      resp = { rows: await fetchDefectRows(from ? isoOf(from) : null, from ? isoOf(from) : null) };
    }

    else if (a === 'getDefectDates') {
      const { data } = await window.sb.from('defects').select('entry_date').is('deleted_at', null).order('entry_date', { ascending: false }).limit(1000);
      resp = { dates: [...new Set((data || []).map(r => r.entry_date))] };
    }

    else if (a === 'getDefectTypes') {
      const m = await getMaster();
      resp = { types: m.dtypes.map(x => x.name) };
    }

    else if (a === 'getHourlyFPY') {
      const d = parseAny(payload.date);
      const rows = await fetchRawRows(d ? isoOf(d) : null, d ? isoOf(d) : null);
      const defs = await fetchDefectRows(d ? isoOf(d) : null, d ? isoOf(d) : null);
      const map = {};
      rows.forEach(p => {
        const key = p.line + '::' + p.itemCode + '::' + p.time;
        map[key] = map[key] || { line: p.line, item: p.item, itemCode: p.itemCode, time: p.time, produced: 0, defective: 0 };
        map[key].produced += p.qty;
      });
      defs.forEach(dd => {
        const key = dd.line + '::' + dd.itemCode + '::' + dd.time;
        map[key] = map[key] || { line: dd.line, item: dd.item, itemCode: dd.itemCode, time: dd.time, produced: 0, defective: 0 };
        map[key].defective += Number(dd.defectiveQty) || 0;
      });
      resp = { rows: Object.values(map).map(r => {
        const t = r.produced + r.defective;
        r.fpy = t > 0 ? Math.round((r.produced / t) * 1000) / 10 : null;
        return r;
      }) };
    }

    else if (a === 'getDailyFPY') {
      const from = parseAny(payload.startDate), to = parseAny(payload.endDate);
      const rows = await fetchRawRows(from ? isoOf(from) : null, to ? isoOf(to) : null);
      const defs = await fetchDefectRows(from ? isoOf(from) : null, to ? isoOf(to) : null);
      const byDate = {};
      rows.forEach(r => { byDate[r.date] = byDate[r.date] || { date: r.date, produced: 0, defective: 0 }; byDate[r.date].produced += r.qty; });
      defs.forEach(d => { byDate[d.date] = byDate[d.date] || { date: d.date, produced: 0, defective: 0 }; byDate[d.date].defective += Number(d.defectiveQty) || 0; });
      resp = { rows: Object.values(byDate).sort((a, b) => new Date(a.date) - new Date(b.date)) };
    }

    else if (a === 'getAggregatedData') {
      const from = parseAny(payload.startDate), to = parseAny(payload.endDate);
      const rows = await fetchRawRows(from ? isoOf(from) : null, to ? isoOf(to) : null);
      const fRows = rows.filter(r => {
        if (payload.pg && payload.pg !== 'all' && r.pg !== payload.pg) return false;
        if (payload.item && r && ("[" + r.itemCode + "] - " + r.item) !== payload.item) return false;
        return true;
      });
      let sumQty = 0, weightedProdSum = 0, weightedTgtSum = 0;
      const dataMap = {}, dailyLineMp = {};
      fRows.forEach(r => {
        sumQty += r.qty;
        if (r.productivity > 0) weightedProdSum += r.productivity * r.qty;
        if (r.targetProductivity > 0) weightedTgtSum += r.targetProductivity * r.qty;
        const d = parseAny(r.date);
        let key, label;
        if (payload.viewType === 'daily') { key = r.date; label = r.date; }
        else { key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); label = MONTHS_ABBR[d.getMonth()] + ' ' + d.getFullYear(); }
        dataMap[key] = dataMap[key] || { label: label, actSum: 0, tgtSum: 0, qty: 0, tgtQtySum: 0 };
        dataMap[key].qty += r.qty;
        if (r.productivity > 0) { dataMap[key].actSum += r.productivity * r.qty; dataMap[key].tgtSum += r.targetProductivity * r.qty; }
        if (r.targetProductivity > 0 && r.mp > 0) dataMap[key].tgtQtySum += r.targetProductivity * r.mp;
        dailyLineMp[r.date] = dailyLineMp[r.date] || {};
        dailyLineMp[r.date][r.line] = Math.max(dailyLineMp[r.date][r.line] || 0, r.mp);
      });
      resp = { dataMap: dataMap, sumQty: sumQty, weightedProdSum: weightedProdSum, weightedTgtSum: weightedTgtSum, dailyLineMp: dailyLineMp };
    }

    else if (a === 'getHistory') {
      const u = await me(); if (!u) return callback({ error: 'not_authenticated' });
      const m = await getMaster();
      const { data } = await window.sb.from('production_entries')
        .select('id,entry_date,item_id,time_slot,qty,mp,remarks').eq('created_by', u.id).is('deleted_at', null)
        .order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(500);
      const entriesByDate = {}, dates = [];
      (data || []).forEach(r => {
        const d = parseAny(r.entry_date); const key = ddMmm(d);
        if (!entriesByDate[key]) { entriesByDate[key] = []; dates.push(key); }
        let ri = prodRowToId.get(r.id);
        if (ri === undefined) { ri = ++prodRowIndex; prodRowToId.set(r.id, ri); }
        entriesByDate[key].push({
          rowIndex: ri, itemName: itemOf(r.item_id) ? itemOf(r.item_id).name : '', line: lineName(itemOf(r.item_id) ? itemOf(r.item_id).line_id : null),
          time: r.time_slot, qty: r.qty, manpower: r.mp || 0, remarks: r.remarks || '',
        });
      });
      resp = { entriesByDate: entriesByDate, dates: dates };
    }

    else if (a === 'submit') {
      const u = await me(); if (!u) return callback({ error: 'not_authenticated' });
      const m = await getMaster();
      const f = payload.formData;
      const item = m.items.find(x => x.name === f.item);
      const line = m.lines.find(x => x.name === f.line);
      if (!item || !line) return callback({ error: 'item/line not found' });
      const d = parseAny(f.date);
      const q = +f.production, mp = +f.manpower;
      const { error } = await window.sb.from('production_entries').insert({
        entry_date: isoOf(d), line_id: line.id, item_id: item.id, time_slot: f.time,
        qty: q, mp: mp, productivity: mp > 0 ? +(q / mp).toFixed(1) : null,
        target_productivity: item.target_productivity ?? null,
        operating_minutes: +f.minutes || 60, remarks: f.remarks || null, created_by: u.id,
      });
      if (error) return callback({ error: error.message });
      resp = { status: 'Success' };
    }

    else if (a === 'editEntry') {
      const id = prodRowToId.get(payload.rowIndex);
      if (!id) return callback({ error: 'entry not found' });
      const q = +payload.newQty, mp = +payload.newManpower;
      const { error } = await window.sb.from('production_entries').update({
        qty: q, mp: mp, productivity: mp > 0 ? +(q / mp).toFixed(1) : null, updated_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) return callback({ error: error.message });
      resp = { status: 'Success' };
    }

    else if (a === 'deleteEntry') {
      const id = prodRowToId.get(payload.rowIndex);
      if (!id) return callback({ error: 'entry not found' });
      await window.sb.from('production_entries').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      resp = { status: 'Success' };
    }

    else if (a === 'submitDefectEntry') {
      const u = await me(); if (!u) return callback({ error: 'not_authenticated' });
      const m = await getMaster();
      const f = payload.formData;
      const item = m.items.find(x => x.name === f.item);
      const line = m.lines.find(x => x.name === f.line);
      const d = parseAny(f.date);
      const rows = (f.defects || []).map(dd => {
        const dt = m.dtypes.find(x => x.name === dd.problemType);
        return { entry_date: isoOf(d), item_id: item ? item.id : null, defect_type_id: dt ? dt.id : null, time_slot: f.time, qty: +dd.defectiveQty, remarks: f.remarks || null, created_by: u.id };
      }).filter(r => r.item_id && r.defect_type_id);
      if (!rows.length) return callback({ error: 'no valid defects' });
      const { error } = await window.sb.from('defects').insert(rows);
      if (error) return callback({ error: error.message });
      resp = { status: 'Success' };
    }

    else if (a === 'editDefectEntry') {
      const id = defRowToId.get(payload.rowIndex);
      if (!id) return callback({ error: 'entry not found' });
      await window.sb.from('defects').update({ qty: +payload.newQty }).eq('id', id);
      resp = { status: 'Success' };
    }

    else if (a === 'deleteDefectEntry') {
      const id = defRowToId.get(payload.rowIndex);
      if (!id) return callback({ error: 'entry not found' });
      await window.sb.from('defects').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      resp = { status: 'Success' };
    }

    else if (a === 'requestAccess') {
      const roleMap = { dashboard: 'manager', entry: 'operator', quality: 'quality' };
      const u = await me();
      await window.sb.from('access_requests').insert({
        email: payload.email || (u ? u.email : ''), name: payload.name || (u ? u.name : ''),
        requested_role: roleMap[payload.requestedApp] || 'operator', note: null,
      });
      resp = { status: 'Success' };
    }

    else if (a === 'askGemini') {
      resp = { error: 'AI chat is disabled in v2' };
    }

    else {
      resp = { error: 'unknown action: ' + a };
    }

    callback(resp);
  } catch (err) {
    console.error('shim error', payload.action, err.message);
    if (retries > 0) setTimeout(() => window.callAPI(payload, callback, retries - 1), 1200);
    else callback({ error: err.message || 'shim error' });
  }
};
