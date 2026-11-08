// Veleggia app: edit range levels and the weekly plan. Plain JS, no build step.
// Every value from the server is shown with textContent / .value, never as HTML.
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const mk = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null) e.setAttribute(k, v);
    }
    kids.flat().forEach(k => k != null && e.append(k));
    return e;
  };

  const ASSETS = [
    { id: 'BTC', label: 'BTC', sub: 'Bitcoin' },
    { id: 'ETH', label: 'ETH', sub: 'Ethereum' },
    { id: 'SPX', label: 'ES (S&P)', sub: 'ES1! futures levels' },
    { id: 'NDX', label: 'NQ (est.)', sub: 'NQ1! futures levels' },
  ];
  const SECTIONS = [
    { id: 'headline', title: 'Headline', hint: 'The week in one or two sentences', max: 1 },
    { id: 'long', title: 'Long setups to watch', hint: 'Trigger, stop, target, risk class' },
    { id: 'exit', title: 'Exits', hint: 'Exits under your rules' },
    { id: 'short', title: 'Shorts', hint: 'Setups, or "None qualify" with the reason' },
    { id: 'rule', title: 'Rules for the week', hint: 'For example no front-running' },
    { id: 'risk', title: 'Event risk', hint: 'High-impact events and your action item' },
  ];
  const RISK_CLASSES = ['Normal', 'Setup Only', 'Probably Setup Only', 'Setup Only, counter-trend'];
  const fmtDate = (d) => d ? new Date(d.length === 10 ? d + 'T12:00:00Z' : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Zurich' }) : '—';
  const fmtTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }) : '—';
  const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const mondayOf = (day) => addDays(day, -((new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7));
  const isoWeek = (day) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3); const f = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); return 1 + Math.round(((d - f) / 864e5 - 3 + ((f.getUTCDay() + 6) % 7)) / 7); };

  // ---------- server ----------
  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: 'same-origin', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, ...opts });
    let data = null; try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) { const err = new Error((data && data.error) || `Request failed (${res.status}).`); err.status = res.status; err.errors = (data && data.errors) || []; throw err; }
    return data;
  }
  function banner(text, ok) {
    const b = $('#banner'); b.textContent = text || ''; b.hidden = !text; b.classList.toggle('ok', !!ok);
    if (ok) setTimeout(() => { if (b.textContent === text) b.hidden = true; }, 3500);
  }

  // ---------- tabs ----------
  const tabs = document.querySelectorAll('.tabs button');
  function show(tab) {
    tabs.forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    document.querySelectorAll('.tab').forEach(s => { s.hidden = s.id !== 'tab-' + tab; });
    try { localStorage.setItem('veleggia.tab', tab); } catch { /* storage may be blocked */ }
    if (tab === 'history') loadHistory();
    if (tab === 'alerts') loadAlerts();
  }
  tabs.forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));

  // ---------- form field helper ----------
  function field(label, name, value, opts = {}) {
    const input = opts.textarea ? mk('textarea', { name, rows: opts.rows || 2 }) : mk(opts.list ? 'input' : 'input', { name, type: 'text', inputmode: opts.numeric ? 'decimal' : null, autocomplete: 'off', list: opts.list || null, placeholder: opts.placeholder || '' });
    input.value = value ?? '';
    const wrap = mk('label', { class: 'f' }, label, input, opts.hint ? mk('span', { class: 'hint', text: opts.hint }) : null, mk('span', { class: 'msg' }));
    return wrap;
  }
  function tfField(value) {
    const sel = mk('select', { name: 'trigger_tf' });
    for (const [v, t] of [['', '4H closes'], ['1H', '1H closes']]) { const o = mk('option', { value: v, text: t }); if ((value || '') === v) o.selected = true; sel.append(o); }
    return mk('label', { class: 'f' }, 'Timeframe', sel, mk('span', { class: 'msg' }));
  }
  function showErrors(container, errors, map = (f) => f) {
    container.querySelectorAll('.f').forEach(f => { f.classList.remove('err'); $('.msg', f).textContent = ''; });
    for (const e of errors) {
      const input = container.querySelector(`[name="${CSS.escape(map(e.field))}"]`);
      if (input) { const f = input.closest('.f'); f.classList.add('err'); $('.msg', f).textContent = e.message; }
    }
  }

  // ---------- levels ----------
  async function loadLevels() {
    const box = $('#level-cards'); box.textContent = '';
    let rows = [];
    try { rows = (await api('/api/levels')).rows; } catch (e) { banner(e.message); return; }
    for (const a of ASSETS) box.append(levelCard(a, rows.find(r => r.asset === a.id) || { asset: a.id }));
  }
  function levelCard(a, r) {
    const form = mk('form', { class: 'card', novalidate: '' });
    const setOn = mk('small', { text: r.set_on ? 'set ' + fmtDate(r.set_on) : 'no levels yet' });
    [
      mk('h3', {}, a.label, setOn),
      mk('div', { class: 'row3' },
        field('Range high', 'range_high', r.range_high, { numeric: true }),
        field('Mid', 'mid', r.mid, { numeric: true, hint: 'Empty = no mid' }),
        field('Range low', 'range_low', r.range_low, { numeric: true })),
      field('Watch levels', 'watch_levels', (r.watch_levels || '').split(';').filter(Boolean).join('; '), { hint: 'Separate with ;', placeholder: 'e.g. 2178; 1985' }),
      a.id === 'BTC' || a.id === 'ETH'
        ? mk('div', { class: 'row3' },
            field('Long trigger', 'long_trigger_4h', r.long_trigger_4h, { numeric: true, hint: 'Two closes above it' }),
            tfField(r.trigger_tf))
        : field('Long trigger', 'long_trigger_4h', r.long_trigger_4h, { numeric: true, hint: 'Two 4H closes above it (alerts on the daily close back above)' }),
      a.id === 'NDX' ? field('NQ ratio (NQ points per QQQ dollar)', 'proxy_ratio', r.proxy_ratio, { numeric: true, hint: 'Recalibrate every couple of months' }) : null,
      field('Note', 'note', r.note, { textarea: true }),
    ].filter(Boolean).forEach(x => form.append(x));
    const save = mk('button', { class: 'primary', type: 'submit', text: 'Save ' + a.label });
    const when = mk('span', { class: 'muted', text: r.updated_at ? 'Saved ' + fmtTime(r.updated_at) : '' });
    form.append(mk('div', { class: 'card-foot' }, when, save));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(form).entries());
      save.disabled = true;
      try {
        const { row } = await api('/api/levels/' + a.id, { method: 'PUT', body: JSON.stringify(body) });
        showErrors(form, []);
        setOn.textContent = 'set ' + fmtDate(row.set_on); when.textContent = 'Saved ' + fmtTime(row.updated_at);
        banner(a.label + ' levels saved.', true);
      } catch (e) { showErrors(form, e.errors); banner(e.message); }
      finally { save.disabled = false; }
    });
    return form;
  }

  // ---------- weekly plan ----------
  let plan = { rows: [] };
  const wsInput = $('#plan-week-start');
  function updateWeekLabel() {
    const ws = wsInput.value;
    $('#plan-week').textContent = ws ? `Week ${isoWeek(ws)} · ${fmtDate(ws)} to ${fmtDate(addDays(ws, 6))}${mondayOf(ws) !== ws ? ' · pick a Monday' : ''}` : '—';
  }
  wsInput.addEventListener('change', updateWeekLabel);

  async function loadPlan() {
    try { plan = await api('/api/plan'); } catch (e) { banner(e.message); return; }
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());
    wsInput.value = plan.rows[0]?.week_start || mondayOf(today);
    updateWeekLabel();
    $('#plan-saved').textContent = plan.saved_at ? `Saved ${fmtTime(plan.saved_at)} · written ${fmtDate(plan.rows[0]?.written)}` : 'No plan saved yet.';
    if (plan.rows[0] && plan.rows[0].week_end < today) banner('This plan is for a week that has ended. Start next week from it, or write a new one.');
    renderPlan();
  }

  function renderPlan() {
    const box = $('#plan-sections'); box.textContent = '';
    SECTIONS.forEach(s => {
      const rows = plan.rows.filter(r => r.section === s.id);
      const add = mk('button', { class: 'small', type: 'button', text: '+ Add', onclick: () => { collect(); plan.rows.push(blankRow(s.id)); renderPlan(); } });
      if (s.max && rows.length >= s.max) add.disabled = true;
      const sec = mk('div', { class: 'sec', 'data-section': s.id }, mk('div', { class: 'sec-head' }, mk('h2', { text: s.title }), mk('span', { class: 'muted', text: s.hint }), add));
      rows.forEach(r => sec.append(planRow(r)));
      if (!rows.length) sec.append(mk('p', { class: 'muted', text: 'Nothing here yet.' }));
      box.append(sec);
    });
  }
  const blankRow = (section) => ({ _k: Math.random().toString(36).slice(2), id: '', section, asset: section === 'long' || section === 'exit' ? 'BTC' : '', market: '', title: '', trigger: '', stop: '', target: '', risk_class: section === 'long' ? 'Normal' : '', level: '', note: '' });

  function planRow(r) {
    if (!r._k) r._k = Math.random().toString(36).slice(2);
    const label = () => {
      const a = ASSETS.find(x => x.id === r.asset);
      const t = (r.title || '').trim() || 'New item';
      return (a && (r.section === 'long' || r.section === 'exit') ? a.label + ' · ' : '') + (t.length > 90 ? t.slice(0, 88) + '…' : t);
    };
    const sum = mk('summary', { text: label() });
    const el = mk('details', { class: 'prow', 'data-k': r._k }, sum);
    if (!(r.title || '').trim() || r.section === 'headline') el.open = true;
    el.addEventListener('input', (ev) => { if (ev.target.name === 'title' || ev.target.name === 'asset') { r[ev.target.name] = ev.target.value; sum.textContent = label(); } });
    el.addEventListener('change', (ev) => { if (ev.target.name === 'asset') { r.asset = ev.target.value; sum.textContent = label(); } });
    const sel = (name, value, options) => { const s = mk('select', { name }); options.forEach(([v, t]) => { const o = mk('option', { value: v, text: t }); if (v === value) o.selected = true; s.append(o); }); return mk('label', { class: 'f' }, name === 'asset' ? 'Market' : 'Risk class', s, mk('span', { class: 'msg' })); };
    const marketSel = () => sel('asset', r.asset, ASSETS.map(a => [a.id, a.label]));
    if (r.section === 'headline') el.append(field('Headline', 'title', r.title, { textarea: true, rows: 3 }));
    else if (r.section === 'long') {
      const risk = sel('risk_class', RISK_CLASSES.includes(r.risk_class) ? r.risk_class : '', [...RISK_CLASSES.map(x => [x, x]), ['', 'Other (type below)']]);
      el.append(mk('div', { class: 'prow-grid' }, marketSel(), field('Setup', 'title', r.title, { placeholder: 'e.g. Range low sweep' }), risk,
        field('Risk class (other)', 'risk_other', RISK_CLASSES.includes(r.risk_class) ? '' : r.risk_class, { placeholder: 'e.g. Setup Only (Uptrend weak)' })));
      el.append(mk('div', { class: 'prow-grid' }, field('Trigger', 'trigger', r.trigger, { textarea: true }), field('Stop', 'stop', r.stop, { textarea: true }), field('Target', 'target', r.target, { textarea: true })));
      el.append(mk('div', { class: 'prow-grid' }, field('Trigger level', 'level', r.level, { numeric: true, hint: 'One number; the dashboard shows the distance to it' }), field('Note', 'note', r.note, { textarea: true })));
    } else if (r.section === 'exit') {
      el.append(mk('div', { class: 'prow-grid' }, marketSel(), field('Status', 'title', r.title, { placeholder: 'e.g. Exit rule hit 30 Oct' }), field('Note', 'note', r.note, { textarea: true })));
    } else if (r.section === 'short') {
      el.append(mk('div', { class: 'prow-grid' }, field('Short setup', 'title', r.title), field('Reason / note', 'note', r.note, { textarea: true })));
    } else {
      el.append(field(r.section === 'rule' ? 'Rule' : 'Event or action item', 'title', r.title, { textarea: true }));
    }
    const move = (d) => { collect(); const i = plan.rows.findIndex(x => x._k === r._k); const same = plan.rows.map((x, j) => [x, j]).filter(([x]) => x.section === r.section).map(([, j]) => j); const p = same.indexOf(i), q = same[p + d]; if (q === undefined) return; [plan.rows[i], plan.rows[q]] = [plan.rows[q], plan.rows[i]]; renderPlan(); };
    el.append(mk('div', { class: 'prow-tools' },
      mk('button', { class: 'small', type: 'button', text: '↑', 'aria-label': 'Move up', onclick: () => move(-1) }),
      mk('button', { class: 'small', type: 'button', text: '↓', 'aria-label': 'Move down', onclick: () => move(1) }),
      mk('button', { class: 'small', type: 'button', text: 'Remove', onclick: () => { collect(); plan.rows = plan.rows.filter(x => x._k !== r._k); renderPlan(); } })));
    return el;
  }

  /** Read the edited values back into plan.rows (in on-screen order). */
  function collect() {
    const byK = Object.fromEntries(plan.rows.map(r => [r._k, r]));
    const out = [];
    document.querySelectorAll('#plan-sections .prow').forEach(el => {
      const r = byK[el.dataset.k]; if (!r) return;
      el.querySelectorAll('[name]').forEach(i => { if (i.name !== 'risk_other') r[i.name] = i.value; });
      if (r.section === 'long') { const other = $('[name="risk_other"]', el).value.trim(); if (!r.risk_class) r.risk_class = other; }
      out.push(r);
    });
    const order = SECTIONS.map(s => s.id);
    plan.rows = out.sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section));
  }

  $('#plan-save').addEventListener('click', async () => {
    collect();
    const btn = $('#plan-save'); btn.disabled = true;
    const rows = plan.rows.map(({ _k, ...r }) => r);
    try {
      const res = await api('/api/plan', { method: 'PUT', body: JSON.stringify({ week_start: wsInput.value, rows }) });
      plan = { ...res, rows: res.rows };
      banner('Weekly plan saved.', true); await loadPlan();
    } catch (e) {
      banner(e.message + (e.errors.length ? ' ' + e.errors.map(x => x.message).join(' ') : ''));
      // Point at the fields: errors name rows.<index>.<field> in the order sent.
      const els = [...document.querySelectorAll('#plan-sections .prow')];
      els.forEach(el => el.querySelectorAll('.f').forEach(f => { f.classList.remove('err'); $('.msg', f).textContent = ''; }));
      e.errors.forEach(x => { const m = /^rows\.(\d+)\.(\w+)$/.exec(x.field); if (!m) return; const el = els[Number(m[1])]; const inp = el && $(`[name="${m[2]}"]`, el); if (inp) { el.open = true; const f = inp.closest('.f'); f.classList.add('err'); $('.msg', f).textContent = x.message; } });
    } finally { btn.disabled = false; }
  });

  $('#plan-next').addEventListener('click', () => {
    collect();
    const base = wsInput.value || mondayOf(new Date().toISOString().slice(0, 10));
    wsInput.value = addDays(mondayOf(base), 7); updateWeekLabel();
    plan.rows = plan.rows.map(r => ({ ...r, id: '' }));
    renderPlan();
    banner('Copied into next week. Edit it, then press Save plan.', true);
  });


  // ---------- alerts and push ----------
  const NAME = (a, type) => a === 'SPX' ? (type === 'Range' ? 'ES (S&P)' : 'S&P 500') : a === 'NDX' ? 'NQ (est.)' : a;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const b64uToBytes = (s) => { const p = '='.repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };

  async function pushState() {
    const on = $('#push-on'), off = $('#push-off'), test = $('#push-test'), help = $('#push-help'), st = $('#push-state');
    [on, off, test].forEach(b => { b.hidden = true; });
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      st.textContent = 'not available';
      help.textContent = isIOS && !standalone
        ? 'On iPhone, alerts work only in the installed app: in Safari tap Share, then "Add to Home Screen", and open Veleggia from that icon.'
        : 'This browser does not support push alerts.';
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub && Notification.permission === 'granted') {
      st.textContent = 'on'; st.className = 'ok';
      help.textContent = 'This device gets an alert within minutes of a closed candle: crypto daily close, every 4H close, the US close and the futures close.';
      off.hidden = false; test.hidden = false;
    } else if (Notification.permission === 'denied') {
      st.textContent = 'blocked'; st.className = 'bad';
      help.textContent = isIOS ? 'Notifications are blocked. Turn them on in iPhone Settings > Notifications > Veleggia.' : 'Notifications are blocked for this site in the browser settings.';
    } else {
      st.textContent = 'off'; st.className = '';
      help.textContent = 'Turn on alerts to get range and rule signals on this device.';
      on.hidden = false;
    }
  }

  $('#push-on').addEventListener('click', async () => {
    const msg = $('#push-msg'); msg.textContent = '';
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { await pushState(); return; }
      const { publicKey } = await api('/api/push/key');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) });
      await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
      banner('Alerts are on for this device.', true);
    } catch (e) { banner('Could not turn on alerts: ' + e.message); }
    await pushState();
  });
  $('#push-off').addEventListener('click', async () => {
    try {
      const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
      if (sub) { await api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
      banner('Alerts are off for this device.', true);
    } catch (e) { banner(e.message); }
    await pushState();
  });
  $('#push-test').addEventListener('click', async () => {
    try { const r = await api('/api/push/test', { method: 'POST', body: '{}' }); $('#push-msg').textContent = r.sent ? 'Test sent.' : 'No device got it.'; }
    catch (e) { banner(e.message); }
  });

  async function loadAlerts() {
    pushState().catch(() => {});
    const list = $('#alert-list'); list.textContent = '';
    try {
      const [al, st] = await Promise.all([api('/api/alerts?limit=60'), api('/api/status')]);
      const last = st.runs[0];
      const cs = $('#check-status'); cs.textContent = '';
      if (!st.fmp_key_set) cs.append(mk('span', { class: 'bad', text: 'The FMP key is not set in Cloudflare yet, so no checks run.' }));
      else if (!last) cs.append(mk('span', { text: 'No check has run yet. The first one runs at the next full hour plus 5 minutes.' }));
      else cs.append(mk('span', { class: last.ok ? 'ok' : 'bad', text: last.ok ? '● ' : '● ' }), `Last check ${fmtTime(last.at)}: ${last.ok ? 'ok' : 'failed'}${last.error ? ' · ' + last.error : ''} · checks every hour at :05`);
      al.rows.forEach(a => list.append(mk('div', { class: 'al ' + a.level },
        mk('div', { class: 'h' }, mk('b', { text: NAME(a.asset, a.type) }), mk('span', { class: 't', text: a.type }), mk('span', { class: 'when', text: a.at })),
        mk('div', { class: 'm', text: a.message }))));
      if (!al.rows.length) list.append(mk('div', { class: 'al' }, mk('div', { class: 'm', text: 'No alerts yet. The first check stores the current state; alerts start with the next change.' })));
    } catch (e) { banner(e.message); }
  }

  // ---------- history ----------
  async function loadHistory() {
    const hl = $('#hist-levels'), hp = $('#hist-plans'); hl.textContent = ''; hp.textContent = '';
    try {
      const [lv, pl] = await Promise.all([api('/api/levels/history'), api('/api/plan/history')]);
      lv.rows.forEach(h => {
        const d = h.data; const a = ASSETS.find(x => x.id === h.asset);
        hl.append(mk('div', { class: 'h' }, mk('b', { text: a ? a.label : h.asset }),
          mk('span', { text: `${d.range_low} / ${d.mid || 'no mid'} / ${d.range_high}${d.watch_levels ? ' · watch ' + d.watch_levels.split(';').join(', ') : ''}${d.long_trigger_4h ? ' · ' + (d.trigger_tf || '4H') + ' trigger ' + d.long_trigger_4h : ''}` }),
          mk('span', { class: 'when', text: `${fmtTime(h.saved_at)} · ${h.saved_by}` })));
      });
      pl.rows.forEach(h => hp.append(mk('div', { class: 'h' }, mk('b', { text: h.week.split(' (')[0] }), mk('span', { text: `${h.rows} rows` }), mk('span', { class: 'when', text: `${fmtTime(h.saved_at)} · ${h.saved_by}` }))));
      if (!lv.rows.length) hl.append(mk('div', { class: 'h' }, mk('span', { text: 'No changes yet.' })));
      if (!pl.rows.length) hp.append(mk('div', { class: 'h' }, mk('span', { text: 'No plans yet.' })));
    } catch (e) { banner(e.message); }
  }

  // ---------- start ----------
  api('/api/me').then(m => { $('#who').textContent = `Signed in as ${m.email} · not investment advice`; }).catch(e => banner(e.message));
  loadLevels(); loadPlan();
  let start = new URLSearchParams(location.search).get('tab') || 'levels';
  if (!new URLSearchParams(location.search).get('tab')) { try { start = localStorage.getItem('veleggia.tab') || 'levels'; } catch { /* ignore */ } }
  show(['levels', 'plan', 'alerts', 'history'].includes(start) ? start : 'levels');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
