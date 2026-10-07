const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = (u, m = 'GET', b) => fetch('/api' + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const toast = t => { const e = $('#toast'); e.textContent = t; e.classList.add('show'); setTimeout(() => e.classList.remove('show'), 3800); };
const chip = p => `<span class="chip p${p}">P${p}</span>`;
const ago = iso => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

// ---- tabs ----
const loaders = { tickets: loadTickets, dash: loadStats, rules: loadRules, raise: () => {} };
$$('#tabs button').forEach(b => b.onclick = () => {
  $$('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  $$('.tab').forEach(t => t.classList.toggle('on', t.id === b.dataset.tab));
  loaders[b.dataset.tab]();
});

// ---- raise ticket + live routing slip ----
const f = $('#f'), slip = $('#slip');
function emptySlip() { slip.className = 'slip empty'; slip.innerHTML = '<p>Start typing and you will see where this ticket will go.</p>'; }
function showSlip(c, urgency) {
  const p = urgency === 'high' ? Math.max(1, c.priority - 1) : c.priority;
  slip.className = 'slip' + (c.manual ? ' manual' : '');
  slip.innerHTML = c.manual
    ? `<div class="route">Needs a human look</div><div class="to">No rule matched, so the Service Desk will triage it.</div><dl><dt>Team</dt><dd>${esc(c.group)}</dd><dt>Priority</dt><dd>${chip(p)}</dd></dl>`
    : `<div class="route">${esc(c.category)} - ${esc(c.subcategory)}</div><div class="to">Goes to ${esc(c.group)}</div><dl><dt>Priority</dt><dd>${chip(p)}</dd><dt>Matched on</dt><dd>${c.matched.map(esc).join(', ')}</dd></dl>`;
}
let timer;
f.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!f.short_description.value.trim() && !f.description.value.trim()) return emptySlip();
    showSlip(await api('/classify', 'POST', { short_description: f.short_description.value, description: f.description.value }), f.urgency.value);
  }, 250);
});
f.addEventListener('submit', async e => {
  e.preventDefault();
  const t = await api('/tickets', 'POST', Object.fromEntries(new FormData(f)));
  if (t.error) return toast(t.error);
  toast(`${t.number} created and routed to ${t.group}` + (t.servicenow && t.servicenow.number ? ` (ServiceNow ${t.servicenow.number})` : '') + (t.servicenow && t.servicenow.error ? ' - ServiceNow sync failed, see README' : ''));
  f.reset(); emptySlip();
});

// ---- tickets ----
async function loadTickets() {
  const t = await api('/tickets');
  $('#tlist').innerHTML = !t.length ? '<div class="empty-state">No tickets yet. Raise one and it will appear here.</div>' :
    `<div class="wrap"><table><tr><th>Number</th><th>Issue</th><th>Category</th><th>Team</th><th>Priority</th><th>Created</th></tr>${t.map(x => `<tr>
    <td><b>${esc(x.number)}</b>${x.servicenow && x.servicenow.number ? `<br><span class="muted">SN ${esc(x.servicenow.number)}</span>` : ''}</td>
    <td>${esc(x.short_description)}<br><span class="muted">${esc(x.caller)}</span></td>
    <td>${esc(x.category)} <span class="muted">/ ${esc(x.subcategory)}</span>${x.manual ? '<br><span class="muted">needs manual review</span>' : ''}</td>
    <td>${esc(x.group)}</td><td>${chip(x.priority)}</td><td class="muted">${ago(x.created)}</td></tr>`).join('')}</table></div>`;
}

// ---- dashboard ----
const bars = (title, o) => { const e = Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8), m = Math.max(1, ...e.map(x => x[1]));
  return `<div class="chart"><h3>${title}</h3>${e.length ? e.map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><i style="width:${v / m * 100}%"></i><b>${v}</b></div>`).join('') : '<p class="muted">No data yet.</p>'}</div>`; };
async function loadStats() {
  const s = await api('/stats'), rate = s.total ? Math.round(s.auto / s.total * 100) : 0;
  $('#stats').innerHTML = `<div class="cards"><div class="stat"><b>${s.total}</b><span>Tickets raised</span></div><div class="stat"><b>${rate}%</b><span>Classified automatically</span></div><div class="stat"><b>${s.manual}</b><span>Sent for manual review</span></div></div>
  <div class="charts">${bars('Tickets by category', s.byCategory)}${bars('Tickets by priority', s.byPriority)}${bars('Most matched keywords', s.topKeywords)}</div>`;
}

// ---- rules ----
async function loadRules() {
  const r = await api('/rules');
  $('#rlist').innerHTML = `<div class="wrap"><table><tr><th>Keyword</th><th>Category</th><th>Subcategory</th><th>Team</th><th>Priority</th><th></th></tr>${r.map(x => `<tr class="${x.active ? '' : 'off'}">
  <td><b>${esc(x.keyword)}</b></td><td>${esc(x.category)}</td><td>${esc(x.subcategory)}</td><td>${esc(x.group)}</td><td>${chip(x.priority)}</td>
  <td><button class="link" data-t="${x.id}">${x.active ? 'Turn off' : 'Turn on'}</button><button class="link del" data-d="${x.id}">Delete</button></td></tr>`).join('')}</table></div>`;
}
$('#rlist').addEventListener('click', async e => {
  if (e.target.dataset.t) await api('/rules/' + e.target.dataset.t, 'PUT');
  if (e.target.dataset.d && confirm('Delete this rule?')) await api('/rules/' + e.target.dataset.d, 'DELETE');
  if (e.target.dataset.t || e.target.dataset.d) loadRules();
});
$('#rf').addEventListener('submit', async e => {
  e.preventDefault();
  const r = await api('/rules', 'POST', Object.fromEntries(new FormData(e.target)));
  if (r.error) return toast(r.error);
  e.target.reset(); toast('Rule added'); loadRules();
});

api('/stats').then(s => { const m = $('#mode'); m.textContent = s.servicenow ? 'ServiceNow connected' : 'Standalone mode'; m.classList.toggle('live', s.servicenow); });
emptySlip();
